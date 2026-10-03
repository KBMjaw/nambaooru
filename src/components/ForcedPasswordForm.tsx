'use client';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { Alert, Spinner } from './ui';
import { LogoutButton } from './LogoutButton';

/** Replace a temporary / reset password. Required before the account can use anything else. */
export function ForcedPasswordForm({ portal, username }: { portal: 'PUBLIC' | 'OFFICE' | 'ADMIN'; username: string }) {
  const { t } = useI18n();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      if (!(pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw))) return setErr(t('err.password'));
      if (pw !== pw2) return setErr(t('err.passwordMatch'));
      setBusy(true);
      try {
        const r = await api<{ redirect: string }>(`/api/profile?portal=${portal}`, { body: { currentPassword: cur, newPassword: pw } });
        window.location.href = r.redirect;
      } catch (x) { setErr(trMsg(t, (x as Error).message)); setBusy(false); }
    }}>
      <Alert tone="warn">🔑 {t('auth.mustChangePassword')}</Alert>
      <p className="text-sm text-slate-600">{t('auth.username')}: <b className="font-mono">{username}</b></p>
      {err && <Alert tone="error">{err}</Alert>}
      <input type="password" className="input" placeholder={t('auth.tempPasswordPh')} autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      <input type="password" className="input" placeholder={t('profile.newPassword')} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      <input type="password" className="input" placeholder={t('auth.confirmPassword')} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      <p className="text-xs text-slate-500">{t('auth.passwordHint')}</p>
      <div className="flex items-center justify-between gap-2">
        <LogoutButton portal={portal} className="btn btn-ghost btn-sm" />
        <button className="btn btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />}{t('profile.changePassword')}</button>
      </div>
    </form>
  );
}
