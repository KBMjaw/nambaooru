'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/** Keeps the unread badge current: checks the unread count every minute (and on focus) and refreshes when it changes. */
export function NotifPoller({ portal, unread }: { portal: 'PUBLIC' | 'OFFICE' | 'ADMIN'; unread: number }) {
  const router = useRouter();
  const last = useRef(unread);
  useEffect(() => { last.current = unread; }, [unread]);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch(`/api/notifications?portal=${portal}&count=1`, { cache: 'no-store' });
        if (!r.ok) return;
        const { unread: n } = (await r.json()) as { unread: number };
        if (!stop && n !== last.current) { last.current = n; router.refresh(); }
      } catch { /* offline: try again later */ }
    };
    const id = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    return () => { stop = true; clearInterval(id); window.removeEventListener('focus', check); };
  }, [portal, router]);
  return null;
}
