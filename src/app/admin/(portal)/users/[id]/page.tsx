import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { UserDetailPage } from '@/components/users/UserDetailPage';

export const metadata = { title: 'User' };

export default async function UserProfile({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePageUser('ADMIN', ['user.manage.all', 'user.manage', 'user.view']);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return await UserDetailPage({ u, portal: 'ADMIN', id });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}
