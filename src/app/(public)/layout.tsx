import { NotifPoller } from '@/components/NotifPoller';
import Link from 'next/link';
import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { Brand } from '@/components/Brand';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LogoutButton } from '@/components/LogoutButton';
import { PublicBottomNav, PublicTopLinks } from '@/components/PublicNav';
import { SiteAnalytics } from '@/components/SiteAnalytics';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  const user = await getUser('PUBLIC');
  let unread = 0;
  if (user) {
    const [r] = await sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${user.id} AND read_at IS NULL AND channel = 'IN_APP'`;
    unread = r.n as number;
  }
  return (
    <div className={`flex min-h-dvh flex-col ${user ? 'pb-20 md:pb-0' : ''}`}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <Brand title={t('app.name')} subtitle={t('app.tagline')} />
          <div className="flex items-center gap-2">
            {user && <PublicTopLinks unread={unread} />}
            <LanguageSwitcher />
            {user ? (
              <span className="hidden md:inline"><LogoutButton portal="PUBLIC" /></span>
            ) : (
              <Link href="/login" className="btn btn-navy btn-sm">{t('nav.login')}</Link>
            )}
          </div>
        </div>
      </header>
      {user && <NotifPoller portal="PUBLIC" unread={unread} />}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">{children}</main>
      <footer className="border-t border-slate-200 bg-white/60 px-4 py-5 text-center text-xs text-slate-500">
        <p>{t('footer.privacy')}</p>
        <p className="mt-1">{t('footer.pilot')}</p>
      </footer>
      {user && <PublicBottomNav unread={unread} />}
      <SiteAnalytics />
    </div>
  );
}
