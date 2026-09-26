'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { timeAgo, fmtDateTime } from '@/lib/format';
import { Empty } from './ui';

export interface Notif { id: number; title_en: string; title_ta: string; body_en: string; body_ta: string; read_at: string | null; created_at: string; code: string | null }

/**
 * Notification centre. Unread items are listed under NEW, everything already read under EARLIER UPDATES.
 * Notifications are never deleted; opening one (or its complaint) marks it read, which lowers the badge.
 */
export function NotificationsList({ items, linkBase, portal = 'PUBLIC' }: { items: Notif[]; linkBase: string; portal?: 'PUBLIC' | 'OFFICE' | 'ADMIN' }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function mark(id?: number) {
    setBusy(true);
    try {
      await fetch(`/api/notifications?portal=${portal}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id ? { id } : {}) });
      router.refresh();
    } finally { setBusy(false); }
  }
  if (!items.length) return <Empty icon="🔔">{t('notif.none')}</Empty>;
  const unread = items.filter((n) => !n.read_at);
  const earlier = items.filter((n) => n.read_at);
  const card = (n: Notif) => (
    <li key={n.id} className={`card flex gap-3 p-3.5 ${n.read_at ? 'bg-slate-50/60' : 'border-l-4 border-l-leaf-500'}`}>
      <span className="text-xl" aria-hidden>{n.read_at ? '🔕' : '🔔'}</span>
      <div className="min-w-0 flex-1">
        <p className={n.read_at ? 'font-semibold text-slate-700' : 'font-bold text-slate-900'}>{lang === 'ta' ? n.title_ta : n.title_en}</p>
        <p className="text-sm text-slate-600">{lang === 'ta' ? n.body_ta : n.body_en}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span suppressHydrationWarning title={fmtDateTime(n.created_at, lang)}>{timeAgo(n.created_at, lang)} · <span suppressHydrationWarning>{fmtDateTime(n.created_at, lang)}</span></span>
          {n.code && <Link onClick={() => { if (!n.read_at) void mark(n.id); }} href={`${linkBase}/${n.code}`} className="font-semibold text-navy-600 underline">{t('notif.open')} {n.code}</Link>}
          {!n.read_at && <button type="button" disabled={busy} className="rounded-md border border-slate-300 px-2 py-0.5 font-semibold text-slate-700" onClick={() => mark(n.id)}>✓ {t('notif.markRead')}</button>}
        </div>
      </div>
    </li>
  );
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-leaf-700">🆕 {t('notif.new')} ({unread.length})</h2>
          {unread.length > 0 && <button type="button" disabled={busy} className="btn btn-outline btn-sm" onClick={() => mark()}>{t('notif.markAll')}</button>}
        </div>
        {unread.length ? <ul className="space-y-2">{unread.map(card)}</ul> : <p className="text-sm text-slate-500">{t('notif.allRead')}</p>}
      </section>
      {earlier.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-slate-500">🕘 {t('notif.earlier')} ({earlier.length})</h2>
          <ul className="space-y-2">{earlier.map(card)}</ul>
        </section>
      )}
    </div>
  );
}
