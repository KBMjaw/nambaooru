import { requirePageUser } from '@/lib/auth';
import { UsersListPage } from '@/components/users/UsersListPage';
import type { ListQuery } from '@/lib/users';

export const metadata = { title: 'Users' };

export default async function OfficeUsers({ searchParams }: { searchParams: Promise<ListQuery> }) {
  const u = await requirePageUser('OFFICE', ['user.view', 'user.manage']);
  return <UsersListPage u={u} portal="OFFICE" sp={await searchParams} />;
}
