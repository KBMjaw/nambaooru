'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/ui';
import { UserForm } from './UserForm';

/** "+ Create user" → modal form → one-time temporary password panel. Opens automatically with ?new=1 (from the + Add menu). */
export function NewUserButton({ apiBase, basePath }: { apiBase: string; basePath: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ id: string; username: string; tempPassword?: string | null } | null>(null);
  useEffect(() => { if (sp.get('new') === '1') setOpen(true); }, [sp]);
  return (
    <>
      <button className="btn btn-primary" onClick={() => { setDone(null); setOpen(true); }}>+ {t('users.create')}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('users.create')} wide>
        {done ? (
          <div className="space-y-3">
            <Alert tone="success">✅ {t('users.saved')}: <b>{done.username}</b></Alert>
            {done.tempPassword ? <TempPasswordBox username={done.username} pw={done.tempPassword} /> : <p className="text-sm text-slate-600">{t('admin.forcedChangeNote')}</p>}
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => { setDone(null); }}>+ {t('users.create')}</button>
              <button className="btn btn-primary" onClick={() => router.push(`${basePath}/${done.id}`)}>{t('admin.openProfile')} →</button>
            </div>
          </div>
        ) : (
          <UserForm apiBase={apiBase} onCancel={() => setOpen(false)} onDone={(r) => { setDone(r); router.refresh(); }} />
        )}
      </Modal>
    </>
  );
}

/** Shows a generated temporary password exactly once. It is never stored in plain text and must be changed at first login. */
export function TempPasswordBox({ username, pw }: { username: string; pw: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-bold text-amber-900">🔑 {t('users.tempPassword')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="select-all rounded bg-white px-2 py-1 font-mono text-base font-bold text-slate-900">{username} / {pw}</code>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(pw); setCopied(true); }}>{copied ? '✓' : t('admin.copy')}</button>
      </div>
      <p className="mt-2 text-xs text-amber-900">{t('admin.forcedChangeNote')}</p>
    </div>
  );
}
