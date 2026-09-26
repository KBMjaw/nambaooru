import Link from 'next/link';
import { Brand } from './Brand';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LogoutButton } from './LogoutButton';
import { PortalNavLinks } from './PortalNavLinks';
import { AddMenu, type AddItem } from './admin/AddMenu';

export interface NavItem { href: string; label: string; icon: string; badge?: number }

/** Shared chrome for the Officer (/office) and Admin (/admin) portals. */
export function PortalShell({
  portal, title, subtitle, userName, roleLabel, nav, children, tone = 'navy', addItems = [],
}: {
  portal: 'OFFICE' | 'ADMIN'; title: string; subtitle: string; userName: string; roleLabel: string; nav: NavItem[];
  children: React.ReactNode; tone?: 'navy' | 'slate'; addItems?: AddItem[];
}) {
  const bg = tone === 'navy' ? 'bg-navy-800' : 'bg-slate-900';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`${bg} sticky top-0 z-30 text-white shadow`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
          <Brand href={portal === 'OFFICE' ? '/office' : '/admin'} title={title} subtitle={subtitle} dark />
          <div className="flex items-center gap-2">
            <AddMenu items={addItems} />
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-bold">{userName}</div>
              <div className="text-[11px] text-white/70">{roleLabel}</div>
            </div>
            <LanguageSwitcher dark />
            <LogoutButton portal={portal} className="btn btn-sm border border-white/25 text-white hover:bg-white/10" />
          </div>
        </div>
        <PortalNavLinks items={nav} />
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-4 sm:py-5">{children}</main>
      <footer className="px-4 py-4 text-center text-[11px] text-slate-400">
        Namma Ooru · <Link href="/" className="underline">Public portal</Link>
      </footer>
    </div>
  );
}
