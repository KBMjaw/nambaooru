import { route, body } from '@/lib/api';
import { requireApiStaffFor } from '@/lib/auth';
import { AddWards, addWards } from '@/lib/locations-admin';

/** Append wards to a local body (location.manage anywhere, ward.manage inside own jurisdiction). */
export const POST = route(async (req) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'), ['ward.manage', 'location.manage']);
  return addWards(u, await body(req, AddWards));
});
