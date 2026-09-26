import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { NotificationsList, type Notif } from '@/components/NotificationsList';

export const metadata = { title: 'Notifications' };

export default async function Notifications() {
  const user = await requirePageUser('PUBLIC');
  const { t } = await getT();
  const items = await sql<Notif[]>`
    SELECT n.id, n.title_en, n.title_ta, n.body_en, n.body_ta, n.read_at, n.created_at, c.code
    FROM notifications n LEFT JOIN complaints c ON c.id = n.complaint_id
    WHERE n.user_id = ${user.id} AND n.channel = 'IN_APP' ORDER BY n.created_at DESC LIMIT 100`;
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-extrabold text-navy-800">🔔 {t('notif.title')}</h1>
      <NotificationsList items={JSON.parse(JSON.stringify(items))} linkBase="/complaints" />
    </div>
  );
}
