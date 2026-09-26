'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import type { Col } from '@/lib/master';
import { Alert, Spinner } from '@/components/ui';

interface Meta { title: string; pk: string; cols: Col[]; statusCol?: { key: string; active: unknown; inactive: unknown }; filterBy?: string }
type Row = Record<string, unknown>;

export function MasterTable({ entity, parent, readOnly = false, autoNew = false }: { entity: string; parent?: string; readOnly?: boolean; autoNew?: boolean }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [refs, setRefs] = useState<Record<string, { id: unknown; label: string }[]>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const [form, setForm] = useState<Row>({});
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(async (withRefs = false) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page) });
      if (q) p.set('q', q);
      if (parent) p.set('parent', parent);
      if (withRefs) p.set('refs', '1');
      const r = await api<{ rows: Row[]; total: number; entity: Meta; refs: typeof refs }>(`/api/admin/master/${entity}?${p}`);
      setRows(r.rows); setTotal(r.total); setMeta(r.entity);
      if (withRefs) setRefs(r.refs);
    } catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
    finally { setLoading(false); }
  }, [entity, page, q, parent, t]);

  useEffect(() => { void load(true); }, [entity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(false); }, [page, parent]); // eslint-disable-line react-hooks/exhaustive-deps
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => { if (autoNew && meta && !autoOpened && !readOnly) { setAutoOpened(true); open('new'); } }, [autoNew, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const refLabel = (c: Col, v: unknown) => (v == null ? '—' : refs[c.key]?.find((x) => String(x.id) === String(v))?.label ?? String(v));
  const show = (c: Col, v: unknown) => {
    if (c.type === 'ref') return refLabel(c, v);
    if (c.type === 'bool') return v ? '✓' : '—';
    if (c.type === 'array') return Array.isArray(v) ? v.join(', ') : '';
    if (c.type === 'status') return <span className={`badge ${v === 'ACTIVE' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-600'}`}>{String(v)}</span>;
    return v == null || v === '' ? '—' : String(v);
  };

  function open(r: Row | 'new') {
    setMsg(null);
    setEdit(r);
    const f: Row = {};
    for (const c of meta?.cols ?? []) {
      const v = r === 'new' ? (c.type === 'status' ? 'ACTIVE' : c.type === 'bool' ? true : c.type === 'array' ? [] : '') : r[c.key];
      f[c.key] = c.type === 'array' ? (Array.isArray(v) ? v.join(', ') : v ?? '') : v ?? '';
    }
    if (r === 'new' && parent && meta?.filterBy) f[meta.filterBy] = parent;
    setForm(f);
  }

  async function save() {
    if (!meta) return;
    setMsg(null);
    try {
      if (edit === 'new') await api(`/api/admin/master/${entity}`, { body: form });
      else if (edit) await api(`/api/admin/master/${entity}?id=${encodeURIComponent(String(edit[meta.pk]))}`, { method: 'PATCH', body: form });
      setEdit(null);
      setMsg({ tone: 'success', text: t('profile.saved') });
      await load(true);
    } catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
  }

  async function toggle(r: Row) {
    if (!meta?.statusCol) return;
    const sc = meta.statusCol;
    const next = r[sc.key] === sc.active ? sc.inactive : sc.active;
    try {
      await api(`/api/admin/master/${entity}?id=${encodeURIComponent(String(r[meta.pk]))}`, { method: 'PATCH', body: { [sc.key]: next } });
      await load(false);
    } catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
  }

  if (!meta) return <div className="flex justify-center p-8"><Spinner /></div>;
  const listCols = meta.cols.filter((c) => c.list !== false);
  const pages = Math.ceil(total / 50);

  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); void load(false); }} className="flex gap-2">
          <input className="input max-w-xs" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-outline">{t('common.search')}</button>
        </form>
        <span className="text-xs text-slate-500">{total} records</span>
        {!readOnly && <button className="btn btn-primary ml-auto" onClick={() => open('new')}>+ {t('common.add')}</button>}
      </div>

      {edit && (
        <div className="card space-y-3 p-4">
          <h3 className="font-bold">{edit === 'new' ? `${t('common.add')} — ${meta.title}` : `${t('common.edit')} — ${meta.title}`}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {meta.cols.map((c) => {
              const disabled = edit !== 'new' && c.readOnlyOnEdit;
              const val = form[c.key] as string;
              const set = (v: unknown) => setForm((s) => ({ ...s, [c.key]: v }));
              return (
                <label key={c.key} className={`block ${c.type === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
                  <span className="label">{c.label}{c.required ? ' *' : ''}</span>
                  {c.type === 'ref' ? (
                    <select className="input" disabled={disabled} value={val ?? ''} onChange={(e) => set(e.target.value)}>
                      <option value="">{c.nullable || !c.required ? '—' : t('common.select')}</option>
                      {(refs[c.key] ?? []).map((o) => <option key={String(o.id)} value={String(o.id)}>{o.label}</option>)}
                    </select>
                  ) : c.type === 'select' ? (
                    <select className="input" disabled={disabled} value={val ?? ''} onChange={(e) => set(e.target.value)}>
                      <option value="">—</option>
                      {c.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : c.type === 'status' ? (
                    <select className="input" value={val} onChange={(e) => set(e.target.value)}><option>ACTIVE</option><option>INACTIVE</option></select>
                  ) : c.type === 'bool' ? (
                    <input type="checkbox" className="h-5 w-5" checked={!!form[c.key]} onChange={(e) => set(e.target.checked)} />
                  ) : c.type === 'textarea' ? (
                    <textarea className="input min-h-20" value={val ?? ''} onChange={(e) => set(e.target.value)} />
                  ) : (
                    <input className="input" disabled={disabled} type={c.type === 'number' || c.type === 'float' ? 'number' : 'text'} step={c.type === 'float' ? 'any' : undefined}
                      value={val ?? ''} onChange={(e) => set(e.target.value)} placeholder={c.type === 'array' ? 'comma, separated' : ''} />
                  )}
                </label>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? <div className="flex justify-center p-6"><Spinner /></div> : (
          <table className="table-std">
            <thead><tr><th>#</th>{listCols.map((c) => <th key={c.key}>{c.label}</th>)}{!readOnly && <th />}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r[meta.pk])}>
                  <td className="text-xs text-slate-400">{String(r[meta.pk])}</td>
                  {listCols.map((c) => <td key={c.key} className="max-w-xs truncate">{show(c, r[c.key])}</td>)}
                  {!readOnly && (
                    <td className="whitespace-nowrap">
                      <button className="btn btn-ghost btn-sm" onClick={() => open(r)}>{t('common.edit')}</button>
                      {meta.statusCol && <button className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm(r[meta.statusCol!.key] === meta.statusCol!.active ? t('admin.confirmDeactivate') : t('admin.confirmActivate'))) void toggle(r); }}>{r[meta.statusCol.key] === meta.statusCol.active ? `⏸ ${t('users.deactivate')}` : `▶ ${t('users.activate')}`}</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</button>
          <span>{page} / {pages}</span>
          <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>→</button>
        </div>
      )}
    </div>
  );
}
