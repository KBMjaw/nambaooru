'use client';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/** Table row that navigates on click / Enter (the first cell still carries a real link for accessibility). */
export function ClickableRow({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr className={`cursor-pointer hover:bg-navy-50/60 ${className}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,input,select')) router.push(href); }}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(href); }} tabIndex={0}>
      {children}
    </tr>
  );
}
