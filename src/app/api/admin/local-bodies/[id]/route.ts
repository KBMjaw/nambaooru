import { z } from 'zod';
import { route, body } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { LocalBodyUpdate, updateLocalBody } from '@/lib/locations-admin';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireApiUser('ADMIN', 'location.manage');
  return updateLocalBody(u, z.coerce.number().int().positive().parse((await params).id), await body(req, LocalBodyUpdate));
});
