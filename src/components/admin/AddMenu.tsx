'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n/client';

export interface AddItem { href: string; label: string; icon: string }

/** Prominent "+ Add" menu in the admin header; items are pre-filtered by permission on the server. */
export function AddMenu({ items }: { items: AddItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn btn-sm bg-pin-500 font-bold text-white hover:bg-pin-600" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        + {t('admin.add')}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-xl">
          {items.map((i) => (
            <Link key={i.href} role="menuitem" href={i.href} onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-navy-50">
              <span aria-hidden>{i.icon}</span>+ {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
