import { z } from 'zod';
import { route, body } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RoleUpdate, updateRole } from '@/lib/roles';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireApiUser('ADMIN', ['role.manage', 'role.custom.manage']);
  const id = z.coerce.number().int().positive().parse((await params).id);
  return updateRole(u, id, await body(req, RoleUpdate));
});
