import { Suspense } from 'react';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { LoginForm } from '@/components/LoginForm';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export const metadata = { title: 'Admin Login' };

export default async function AdminLogin() {
  if (await getUser('ADMIN')) redirect('/admin');
  const { t } = await getT();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <Image src="/logo-sm.png" alt="" width={48} height={48} className="rounded-full bg-white" />
            <div><div className="text-lg font-extrabold">{t('app.name')}</div><div className="text-xs text-white/75">{t('portal.admin')}</div></div>
          </div>
          <LanguageSwitcher dark />
        </div>
        <div className="card p-6">
          <h1 className="mb-5 text-xl font-extrabold text-slate-800">🛡️ {t('auth.adminLoginTitle')}</h1>
          <Suspense><LoginForm portal="ADMIN" /></Suspense>
        </div>
      </div>
    </div>
  );
}
