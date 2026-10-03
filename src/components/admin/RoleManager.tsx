'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api, ApiError } from '@/lib/client-api';
import { Alert, Spinner } from '@/components/ui';
import { Modal } from '@/components/Modal';

export interface RoleRowUI {
  id: number; code: string; name_en: string; name_ta: string; description: string | null; department_code: string | null; default_scope: string;
  rank: number; status: string; is_system: boolean; portal: string; active_users: number; permissions: string[]; editable: boolean;
}
export interface PermUI { code: string; label: string | null; description: string; perm_group: string | null; is_security: boolean }

const SCOPES = ['LOCAL_BODY', 'DEPARTMENT', 'WARD', 'ASSIGNED', 'DISTRICT'] as const;
const LEVELS = [75, 60, 50, 40, 30];
const CITIZEN_ONLY = ['complaint.create', 'complaint.view.own', 'appeal.create'];

/** Dynamic user types / roles: create and edit operational roles and their permissions (no code changes needed). */
export function RoleManager({ roles, perms, departments, myRank, isSuper }: { roles: RoleRowUI[]; perms: PermUI[]; departments: { code: string; name_en: string }[]; myRank: number; isSuper: boolean }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const sp = useSearchParams();
  const [edit, setEdit] = useState<RoleRowUI | 'new' | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { if (sp.get('new') === '1') setEdit('new'); }, [sp]);
  const L = (en?: string | null, ta?: string | null) => (lang === 'ta' ? ta || en : en || ta) ?? '';
  const list = roles.filter((r) => !q || `${r.name_en} ${r.code} ${r.description ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary ml-auto" onClick={() => setEdit('new')}>+ {t('admin.addRole')}</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table-std">
          <thead><tr><th>{t('admin.roleName')}</th><th>{t('admin.scope')}</th><th>{t('admin.level')}</th><th>{t('users.department')}</th><th>{t('admin.permissions')}</th><th>{t('nav.users')}</th><th>{t('users.status')}</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td><b>{L(r.name_en, r.name_ta)}</b> {r.is_system ? <span className="badge bg-slate-100 text-slate-500">{t('admin.builtIn')}</span> : <span className="badge bg-violet-100 text-violet-800">{t('admin.custom')}</span>}
                  <div className="font-mono text-xs text-slate-400">{r.code}</div>{r.description && <div className="text-xs text-slate-500">{r.description}</div>}</td>
                <td className="text-xs">{t(`scope.${r.default_scope}` as never)}</td>
                <td>{r.rank}</td>
                <td className="text-xs">{r.department_code ?? '—'}</td>
                <td>{r.permissions.length}</td>
                <td>{r.active_users}</td>
                <td><span className={`badge ${r.status === 'ACTIVE' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-600'}`}>{t(`users.${r.status}` as never)}</span></td>
                <td>{r.editable ? <button className="btn btn-ghost btn-sm" onClick={() => setEdit(r)}>{t('common.edit')}</button> : <span className="text-xs text-slate-400">🔒</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('admin.addRole') : `${t('common.edit')}: ${edit ? (edit as RoleRowUI).name_en : ''}`} wide>
        {edit && <RoleForm role={edit === 'new' ? null : edit} perms={perms} departments={departments} myRank={myRank} isSuper={isSuper}
          onCancel={() => setEdit(null)} onDone={() => { setEdit(null); router.refresh(); }} />}
      </Modal>
    </div>
  );
}

function RoleForm({ role, perms, departments, myRank, isSuper, onDone, onCancel }: { role: RoleRowUI | null; perms: PermUI[]; departments: { code: string; name_en: string }[]; myRank: number; isSuper: boolean; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    name_en: role?.name_en ?? '', name_ta: role?.name_ta ?? '', description: role?.description ?? '', department_code: role?.department_code ?? '',
    default_scope: role?.default_scope ?? 'ASSIGNED', rank: String(role?.rank ?? 30), status: role?.status ?? 'ACTIVE', reason: '',
  });
  const [sel, setSel] = useState<Set<string>>(new Set(role?.permissions ?? ['complaint.view.assigned', 'complaint.work', 'evidence.upload']));
  const [err, setErr] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const builtIn = !!role?.is_system;
  const available = useMemo(() => perms.filter((p) => !CITIZEN_ONLY.includes(p.code) && (!p.is_security || (isSuper && role?.code === 'SUPER_ADMIN'))), [perms, isSuper, role]);
  const groups = [...new Set(available.map((p) => p.perm_group ?? 'Other'))];
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  async function save() {
    setBusy(true); setErr(null); setErrs({});
    const body: Record<string, unknown> = { name_en: f.name_en, name_ta: f.name_ta || null, description: f.description || null, department_code: f.department_code || null, status: f.status, permissions: [...sel], reason: f.reason || null };
    if (!builtIn) { body.default_scope = f.default_scope; body.rank = Number(f.rank); }
    try {
      if (role) await api(`/api/admin/roles/${role.id}`, { method: 'PATCH', body });
      else await api('/api/admin/roles', { body });
      onDone();
    } catch (e) { const x = e as ApiError; setErr(trMsg(t, x.message)); setErrs((x.details as Record<string, string[]>) ?? {}); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      {err && <Alert tone="error">{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">{t('admin.roleName')} (EN) *</span><input className={`input ${errs.name_en ? 'border-red-400' : ''}`} value={f.name_en} onChange={(e) => set('name_en', e.target.value)} placeholder="e.g. Junior Engineer (JE)" /></label>
        <label className="block"><span className="label">{t('admin.roleName')} (த)</span><input className="input" value={f.name_ta} onChange={(e) => set('name_ta', e.target.value)} placeholder="இளநிலைப் பொறியாளர்" /></label>
        <label className="block sm:col-span-2"><span className="label">{t('admin.roleDescription')}</span><input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="block"><span className="label">{t('users.department')}</span>
          <select className="input" value={f.department_code} onChange={(e) => set('department_code', e.target.value)}>
            <option value="">—</option>{departments.map((d) => <option key={d.code} value={d.code}>{d.name_en}</option>)}
          </select></label>
        <label className="block"><span className="label">{t('admin.defaultScope')}</span>
          <select className="input" value={f.default_scope} disabled={builtIn} onChange={(e) => set('default_scope', e.target.value)}>
            {(builtIn ? [f.default_scope] : SCOPES.filter((s) => s !== 'DISTRICT' || myRank >= 90)).map((s) => <option key={s} value={s}>{t(`scope.${s}` as never)}</option>)}
          </select></label>
        <label className="block"><span className="label">{t('admin.level')}</span>
          <select className="input" value={f.rank} disabled={builtIn} onChange={(e) => set('rank', e.target.value)}>
            {(builtIn ? [Number(f.rank)] : LEVELS.filter((l) => l < myRank)).map((l) => <option key={l} value={l}>{t(`level.${l}` as never) || l} ({l})</option>)}
          </select></label>
        <label className="block"><span className="label">{t('users.status')}</span>
          <select className="input" value={f.status} disabled={builtIn} onChange={(e) => set('status', e.target.value)}>
            <option value="ACTIVE">{t('users.ACTIVE')}</option><option value="INACTIVE">{t('users.INACTIVE')}</option>
          </select></label>
      </div>
      <div>
        <p className="label">{t('admin.permissions')} ({sel.size})</p>
        <p className="mb-2 text-xs text-slate-500">{t('admin.permNote')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g} className="rounded-xl border border-slate-200 p-2.5">
              <legend className="px-1 text-xs font-bold text-slate-600">{g}</legend>
              {available.filter((p) => (p.perm_group ?? 'Other') === g).map((p) => (
                <label key={p.code} className="flex items-start gap-2 py-0.5 text-sm" title={p.description}>
                  <input type="checkbox" className="mt-1" checked={sel.has(p.code)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.code); else n.delete(p.code); return n; })} />
                  <span><b className="text-xs">{p.label ?? p.code}</b><span className="block text-xs text-slate-500">{p.description}</span></span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </div>
      {role && <label className="block"><span className="label">{t('admin.reason')}</span><input className="input" value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder={t('admin.reasonPh')} /></label>}
      <div className="flex gap-2">
        <button className="btn btn-outline" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy || f.name_en.trim().length < 2} onClick={save}>{busy && <Spinner className="h-4 w-4" />}{t('common.save')}</button>
      </div>
    </div>
  );
}
