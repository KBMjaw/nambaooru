'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { timeAgo } from '@/lib/format';
import { Empty } from './ui';

export interface Notif { id: number; title_en: string; title_ta: string; body_en: string; body_ta: string; read_at: string | null; created_at: string; code: string | null }

export function NotificationsList({ items, linkBase, portal = 'PUBLIC' }: { items: Notif[]; linkBase: string; portal?: 'PUBLIC' | 'OFFICE' | 'ADMIN' }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  async function mark(id?: number) {
    await fetch(`/api/notifications?portal=${portal}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id ? { id } : {}) });
    router.refresh();
  }
  if (!items.length) return <Empty icon="🔔">{t('notif.none')}</Empty>;
  return (
    <div className="space-y-2">
      {items.some((n) => !n.read_at) && <div className="text-right"><button className="btn btn-ghost btn-sm" onClick={() => mark()}>{t('notif.markAll')}</button></div>}
      {items.map((n) => (
        <div key={n.id} className={`card flex gap-3 p-3.5 ${n.read_at ? 'opacity-70' : 'border-l-4 border-l-leaf-500'}`}>
          <span className="text-xl" aria-hidden>{n.read_at ? '🔕' : '🔔'}</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-800">{lang === 'ta' ? n.title_ta : n.title_en}</p>
            <p className="text-sm text-slate-600">{lang === 'ta' ? n.body_ta : n.body_en}</p>
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
              <span>{timeAgo(n.created_at, lang)}</span>
              {n.code && <Link onClick={() => !n.read_at && mark(n.id)} href={`${linkBase}/${n.code}`} className="font-semibold text-navy-600 underline">{n.code}</Link>}
              {!n.read_at && <button className="underline" onClick={() => mark(n.id)}>✓</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
