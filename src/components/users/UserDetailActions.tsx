'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert } from '@/components/ui';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { UserForm, type EditableUser } from './UserForm';
import { TempPasswordBox } from './NewUserButton';

/** Edit / reset password / deactivate buttons on the user profile. Every call is re-authorised by the API. */
export function UserDetailActions({ apiBase, user, canEdit, canReset, isSelf }: { apiBase: string; user: EditableUser; canEdit: boolean; canReset: boolean; isSelf: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [dlg, setDlg] = useState<'edit' | 'reset' | 'status' | null>(null);
  const [pwMode, setPwMode] = useState<'generate' | 'set'>('generate');
  const [pw, setPw] = useState('');
  const [temp, setTemp] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const active = user.status === 'ACTIVE';

  async function run(fn: () => Promise<void>) {
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); setDlg(null); }
  }
  return (
    <div className="space-y-2">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {temp && <TempPasswordBox username={user.username} pw={temp} />}
      <div className="flex flex-wrap gap-2">
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setDlg('edit')}>✏️ {t('common.edit')}</button>}
        {canReset && !isSelf && <button className="btn btn-outline btn-sm" onClick={() => { setPw(''); setPwMode('generate'); setDlg('reset'); }}>🔑 {t('users.resetPassword')}</button>}
        {canEdit && !isSelf && (active
          ? <button className="btn btn-danger btn-sm" onClick={() => setDlg('status')}>⏸ {t('users.deactivate')}</button>
          : <button className="btn btn-outline btn-sm text-leaf-700" onClick={() => setDlg('status')}>▶ {t('users.activate')}</button>)}
      </div>

      <Modal open={dlg === 'edit'} onClose={() => setDlg(null)} title={`${t('users.edit')}: ${user.username}`} wide>
        <UserForm apiBase={apiBase} user={user} onCancel={() => setDlg(null)}
          onDone={() => { setDlg(null); setMsg({ tone: 'success', text: t('users.saved') }); router.refresh(); }} />
      </Modal>

      <ConfirmDialog open={dlg === 'reset'} onClose={() => setDlg(null)} reasonRequired title={`🔑 ${t('users.resetPassword')}: ${user.username}`}
        message={t('admin.resetMsg')} confirmLabel={t('users.resetPassword')}
        onConfirm={(reason) => run(async () => {
          const r = await api<{ tempPassword: string | null }>(`${apiBase}/${user.id}/password`, { body: { reason, password: pwMode === 'set' ? pw : null } });
          setDlg(null); setTemp(r.tempPassword);
          setMsg({ tone: 'success', text: t('admin.resetDone') });
          router.refresh();
        })}>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={pwMode === 'generate'} onChange={() => setPwMode('generate')} /> {t('admin.pwGenerate')}</label>
          <label className="flex items-center gap-2"><input type="radio" checked={pwMode === 'set'} onChange={() => setPwMode('set')} /> {t('admin.pwSet')}</label>
          {pwMode === 'set' && <input type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('admin.tempPassword')} />}
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={dlg === 'status'} onClose={() => setDlg(null)} reasonRequired={active} danger={active}
        title={active ? `${t('users.deactivate')}: ${user.username}` : `${t('users.activate')}: ${user.username}`}
        message={active ? t('admin.deactivateMsg') : t('admin.reactivateMsg')} confirmLabel={active ? t('users.deactivate') : t('users.activate')}
        onConfirm={(reason) => run(async () => {
          await api(`${apiBase}/${user.id}`, { method: 'PATCH', body: { status: active ? 'INACTIVE' : 'ACTIVE', reason: reason || null } });
          setDlg(null); setMsg({ tone: 'success', text: t('users.saved') }); router.refresh();
        })} />
    </div>
  );
}

/** Add an extra jurisdiction or revoke one (reason required, audited as JURISDICTION_CHANGED). */
export function JurisdictionEditor({ apiBase, userId, localBodies, districts, canEdit, active }: {
  apiBase: string; userId: string; canEdit: boolean;
  localBodies: { id: number; name: string }[]; districts: { id: number; name: string }[];
  active: { id: number; label: string; primary: boolean }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [lb, setLb] = useState('');
  const [district, setDistrict] = useState('');
  const [ward, setWard] = useState('');
  const [dept, setDept] = useState('');
  const [wards, setWards] = useState<{ id: number; ward_number: number }[]>([]);
  const [depts, setDepts] = useState<{ id: number; name_en: string }[]>([]);
  const [confirm, setConfirm] = useState<{ op: 'add' } | { op: 'revoke'; id: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function pickLb(v: string) {
    setLb(v); setWard(''); setDept(''); setWards([]); setDepts([]);
    if (!v) return;
    const o = await api<{ wards: typeof wards; departments: typeof depts }>(`${apiBase}/options?lb=${v}`);
    setWards(o.wards); setDepts(o.departments);
  }
  return (
    <div className="space-y-2">
      {err && <Alert tone="error">{err}</Alert>}
      <ul className="space-y-1 text-sm">
        {active.map((j) => (
          <li key={j.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <span>{j.primary ? '⭐ ' : '➕ '}{j.label}</span>
            {canEdit && !j.primary && <button className="btn btn-ghost btn-sm text-red-600" onClick={() => setConfirm({ op: 'revoke', id: j.id })}>{t('admin.revoke')}</button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="grid gap-2 rounded-xl border border-dashed border-slate-300 p-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {districts.length > 0 && (
            <select className="input" value={district} onChange={(e) => { setDistrict(e.target.value); setLb(''); }} aria-label={t('reg.district')}>
              <option value="">{t('reg.district')}…</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select className="input" value={lb} onChange={(e) => void pickLb(e.target.value)} aria-label={t('users.localBody')}>
            <option value="">{t('users.localBody')}…</option>{localBodies.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select className="input" value={ward} onChange={(e) => setWard(e.target.value)} disabled={!lb} aria-label={t('users.ward')}>
            <option value="">{t('users.ward')}: {t('common.all')}</option>{wards.map((w) => <option key={w.id} value={w.id}>{t('complaint.ward')} {w.ward_number}</option>)}
          </select>
          <select className="input" value={dept} onChange={(e) => setDept(e.target.value)} disabled={!lb} aria-label={t('users.department')}>
            <option value="">{t('users.department')}: {t('common.all')}</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name_en}</option>)}
          </select>
          <button className="btn btn-outline" disabled={!lb && !district} onClick={() => setConfirm({ op: 'add' })}>+ {t('admin.addJurisdiction')}</button>
        </div>
      )}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} reasonRequired danger={confirm?.op === 'revoke'}
        title={confirm?.op === 'revoke' ? t('admin.revokeJurisdiction') : t('admin.addJurisdiction')} message={t('admin.jurisdictionMsg')}
        onConfirm={async (reason) => {
          setErr(null);
          try {
            const bodyIn = confirm?.op === 'revoke' ? { op: 'revoke', jurisdictionId: confirm.id, reason }
              : { districtId: district || null, localBodyId: lb || null, wardId: ward || null, departmentId: dept || null, reason };
            await api(`${apiBase}/${userId}/jurisdictions`, { body: bodyIn });
            setConfirm(null); setLb(''); setWard(''); setDept(''); router.refresh();
          } catch (e) { setErr(trMsg(t, (e as Error).message)); setConfirm(null); }
        }} />
    </div>
  );
}

/** Per-user GRANT / DENY overrides on top of the role (reason required, audited as PERMISSION_CHANGED). */
export function PermissionOverrides({ apiBase, userId, perms }: { apiBase: string; userId: string; perms: { code: string; label: string | null; from_role: boolean; override: string | null; is_security: boolean }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState<{ code: string; effect: 'GRANT' | 'DENY' | 'NONE' } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {err && <Alert tone="error">{err}</Alert>}
      <div className="max-h-96 overflow-y-auto">
        <table className="table-std text-xs">
          <thead><tr><th>{t('admin.permission')}</th><th>{t('admin.fromRole')}</th><th>{t('admin.override')}</th><th>{t('admin.effective')}</th></tr></thead>
          <tbody>
            {perms.map((p) => {
              const eff = (p.from_role && p.override !== 'DENY') || p.override === 'GRANT';
              return (
                <tr key={p.code}>
                  <td><b>{p.label ?? p.code}</b><div className="text-slate-400">{p.code}</div></td>
                  <td>{p.from_role ? '✓' : '—'}</td>
                  <td>
                    <select className="input py-1 text-xs" value={p.override ?? 'NONE'} onChange={(e) => setPending({ code: p.code, effect: e.target.value as 'GRANT' | 'DENY' | 'NONE' })}>
                      <option value="NONE">—</option><option value="GRANT">GRANT</option><option value="DENY">DENY</option>
                    </select>
                  </td>
                  <td>{eff ? <span className="badge bg-leaf-100 text-leaf-800">✓</span> : <span className="text-slate-300">✕</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={!!pending} onClose={() => setPending(null)} reasonRequired title={t('admin.changePermission')}
        message={pending ? `${pending.code} → ${pending.effect}` : ''}
        onConfirm={async (reason) => {
          setErr(null);
          try { await api(`${apiBase}/${userId}/permissions`, { body: { permission: pending!.code, effect: pending!.effect, reason } }); setPending(null); router.refresh(); }
          catch (e) { setErr(trMsg(t, (e as Error).message)); setPending(null); }
        }} />
    </div>
  );
}
