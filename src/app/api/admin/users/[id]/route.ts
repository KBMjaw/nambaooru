import { z } from 'zod';
import { route, body } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { UpdateUser, updateUser } from '@/lib/users';

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const u = await requireApiUser('ADMIN', ['user.manage', 'user.manage.all']);
  const id = z.string().uuid().parse((await params).id);
  const input = await body(req, UpdateUser);
  return updateUser(u, id, input as Record<string, unknown>);
});
