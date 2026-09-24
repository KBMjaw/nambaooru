'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/client-api';
import { fmtDate } from '@/lib/format';
import { Alert, Spinner } from './ui';

interface UserRow {
  id: string; username: string; full_name: string; mobile: string; email: string | null; status: string; created_at: string; last_login_at: string | null; role: string;
  designation: string | null; employee_id: string | null; department_id: number | null; local_body_id: number | null; ward_id: number | null; supervisor_id: string | null;
  jurisdiction: string | null; dept_en: string | null; dept_ta: string | null; lb_en: string | null; lb_ta: string | null; ward_number: number | null; supervisor_name: string | null;
}
interface Opt { id: number | string; name_en?: string; name_ta?: string | null; ward_number?: number; full_name?: string; role?: string; district_en?: string }

const EMPTY = { username: '', fullName: '', mobile: '', email: '', role: '', designation: '', employeeId: '', departmentId: '', localBodyId: '', wardId: '', supervisorId: '', jurisdiction: '' };

export function UserManager({ apiBase, items, manageable, meId, fixedLocalBody, localBodies = [] }: {
  apiBase: string; items: UserRow[]; manageable: string[]; meId: string; fixedLocalBody?: { id: number; name: string } | null; localBodies?: Opt[];
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState('');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [f, setF] = useState<Record<string, string>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'warn'; text: string; pw?: string } | null>(null);
  const [errs, setErrs] = useState<Record<string, string[]>>({});
  const [depts, setDepts] = useState<Opt[]>([]);
  const [wards, setWards] = useState<Opt[]>([]);
  const [sups, setSups] = useState<Opt[]>([]);
  const lbId = fixedLocalBody?.id ? String(fixedLocalBody.id) : f.localBodyId;
  const canManage = manageable.length > 0;
  const L = (en?: string | null, ta?: string | null) => (lang === 'ta' ? ta || en : en || ta) ?? '';

  useEffect(() => {
    setDepts([]); setWards([]); setSups([]);
    if (!lbId) return;
    api<{ items: Opt[] }>(`/api/locations?type=departments&parent=${lbId}`).then((r) => setDepts(r.items)).catch(() => {});
    api<{ items: Opt[] }>(`/api/locations?type=wards&parent=${lbId}`).then((r) => setWards(r.items)).catch(() => {});
    api<{ items: Opt[] }>(`${apiBase}?supervisorsFor=${lbId}`).then((r) => setSups(r.items)).catch(() => {});
  }, [lbId, apiBase]);

  const rows = useMemo(() => items.filter((u) =>
    (!roleF || u.role === roleF) &&
    (!q || [u.full_name, u.username, u.mobile, u.designation ?? ''].some((x) => x.toLowerCase().includes(q.toLowerCase())))), [items, q, roleF]);

  function open(u: UserRow | 'new') {
    setMsg(null); setErrs({});
    setEditing(u);
    setF(u === 'new' ? { ...EMPTY, role: manageable[manageable.length - 1] ?? '' } : {
      username: u.username, fullName: u.full_name, mobile: u.mobile, email: u.email ?? '', role: u.role, designation: u.designation ?? '',
      employeeId: u.employee_id ?? '', departmentId: u.department_id ? String(u.department_id) : '', localBodyId: u.local_body_id ? String(u.local_body_id) : '',
      wardId: u.ward_id ? String(u.ward_id) : '', supervisorId: u.supervisor_id ?? '', jurisdiction: u.jurisdiction ?? '',
    });
  }

  function payload() {
    const n = (v: string) => (v ? Number(v) : null);
    return {
      fullName: f.fullName, mobile: f.mobile, email: f.email, role: f.role, designation: f.designation, employeeId: f.employeeId,
      departmentId: n(f.departmentId), localBodyId: fixedLocalBody ? fixedLocalBody.id : n(f.localBodyId), wardId: n(f.wardId),
      supervisorId: f.supervisorId || null, jurisdiction: f.jurisdiction,
    };
  }

  async function save() {
    setBusy(true); setMsg(null); setErrs({});
    try {
      if (editing === 'new') {
        const r = await api<{ tempPassword: string }>(apiBase, { body: { ...payload(), username: f.username } });
        setMsg({ tone: 'success', text: `${t('users.saved')} — ${t('users.tempPassword')}`, pw: `${f.username} / ${r.tempPassword}` });
      } else if (editing) {
        await api(`${apiBase}/${editing.id}`, { method: 'PATCH', body: payload() });
        setMsg({ tone: 'success', text: t('users.saved') });
      }
      setEditing(null);
      router.refresh();
    } catch (e) {
      const err = e as ApiError;
      setErrs((err.details as Record<string, string[]>) ?? {});
      setMsg({ tone: 'error', text: trMsg(t, err.message) });
    } finally { setBusy(false); }
  }

  async function quick(u: UserRow, body: Record<string, unknown>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setMsg(null);
    try {
      const r = await api<{ tempPassword: string | null }>(`${apiBase}/${u.id}`, { method: 'PATCH', body });
      setMsg(r.tempPassword ? { tone: 'warn', text: t('users.tempPassword'), pw: `${u.username} / ${r.tempPassword}` } : { tone: 'success', text: t('users.saved') });
      router.refresh();
    } catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
  }

  const role = f.role;
  const needs = {
    lb: ['EO', 'SUPERVISOR', 'DEPT_OFFICER', 'FIELD_STAFF', 'WARD_MEMBER'].includes(role),
    dept: ['SUPERVISOR', 'DEPT_OFFICER', 'FIELD_STAFF'].includes(role),
    ward: ['FIELD_STAFF', 'WARD_MEMBER'].includes(role),
    sup: role === 'FIELD_STAFF',
    emp: ['SUPERVISOR', 'DEPT_OFFICER', 'FIELD_STAFF', 'EO'].includes(role),
  };
  const input = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label">{label}</span>
      <input className={`input ${errs[k] ? 'border-red-400' : ''}`} value={f[k]} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} {...props} />
      {errs[k] && <span className="text-xs text-red-600">{errs[k].join(', ')}</span>}
    </label>
  );

  return (
    <div className="space-y-3">
      {msg && (
        <Alert tone={msg.tone}>
          {msg.text}
          {msg.pw && <code className="ml-2 select-all rounded bg-white px-2 py-0.5 font-mono font-bold text-slate-900">{msg.pw}</code>}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder={t('users.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[12rem]" value={roleF} onChange={(e) => setRoleF(e.target.value)}>
          <option value="">{t('users.role')}: {t('common.all')}</option>
          {[...new Set(items.map((i) => i.role))].map((r) => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}
        </select>
        {canManage && <button className="btn btn-primary ml-auto" onClick={() => open('new')}>+ {t('users.create')}</button>}
      </div>

      {editing && (
        <div className="card space-y-3 border-navy-200 p-4">
          <h2 className="font-bold text-navy-800">{editing === 'new' ? t('users.create') : `${t('users.edit')}: ${editing.username}`}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block"><span className="label">{t('users.role')} *</span>
              <select className="input" value={f.role} onChange={(e) => setF((s) => ({ ...s, role: e.target.value }))}>
                {manageable.map((r) => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}
              </select>
            </label>
            {input('username', `${t('auth.username')} *`, { disabled: editing !== 'new', autoComplete: 'off' })}
            {input('fullName', `${t('reg.fullName')} *`)}
            {input('mobile', `${t('auth.mobile')} *`, { inputMode: 'numeric', maxLength: 10 })}
            {input('email', `Email *`, { type: 'email' })}
            {input('designation', `${t('users.designation')}${['SUPERVISOR', 'DEPT_OFFICER', 'EO'].includes(role) ? ' *' : ''}`)}
            {needs.emp && input('employeeId', `${t('users.employeeId')}${role !== 'EO' ? ' *' : ''}`)}
            {needs.lb && (fixedLocalBody ? (
              <label className="block"><span className="label">{t('users.localBody')}</span><input className="input" disabled value={fixedLocalBody.name} /></label>
            ) : (
              <label className="block"><span className="label">{t('users.localBody')} *</span>
                <select className="input" value={f.localBodyId} onChange={(e) => setF((s) => ({ ...s, localBodyId: e.target.value, departmentId: '', wardId: '', supervisorId: '' }))}>
                  <option value="">{t('common.select')}</option>
                  {localBodies.map((l) => <option key={l.id} value={l.id}>{L(l.name_en, l.name_ta)}{l.district_en ? ` (${l.district_en})` : ''}</option>)}
                </select>
              </label>
            ))}
            {needs.dept && (
              <label className="block"><span className="label">{t('users.department')} *</span>
                <select className="input" value={f.departmentId} onChange={(e) => setF((s) => ({ ...s, departmentId: e.target.value }))}>
                  <option value="">{t('common.select')}</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{L(d.name_en, d.name_ta)}</option>)}
                </select>
              </label>
            )}
            {needs.ward && (
              <label className="block"><span className="label">{t('users.ward')} *</span>
                <select className="input" value={f.wardId} onChange={(e) => setF((s) => ({ ...s, wardId: e.target.value }))}>
                  <option value="">{t('common.select')}</option>
                  {wards.map((w) => <option key={w.id} value={w.id}>{t('complaint.ward')} {w.ward_number}</option>)}
                </select>
              </label>
            )}
            {needs.sup && (
              <label className="block"><span className="label">{t('users.supervisor')} *</span>
                <select className="input" value={f.supervisorId} onChange={(e) => setF((s) => ({ ...s, supervisorId: e.target.value }))}>
                  <option value="">{t('common.select')}</option>
                  {sups.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({t(`role.${s.role}` as MessageKey)})</option>)}
                </select>
              </label>
            )}
            {input('jurisdiction', t('users.jurisdiction'))}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <Spinner className="h-4 w-4" />}{t('common.save')}</button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-std">
          <thead><tr>
            <th>{t('reg.fullName')}</th><th>{t('users.role')}</th><th>{t('users.designation')}</th><th>{t('users.jurisdiction')}</th>
            <th>{t('auth.mobile')}</th><th>{t('users.status')}</th><th>{t('users.createdAt')}</th>{canManage && <th>{t('office.actions')}</th>}
          </tr></thead>
          <tbody>
            {rows.map((u) => {
              const managed = manageable.includes(u.role);
              return (
                <tr key={u.id}>
                  <td><div className="font-semibold">{u.full_name}</div><div className="font-mono text-xs text-slate-500">{u.username}{u.employee_id ? ` · ${u.employee_id}` : ''}</div></td>
                  <td className="whitespace-nowrap">{t(`role.${u.role}` as MessageKey)}</td>
                  <td>{u.designation ?? '—'}</td>
                  <td className="text-xs">{[L(u.lb_en, u.lb_ta), L(u.dept_en, u.dept_ta), u.ward_number != null ? `W${u.ward_number}` : null, u.supervisor_name ? `↑ ${u.supervisor_name}` : null].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="font-mono text-xs">{u.mobile}<div className="text-slate-400">{u.email}</div></td>
                  <td><span className={`badge ${u.status === 'ACTIVE' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-600'}`}>{t(`users.${u.status}` as MessageKey)}</span></td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(u.created_at, lang)}</td>
                  {canManage && (
                    <td className="whitespace-nowrap">
                      {managed ? (
                        <div className="flex gap-1">
                          <button className="btn btn-ghost btn-sm" onClick={() => open(u)}>{t('common.edit')}</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => quick(u, { resetPassword: true }, `${t('users.resetPassword')}: ${u.username}?`)}>🔑</button>
                          {u.id !== meId && (u.status === 'ACTIVE'
                            ? <button className="btn btn-ghost btn-sm text-red-600" onClick={() => quick(u, { status: 'INACTIVE' }, `${t('users.deactivate')}: ${u.username}?`)}>{t('users.deactivate')}</button>
                            : <button className="btn btn-ghost btn-sm text-leaf-700" onClick={() => quick(u, { status: 'ACTIVE' }, `${t('users.activate')}: ${u.username}?`)}>{t('users.activate')}</button>)}
                        </div>
                      ) : <span className="text-xs text-slate-400">🔒 {t('users.protected')}</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
