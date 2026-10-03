'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert } from '@/components/ui';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { TempPasswordBox } from '@/components/users/NewUserButton';
import { CitizenForm, type CitizenEditable } from './CitizenForm';

export function NewCitizenButton({ portal }: { portal: 'ADMIN' | 'OFFICE' }) {
  const { t } = useI18n();
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ id: string; username?: string; tempPassword?: string | null } | null>(null);
  const base = portal === 'ADMIN' ? '/admin/citizens' : '/office/citizens';
  useEffect(() => { if (sp.get('new') === '1') setOpen(true); }, [sp]);
  return (
    <>
      <button className="btn btn-primary" onClick={() => { setDone(null); setOpen(true); }}>+ {t('admin.addCitizen')}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('admin.addCitizen')} wide>
        {done ? (
          <div className="space-y-3">
            <Alert tone="success">✅ {t('users.saved')}</Alert>
            {done.tempPassword && <TempPasswordBox username={done.username ?? ''} pw={done.tempPassword} />}
            <button className="btn btn-primary" onClick={() => router.push(`${base}/${done.id}`)}>{t('admin.openProfile')} →</button>
          </div>
        ) : <CitizenForm portal={portal} onCancel={() => setOpen(false)} onDone={(r) => { setDone(r); router.refresh(); }} />}
      </Modal>
    </>
  );
}

export function CitizenActions({ portal, citizen, canManage, canReset }: { portal: 'ADMIN' | 'OFFICE'; citizen: CitizenEditable & { username: string }; canManage: boolean; canReset: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const api0 = portal === 'ADMIN' ? '/api/admin/citizens' : '/api/office/citizens';
  const [dlg, setDlg] = useState<'edit' | 'reset' | 'status' | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const active = citizen.status === 'ACTIVE';
  const run = async (fn: () => Promise<void>) => { setMsg(null); try { await fn(); } catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); setDlg(null); } };
  return (
    <div className="space-y-2">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {temp && <TempPasswordBox username={citizen.username} pw={temp} />}
      <div className="flex flex-wrap gap-2">
        {canManage && <button className="btn btn-primary btn-sm" onClick={() => setDlg('edit')}>✏️ {t('common.edit')}</button>}
        {canReset && <button className="btn btn-outline btn-sm" onClick={() => setDlg('reset')}>🔑 {t('users.resetPassword')}</button>}
        {canManage && (active ? <button className="btn btn-danger btn-sm" onClick={() => setDlg('status')}>⏸ {t('users.deactivate')}</button>
          : <button className="btn btn-outline btn-sm" onClick={() => setDlg('status')}>▶ {t('users.activate')}</button>)}
      </div>
      <Modal open={dlg === 'edit'} onClose={() => setDlg(null)} title={`${t('common.edit')}: ${citizen.full_name}`} wide>
        <CitizenForm portal={portal} citizen={citizen} onCancel={() => setDlg(null)} onDone={() => { setDlg(null); setMsg({ tone: 'success', text: t('users.saved') }); router.refresh(); }} />
      </Modal>
      <ConfirmDialog open={dlg === 'reset'} onClose={() => setDlg(null)} reasonRequired title={`🔑 ${t('users.resetPassword')}`} message={t('admin.resetMsg')}
        onConfirm={(reason) => run(async () => { const r = await api<{ tempPassword: string | null }>(`${api0}/${citizen.id}/password`, { body: { reason } }); setDlg(null); setTemp(r.tempPassword); })} />
      <ConfirmDialog open={dlg === 'status'} onClose={() => setDlg(null)} reasonRequired={active} danger={active}
        title={active ? t('users.deactivate') : t('users.activate')} message={active ? t('admin.deactivateMsg') : t('admin.reactivateMsg')}
        onConfirm={(reason) => run(async () => { await api(`${api0}/${citizen.id}`, { method: 'PATCH', body: { status: active ? 'INACTIVE' : 'ACTIVE', reason: reason || null } }); setDlg(null); router.refresh(); })} />
    </div>
  );
}
