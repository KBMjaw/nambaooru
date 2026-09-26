import { requirePageUser } from '@/lib/auth';
import { NotificationsPage } from '@/components/NotificationsPage';

export default async function Notifications({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const u = await requirePageUser('OFFICE');
  const { all } = await searchParams;
  return <NotificationsPage userId={u.id} linkBase="/office/complaints" portal="OFFICE" all={all === '1'} />;
}
