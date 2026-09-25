import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getUser, LOGIN_PATH } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { ForcedPasswordForm } from '@/components/ForcedPasswordForm';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export const metadata = { title: 'Set a new password' };
export const dynamic = 'force-dynamic';

export default async function SetPassword() {
  const u = await getUser('ADMIN');
  if (!u) redirect(LOGIN_PATH.ADMIN);
  if (!u.mustChangePassword) redirect('/admin');
  const { t } = await getT();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700 p-4">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <Image src="/logo-sm.png" alt="" width={48} height={48} className="rounded-full bg-white" />
            <div className="text-lg font-extrabold">{t('app.name')}</div>
          </div>
          <LanguageSwitcher dark />
        </div>
        <div className="card p-6">
          <h1 className="mb-4 text-xl font-extrabold text-slate-800">🔑 {t('auth.setNewPassword')}</h1>
          <ForcedPasswordForm portal="ADMIN" username={u.username} />
        </div>
      </div>
    </div>
  );
}
