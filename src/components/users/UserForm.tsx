'use client';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api, ApiError } from '@/lib/client-api';
import { Alert, Spinner } from '@/components/ui';
import { ConfirmDialog } from '@/components/Modal';

export interface RoleOpt { code: string; name_en: string; name_ta: string; default_scope: string; rank: number; department_code: string | null }
interface Opts {
  localBodies: { id: number; name_en: string; name_ta: string | null; district_en: string }[];
  departments: { id: number; code: string; name_en: string; name_ta: string | null }[];
  wards: { id: number; ward_number: number; name_en: string | null }[];
  supervisors: { id: string; full_name: string; username: string; role_en: string }[];
  districts: { id: number; name_en: string }[];
  roles: RoleOpt[];
}
export interface EditableUser {
  id: string; username: string; full_name: string; mobile: string; email: string | null; role: string; status: string; designation: string | null;
  employee_id: string | null; department_id: number | null; local_body_id: number | null; ward_id: number | null; supervisor_id: string | null; district_id?: number | null;
}

const SCOPE_NEEDS: Record<string, { lb?: boolean; dept?: boolean; ward?: boolean; district?: boolean }> = {
  SYSTEM: {}, DISTRICT: { district: true }, LOCAL_BODY: { lb: true }, DEPARTMENT: { lb: true, dept: true },
  WARD: { lb: true, ward: true }, ASSIGNED: { lb: true },
};

/** Create / edit an official. All rules are re-validated by the API; this form only guides the admin. */
export function UserForm({ apiBase, user, onDone, onCancel }: { apiBase: string; user?: EditableUser | null; onDone: (r: { id: string; tempPassword?: string | null; username: string }) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const editing = !!user;
  const [f, setF] = useState<Record<string, string>>(() => ({
    role: user?.role ?? '', username: user?.username ?? '', fullName: user?.full_name ?? '', mobile: user?.mobile ?? '', email: user?.email ?? '',
    designation: user?.designation ?? '', employeeId: user?.employee_id ?? '', localBodyId: user?.local_body_id ? String(user.local_body_id) : '',
    departmentId: user?.department_id ? String(user.department_id) : '', wardId: user?.ward_id ? String(user.ward_id) : '',
    supervisorId: user?.supervisor_id ?? '', districtId: user?.district_id ? String(user.district_id) : '', status: user?.status ?? 'ACTIVE',
    pwMode: 'generate', password: '',
  }));
  const [opts, setOpts] = useState<Opts | null>(null);
  const [errs, setErrs] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const L = (en?: string | null, ta?: string | null) => (lang === 'ta' ? ta || en : en || ta) ?? '';

  useEffect(() => {
    api<Opts>(`${apiBase}/options${f.localBodyId ? `?lb=${f.localBodyId}` : ''}`).then((o) => {
      setOpts(o);
      if (!f.localBodyId && o.localBodies.length === 1) set('localBodyId', String(o.localBodies[0].id));
      if (!f.role && o.roles.length) set('role', o.roles[o.roles.length - 1].code);
    }).catch((e) => setMsg(trMsg(t, (e as Error).message)));
  }, [apiBase, f.localBodyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const role = useMemo(() => opts?.roles.find((r) => r.code === f.role), [opts, f.role]);
  const needs = SCOPE_NEEDS[role?.default_scope ?? 'ASSIGNED'] ?? {};
  // Suggest the role's department when the role carries one
  useEffect(() => {
    if (!role?.department_code || f.departmentId || !opts) return;
    const d = opts.departments.find((x) => x.code === role.department_code);
    if (d) set('departmentId', String(d.id));
  }, [role, opts]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleLocked = editing && opts && !opts.roles.some((r) => r.code === user!.role);
  const changedSensitive = editing && (f.role !== user!.role || f.localBodyId !== String(user!.local_body_id ?? '') || f.wardId !== String(user!.ward_id ?? '')
    || f.departmentId !== String(user!.department_id ?? '') || (f.status !== user!.status && f.status === 'INACTIVE'));

  function payload(reason?: string) {
    const n = (v: string) => (v ? Number(v) : null);
    const p: Record<string, unknown> = {
      fullName: f.fullName, mobile: f.mobile, email: f.email || null, designation: f.designation || null, employeeId: f.employeeId || null,
      localBodyId: needs.lb || f.localBodyId ? n(f.localBodyId) : null, departmentId: n(f.departmentId), wardId: n(f.wardId),
      districtId: needs.district ? n(f.districtId) : undefined, supervisorId: f.supervisorId || null, status: f.status,
    };
    if (!roleLocked) p.role = f.role;
    if (!editing) { p.username = f.username; p.password = f.pwMode === 'set' ? f.password : null; }
    if (reason) p.reason = reason;
    return p;
  }

  async function submit(reason?: string) {
    setBusy(true); setErrs({}); setMsg(null);
    try {
      if (editing) {
        await api(`${apiBase}/${user!.id}`, { method: 'PATCH', body: payload(reason) });
        onDone({ id: user!.id, username: user!.username });
      } else {
        const r = await api<{ id: string; tempPassword: string | null }>(apiBase, { body: payload() });
        onDone({ id: r.id, tempPassword: r.tempPassword, username: f.username });
      }
    } catch (e) {
      const err = e as ApiError;
      setErrs((err.details as Record<string, string[]>) ?? {});
      setMsg(trMsg(t, err.message));
    } finally { setBusy(false); setConfirm(false); }
  }

  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label">{label}</span>
      <input className={`input ${errs[k] ? 'border-red-400' : ''}`} value={f[k]} onChange={(e) => set(k, e.target.value)} {...props} />
      {errs[k] && <span className="text-xs text-red-600">{errs[k].map((x) => trMsg(t, x)).join(', ')}</span>}
    </label>
  );
  const select = (k: string, label: string, options: { v: string; l: string }[], required = false, onChange?: (v: string) => void) => (
    <label className="block"><span className="label">{label}{required ? ' *' : ''}</span>
      <select className={`input ${errs[k] ? 'border-red-400' : ''}`} value={f[k]} onChange={(e) => (onChange ? onChange(e.target.value) : set(k, e.target.value))}>
        <option value="">{t('common.select')}</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      {errs[k] && <span className="text-xs text-red-600">{errs[k].map((x) => trMsg(t, x)).join(', ')}</span>}
    </label>
  );

  if (!opts) return <div className="flex justify-center p-6"><Spinner /></div>;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (changedSensitive) setConfirm(true); else void submit(); }}>
      {msg && <Alert tone="error">{msg}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roleLocked ? (
          <label className="block"><span className="label">{t('users.role')}</span><input className="input" disabled value={user!.role} /></label>
        ) : select('role', t('users.role'), opts.roles.map((r) => ({ v: r.code, l: L(r.name_en, r.name_ta) })), true)}
        {field('username', `${t('auth.username')} *`, { disabled: editing, autoComplete: 'off', placeholder: 'e.g. je.chennimalai' })}
        {field('fullName', `${t('reg.fullName')} *`)}
        {field('mobile', `${t('auth.mobile')} *`, { inputMode: 'numeric', maxLength: 10 })}
        {field('email', t('admin.email'), { type: 'email' })}
        {field('designation', t('users.designation'), { placeholder: role ? role.name_en : '' })}
        {field('employeeId', t('users.employeeId'))}
        {needs.district && select('districtId', t('reg.district'), opts.districts.map((d) => ({ v: String(d.id), l: d.name_en })), true)}
        {(needs.lb || f.localBodyId) && select('localBodyId', t('users.localBody'), opts.localBodies.map((l) => ({ v: String(l.id), l: `${L(l.name_en, l.name_ta)} (${l.district_en})` })), !!needs.lb,
          (v) => setF((s) => ({ ...s, localBodyId: v, departmentId: '', wardId: '', supervisorId: '' })))}
        {f.localBodyId && select('departmentId', t('users.department'), opts.departments.map((d) => ({ v: String(d.id), l: L(d.name_en, d.name_ta) })), !!needs.dept)}
        {f.localBodyId && select('wardId', t('users.ward'), opts.wards.map((w) => ({ v: String(w.id), l: `${t('complaint.ward')} ${w.ward_number}${w.name_en ? ` – ${w.name_en}` : ''}` })), !!needs.ward)}
        {f.localBodyId && select('supervisorId', t('users.supervisor'), opts.supervisors.filter((s) => s.id !== user?.id).map((s) => ({ v: s.id, l: `${s.full_name} (${s.role_en})` })))}
        {select('status', t('users.status'), [{ v: 'ACTIVE', l: t('users.ACTIVE') }, { v: 'INACTIVE', l: t('users.INACTIVE') }], true)}
      </div>
      {role && <p className="text-xs text-slate-500">ℹ️ {t('admin.scopeHint')}: <b>{t(`scope.${role.default_scope}` as never)}</b></p>}
      {!editing && (
        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-bold text-slate-700">🔑 {t('admin.initialPassword')}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={f.pwMode === 'generate'} onChange={() => set('pwMode', 'generate')} /> {t('admin.pwGenerate')}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={f.pwMode === 'set'} onChange={() => set('pwMode', 'set')} /> {t('admin.pwSet')}</label>
          </div>
          {f.pwMode === 'set' && <div className="mt-2 max-w-sm">{field('password', t('admin.tempPassword'), { type: 'password', autoComplete: 'new-password' })}<p className="mt-1 text-xs text-slate-500">{t('auth.passwordHint')}</p></div>}
          <p className="mt-2 text-xs text-slate-500">{t('admin.forcedChangeNote')}</p>
        </fieldset>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-outline" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />}{t('common.save')}</button>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={(r) => submit(r)} reasonRequired danger={f.status === 'INACTIVE'}
        title={t('admin.confirmSensitive')} message={t('admin.confirmSensitiveMsg')} />
    </form>
  );
}
