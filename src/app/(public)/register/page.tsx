import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { RegisterWizard } from './RegisterWizard';

export const metadata = { title: 'Register' };

export default async function RegisterPage() {
  if (await getUser('PUBLIC')) redirect('/');
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-5 sm:p-6">
        <h1 className="mb-4 text-xl font-extrabold text-navy-800">{t('reg.title')}</h1>
        <RegisterWizard />
        <p className="mt-5 text-center text-sm text-slate-600">
          {t('auth.haveAccount')} <Link href="/login" className="font-bold text-leaf-700 underline">{t('nav.login')}</Link>
        </p>
      </div>
    </div>
  );
}
