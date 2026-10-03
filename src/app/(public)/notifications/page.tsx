import { requirePageUser } from '@/lib/auth';
import { NotificationsPage } from '@/components/NotificationsPage';

export const metadata = { title: 'Notifications' };

export default async function Notifications({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const u = await requirePageUser('PUBLIC');
  const { all } = await searchParams;
  return <NotificationsPage userId={u.id} linkBase="/complaints" portal="PUBLIC" all={all === '1'} />;
}
