import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { ForcedPasswordForm } from '@/components/ForcedPasswordForm';

export const metadata = { title: 'Set a new password' };
export const dynamic = 'force-dynamic';

export default async function CitizenSetPassword() {
  const u = await getUser('PUBLIC');
  if (!u) redirect('/login');
  if (!u.mustChangePassword) redirect('/');
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-md py-6">
      <div className="card p-6">
        <h1 className="mb-4 text-xl font-extrabold text-slate-800">🔑 {t('auth.setNewPassword')}</h1>
        <ForcedPasswordForm portal="PUBLIC" username={u.mobile} />
      </div>
    </div>
  );
}
