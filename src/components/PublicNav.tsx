'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n/client';

export function PublicBottomNav({ unread }: { unread: number }) {
  const { t } = useI18n();
  const path = usePathname();
  const items = [
    { href: '/', icon: '🏠', label: t('nav.home') },
    { href: '/complaints', icon: '📋', label: t('nav.myComplaints') },
    { href: '/report', icon: '🎙️', label: t('nav.report'), primary: true },
    { href: '/notifications', icon: '🔔', label: t('nav.notifications'), badge: unread },
    { href: '/profile', icon: '👤', label: t('nav.profile') },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label={t('nav.menu')}>
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((it) => {
          const active = it.href === '/' ? path === '/' : path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`relative flex flex-col items-center gap-0.5 px-1 py-2 text-[10.5px] font-semibold leading-tight ${active ? 'text-leaf-700' : 'text-slate-500'}`}
              >
                {it.primary ? (
                  <span className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-pin-500 text-2xl text-white shadow-lg ring-4 ring-white">{it.icon}</span>
                ) : (
                  <span className="text-xl" aria-hidden>{it.icon}</span>
                )}
                <span className="line-clamp-1 text-center">{it.label}</span>
                {!!it.badge && <span className="absolute right-3 top-1 rounded-full bg-pin-500 px-1.5 text-[10px] font-bold text-white">{it.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PublicTopLinks({ unread }: { unread: number }) {
  const { t } = useI18n();
  const path = usePathname();
  const items = [
    { href: '/report', label: t('nav.report') },
    { href: '/complaints', label: t('nav.myComplaints') },
    { href: '/track', label: t('nav.track') },
    { href: '/notifications', label: `${t('nav.notifications')}${unread ? ` (${unread})` : ''}` },
    { href: '/profile', label: t('nav.profile') },
  ];
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className={`rounded-lg px-3 py-2 text-sm font-semibold ${path.startsWith(it.href) ? 'bg-leaf-50 text-leaf-700' : 'text-slate-600 hover:bg-slate-100'}`}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
