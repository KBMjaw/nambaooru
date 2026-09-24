'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api, ApiError } from '@/lib/client-api';
import { Alert, Spinner } from './ui';

export function LoginForm({ portal }: { portal: 'PUBLIC' | 'OFFICE' | 'ADMIN' }) {
  const { t } = useI18n();
  const sp = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isCitizen = portal === 'PUBLIC';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isCitizen && !/^[6-9]\d{9}$/.test(identifier)) return setError(t('err.mobile'));
    setBusy(true);
    try {
      const r = await api<{ redirect: string }>('/api/auth/login', { body: { portal, identifier, password } });
      const next = sp.get('next');
      const base = portal === 'PUBLIC' ? '/' : portal === 'OFFICE' ? '/office' : '/admin';
      window.location.href = next && next.startsWith(base === '/' ? '/' : base) && !next.startsWith('//') ? next : r.redirect;
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t('err.rateLimited') : trMsg(t, (err as Error).message));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <label className="label" htmlFor="identifier">{isCitizen ? t('auth.mobile') : t('auth.username')}</label>
        <input
          id="identifier"
          className="input text-lg"
          inputMode={isCitizen ? 'numeric' : 'text'}
          autoComplete={isCitizen ? 'tel' : 'username'}
          maxLength={isCitizen ? 10 : 64}
          value={identifier}
          onChange={(e) => setIdentifier(isCitizen ? e.target.value.replace(/\D/g, '') : e.target.value)}
          placeholder={isCitizen ? '98XXXXXXXX' : ''}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="password">{t('auth.password')}</label>
        <input id="password" type="password" className="input text-lg" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <button className="btn btn-primary btn-lg w-full" disabled={busy}>
        {busy && <Spinner />} {t('auth.loginBtn')}
      </button>
      {isCitizen && (
        <p className="text-center text-sm text-slate-600">
          {t('auth.noAccount')} <Link href="/register" className="font-bold text-leaf-700 underline">{t('auth.createAccount')}</Link>
        </p>
      )}
      <p className="text-center text-xs text-slate-500">🔒 {t('auth.secureNote')}</p>
    </form>
  );
}
