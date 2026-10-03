'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api, ApiError } from '@/lib/client-api';
import { Alert, Spinner } from '@/components/ui';

export interface CitizenEditable {
  id: string; full_name: string; mobile: string; email: string | null; local_body_id: number | null; ward_id: number | null; street_id: number | null;
  street_text: string | null; pincode: string | null; landmark: string | null; address: string; status: string;
}

/** Add / edit a citizen. Location lists come from the database; the API re-checks jurisdiction. */
export function CitizenForm({ portal, citizen, onDone, onCancel }: {
  portal: 'ADMIN' | 'OFFICE'; citizen?: CitizenEditable | null; onDone: (r: { id: string; username?: string; tempPassword?: string | null }) => void; onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const base = portal === 'ADMIN' ? '/api/admin' : '/api/office';
  const editing = !!citizen;
  const [f, setF] = useState<Record<string, string>>({
    fullName: citizen?.full_name ?? '', mobile: citizen && !citizen.mobile.includes('*') ? citizen.mobile : '', email: citizen?.email && !citizen.email.includes('•') ? citizen.email : '',
    username: '', localBodyId: citizen?.local_body_id ? String(citizen.local_body_id) : '', wardId: citizen?.ward_id ? String(citizen.ward_id) : '',
    streetId: citizen?.street_id ? String(citizen.street_id) : '', streetText: citizen?.street_text ?? '', pincode: citizen?.pincode ?? '',
    address: citizen?.address ?? '', landmark: citizen?.landmark ?? '', status: citizen?.status ?? 'ACTIVE', pwMode: 'generate', password: '',
  });
  const [lbs, setLbs] = useState<{ id: number; name_en: string; name_ta: string | null; district_en: string }[]>([]);
  const [wards, setWards] = useState<{ id: number; ward_number: number }[]>([]);
  const [streets, setStreets] = useState<{ id: number; name_en: string; name_ta: string | null }[]>([]);
  const [errs, setErrs] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const L = (en?: string | null, ta?: string | null) => (lang === 'ta' ? ta || en : en || ta) ?? '';

  useEffect(() => { api<{ localBodies: typeof lbs }>(`${base}/users/options`).then((o) => { setLbs(o.localBodies); if (!f.localBodyId && o.localBodies.length === 1) set('localBodyId', String(o.localBodies[0].id)); }).catch(() => {}); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWards([]); if (f.localBodyId) api<{ items: typeof wards }>(`/api/locations?type=wards&parent=${f.localBodyId}`).then((r) => setWards(r.items)).catch(() => {}); }, [f.localBodyId]);
  useEffect(() => { setStreets([]); if (f.wardId) api<{ items: typeof streets }>(`/api/locations?type=streets&parent=${f.wardId}`).then((r) => setStreets(r.items)).catch(() => {}); }, [f.wardId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({}); setMsg(null);
    const n = (v: string) => (v ? Number(v) : null);
    const p: Record<string, unknown> = {
      fullName: f.fullName, email: f.email || null, localBodyId: n(f.localBodyId), wardId: n(f.wardId), streetId: n(f.streetId), streetText: f.streetText || null,
      pincode: f.pincode || null, landmark: f.landmark || null,
    };
    if (!editing) p.status = f.status;
    if (f.mobile) p.mobile = f.mobile;
    if (f.address || !editing) p.address = f.address || null;
    try {
      if (editing) { await api(`${base}/citizens/${citizen!.id}`, { method: 'PATCH', body: p }); onDone({ id: citizen!.id }); }
      else {
        const r = await api<{ id: string; username: string; tempPassword: string | null }>(`${base}/citizens`, { body: { ...p, username: f.username || null, password: f.pwMode === 'set' ? f.password : null } });
        onDone(r);
      }
    } catch (x) { const err = x as ApiError; setErrs((err.details as Record<string, string[]>) ?? {}); setMsg(trMsg(t, err.message)); }
    finally { setBusy(false); }
  }
  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label">{label}</span>
      <input className={`input ${errs[k] ? 'border-red-400' : ''}`} value={f[k]} onChange={(e) => set(k, e.target.value)} {...props} />
      {errs[k] && <span className="text-xs text-red-600">{errs[k].map((x) => trMsg(t, x)).join(', ')}</span>}
    </label>
  );
  return (
    <form className="space-y-3" onSubmit={submit}>
      {msg && <Alert tone="error">{msg}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field('fullName', `${t('reg.fullName')} *`)}
        {field('mobile', `${t('auth.mobile')}${editing ? '' : ' *'}`, { inputMode: 'numeric', maxLength: 10, placeholder: editing ? citizen!.mobile : '' })}
        {field('email', t('admin.email'), { type: 'email' })}
        {!editing && field('username', t('admin.usernameOptional'), { placeholder: f.mobile ? `c${f.mobile}` : 'c9xxxxxxxxx', autoComplete: 'off' })}
        <label className="block"><span className="label">{t('users.localBody')} *</span>
          <select className="input" value={f.localBodyId} onChange={(e) => setF((s) => ({ ...s, localBodyId: e.target.value, wardId: '', streetId: '' }))}>
            <option value="">{t('common.select')}</option>
            {lbs.map((l) => <option key={l.id} value={l.id}>{L(l.name_en, l.name_ta)} ({l.district_en})</option>)}
          </select></label>
        <label className="block"><span className="label">{t('reg.ward')}</span>
          <select className="input" value={f.wardId} onChange={(e) => setF((s) => ({ ...s, wardId: e.target.value, streetId: '' }))} disabled={!f.localBodyId}>
            <option value="">{t('common.select')}</option>
            {wards.map((w) => <option key={w.id} value={w.id}>{t('complaint.ward')} {w.ward_number}</option>)}
          </select></label>
        <label className="block"><span className="label">{t('reg.street')}</span>
          <select className="input" value={f.streetId} onChange={(e) => set('streetId', e.target.value)} disabled={!f.wardId}>
            <option value="">{streets.length ? t('common.select') : '—'}</option>
            {streets.map((s) => <option key={s.id} value={s.id}>{L(s.name_en, s.name_ta)}</option>)}
          </select></label>
        {!f.streetId && field('streetText', t('admin.streetText'))}
        {field('pincode', t('reg.pincode'), { inputMode: 'numeric', maxLength: 6 })}
        {field('address', `${t('reg.door')}${editing ? ` (${t('admin.leaveBlank')})` : ''}`)}
        {field('landmark', t('reg.landmark'))}
        {!editing && <label className="block"><span className="label">{t('users.status')}</span>
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="ACTIVE">{t('users.ACTIVE')}</option><option value="INACTIVE">{t('users.INACTIVE')}</option>
          </select></label>}
      </div>
      {!editing && (
        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-bold text-slate-700">🔑 {t('admin.initialPassword')}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={f.pwMode === 'generate'} onChange={() => set('pwMode', 'generate')} /> {t('admin.pwGenerate')}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={f.pwMode === 'set'} onChange={() => set('pwMode', 'set')} /> {t('admin.pwSet')}</label>
          </div>
          {f.pwMode === 'set' && <div className="mt-2 max-w-sm">{field('password', t('admin.tempPassword'), { type: 'password', autoComplete: 'new-password' })}</div>}
          <p className="mt-2 text-xs text-slate-500">{t('admin.citizenLoginNote')}</p>
        </fieldset>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-outline" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />}{t('common.save')}</button>
      </div>
    </form>
  );
}
