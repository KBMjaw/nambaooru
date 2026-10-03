import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { LoginForm } from '@/components/LoginForm';

export const metadata = { title: 'Login' };

export default async function LoginPage() {
  if (await getUser('PUBLIC')) redirect('/');
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="mb-5 text-xl font-extrabold text-navy-800">{t('auth.loginTitle')}</h1>
        <Suspense><LoginForm portal="PUBLIC" /></Suspense>
      </div>
    </div>
  );
}
