'use client';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert } from './ui';

export function PasswordForm({ portal }: { portal: 'PUBLIC' | 'OFFICE' | 'ADMIN' }) {
  const { t } = useI18n();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!(pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw))) return setMsg({ tone: 'error', text: t('err.password') });
      try { await api(`/api/profile?portal=${portal}`, { body: { currentPassword: cur, newPassword: pw } }); setMsg({ tone: 'success', text: t('profile.saved') }); setCur(''); setPw(''); }
      catch (err) { setMsg({ tone: 'error', text: trMsg(t, (err as Error).message) }); }
    }}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <input type="password" className="input" placeholder={t('profile.currentPassword')} autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      <input type="password" className="input" placeholder={t('profile.newPassword')} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      <p className="text-xs text-slate-500">{t('auth.passwordHint')}</p>
      <button className="btn btn-navy">{t('profile.changePassword')}</button>
    </form>
  );
}
