import { route, body } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { LocalBodyInput, createLocalBody } from '@/lib/locations-admin';

/** Create a local body with its wards and departments in one step. */
export const POST = route(async (req) => {
  const u = await requireApiUser('ADMIN', 'location.manage');
  return createLocalBody(u, await body(req, LocalBodyInput));
});
