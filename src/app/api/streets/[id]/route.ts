import { z } from 'zod';
import { route, body } from '@/lib/api';
import { requireApiStaffFor } from '@/lib/auth';
import { StreetInput, updateStreet } from '@/lib/locations-admin';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'), ['ward.manage', 'location.manage']);
  return updateStreet(u, z.coerce.number().int().positive().parse((await params).id), await body(req, StreetInput.partial()));
});
