import { requirePageUser } from '@/lib/auth';
import { UsersListPage } from '@/components/users/UsersListPage';
import type { ListQuery } from '@/lib/users';

export const metadata = { title: 'Users' };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<ListQuery> }) {
  const u = await requirePageUser('ADMIN', ['user.manage.all', 'user.manage', 'user.view']);
  return <UsersListPage u={u} portal="ADMIN" sp={await searchParams} />;
}
