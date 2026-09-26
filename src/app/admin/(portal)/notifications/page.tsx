import { requirePageUser } from '@/lib/auth';
import { NotificationsPage } from '@/components/NotificationsPage';

export default async function AdminNotifications({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const u = await requirePageUser('ADMIN');
  const { all } = await searchParams;
  return <NotificationsPage userId={u.id} linkBase="/admin/complaints" portal="ADMIN" all={all === '1'} />;
}
