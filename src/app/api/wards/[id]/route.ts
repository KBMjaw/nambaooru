import { z } from 'zod';
import { route, body } from '@/lib/api';
import { requireApiStaffFor } from '@/lib/auth';
import { WardUpdate, updateWard } from '@/lib/locations-admin';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'), ['ward.manage', 'location.manage']);
  return updateWard(u, z.coerce.number().int().positive().parse((await params).id), await body(req, WardUpdate));
});
