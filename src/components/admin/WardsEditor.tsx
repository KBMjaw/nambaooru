'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert, Spinner } from '@/components/ui';

export interface WardRow {
  id: number; ward_number: number; name_en: string | null; name_ta: string | null; population: number | null; description: string | null;
  street_count: number | null; status: string; streets_defined: number; complaints: number; features: number;
}

/** Inline editing of every ward of a local body + "add N wards". Each ward links to its detail / map page. */
export function WardsEditor({ localBodyId, wards, portal, canEdit, mapBase }: { localBodyId: number; wards: WardRow[]; portal: 'ADMIN' | 'OFFICE'; canEdit: boolean; mapBase: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState(wards.map((w) => ({ ...w, dirty: false })));
  const [add, setAdd] = useState('1');
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const upd = (id: number, k: string, v: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v, dirty: true } : r)));

  async function save(r: (typeof rows)[number]) {
    setBusy(r.id); setMsg(null);
    try {
      await api(`/api/wards/${r.id}?portal=${portal}`, { method: 'PATCH', body: { nameEn: r.name_en || null, nameTa: r.name_ta || null, population: r.population ?? '', description: r.description || null, streetCount: r.street_count ?? '', status: r.status } });
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, dirty: false } : x)));
      setMsg({ tone: 'success', text: `${t('complaint.ward')} ${r.ward_number}: ${t('profile.saved')}` });
    } catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
    finally { setBusy(null); }
  }
  async function addWards() {
    setBusy('add'); setMsg(null);
    try { await api(`/api/wards?portal=${portal}`, { body: { localBodyId, count: Number(add) } }); router.refresh(); window.location.reload(); }
    catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); setBusy(null); }
  }
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="label">{t('admin.addWardsCount')}</span><input className="input w-28" type="number" min={1} max={300} value={add} onChange={(e) => setAdd(e.target.value)} /></label>
          <button className="btn btn-outline" onClick={addWards} disabled={busy === 'add'}>{busy === 'add' && <Spinner className="h-4 w-4" />}+ {t('admin.addWard')}</button>
          <p className="text-xs text-slate-500">{t('admin.addWardsNote')}</p>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="table-std text-sm">
          <thead><tr><th>{t('complaint.ward')}</th><th>{t('admin.wardName')}</th><th>{t('admin.population')}</th><th>{t('admin.description')}</th><th>{t('admin.streetCount')}</th><th>{t('users.status')}</th><th>{t('nav.complaints')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-bold"><Link className="text-navy-700 underline" href={`${mapBase}/${r.id}`}>{r.ward_number}</Link></td>
                <td><input className="input min-w-36 py-1" disabled={!canEdit} value={r.name_en ?? ''} onChange={(e) => upd(r.id, 'name_en', e.target.value)} placeholder="EN" />
                  <input className="input mt-1 min-w-36 py-1" disabled={!canEdit} value={r.name_ta ?? ''} onChange={(e) => upd(r.id, 'name_ta', e.target.value)} placeholder="த" /></td>
                <td><input className="input w-28 py-1" type="number" min={0} disabled={!canEdit} value={r.population ?? ''} onChange={(e) => upd(r.id, 'population', e.target.value)} /></td>
                <td><textarea className="input min-w-48 py-1" rows={2} disabled={!canEdit} value={r.description ?? ''} onChange={(e) => upd(r.id, 'description', e.target.value)} /></td>
                <td><input className="input w-20 py-1" type="number" min={0} disabled={!canEdit} value={r.street_count ?? ''} onChange={(e) => upd(r.id, 'street_count', e.target.value)} />
                  <div className="text-[10px] text-slate-400">{r.streets_defined} {t('admin.defined')}</div></td>
                <td><select className="input py-1" disabled={!canEdit} value={r.status} onChange={(e) => upd(r.id, 'status', e.target.value)}><option value="ACTIVE">{t('users.ACTIVE')}</option><option value="INACTIVE">{t('users.INACTIVE')}</option></select></td>
                <td>{r.complaints}</td>
                <td className="whitespace-nowrap">
                  {canEdit && <button className="btn btn-primary btn-sm" disabled={!r.dirty || busy === r.id} onClick={() => save(r)}>{busy === r.id ? <Spinner className="h-4 w-4" /> : t('common.save')}</button>}
                  <Link className="btn btn-ghost btn-sm" href={`${mapBase}/${r.id}`}>🗺️ {r.features}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
