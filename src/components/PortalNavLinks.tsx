'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from './PortalShell';

export function PortalNavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const root = items[0]?.href;
  return (
    <nav className="mx-auto max-w-7xl overflow-x-auto px-2">
      <ul className="flex gap-1 whitespace-nowrap pb-1.5">
        {items.map((it) => {
          const active = it.href === root ? path === root : path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link href={it.href} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${active ? 'bg-white text-navy-800' : 'text-white/85 hover:bg-white/10'}`}>
                <span aria-hidden>{it.icon}</span>{it.label}
                {!!it.badge && <span className="rounded-full bg-pin-500 px-1.5 text-[10px] font-bold text-white">{it.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
