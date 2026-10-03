import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { NotificationsList, type Notif } from './NotificationsList';

/** Every unread notification plus the most recent read ones (history is kept; ?all=1 shows more). */
export async function NotificationsPage({ userId, linkBase, portal, all }: { userId: string; linkBase: string; portal: 'PUBLIC' | 'OFFICE' | 'ADMIN'; all?: boolean }) {
  const { t } = await getT();
  const limit = all ? 1000 : 100;
  const items = await sql<Notif[]>`
    (SELECT n.id, n.title_en, n.title_ta, n.body_en, n.body_ta, n.read_at, n.created_at, c.code
     FROM notifications n LEFT JOIN complaints c ON c.id = n.complaint_id
     WHERE n.user_id = ${userId} AND n.channel = 'IN_APP' AND n.read_at IS NULL ORDER BY n.created_at DESC LIMIT 1000)
    UNION ALL
    (SELECT n.id, n.title_en, n.title_ta, n.body_en, n.body_ta, n.read_at, n.created_at, c.code
     FROM notifications n LEFT JOIN complaints c ON c.id = n.complaint_id
     WHERE n.user_id = ${userId} AND n.channel = 'IN_APP' AND n.read_at IS NOT NULL ORDER BY n.created_at DESC LIMIT ${limit})
    ORDER BY created_at DESC`;
  const readShown = items.filter((n) => n.read_at).length;
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-extrabold text-navy-800">🔔 {t('notif.title')}</h1>
      <NotificationsList items={JSON.parse(JSON.stringify(items))} linkBase={linkBase} portal={portal} />
      {!all && readShown >= limit && <p className="text-center"><a className="btn btn-ghost btn-sm" href="?all=1">{t('common.showMore')}</a></p>}
    </div>
  );
}
