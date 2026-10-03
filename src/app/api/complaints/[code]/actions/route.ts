import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiStaffFor } from '@/lib/auth';
import { complaintScope } from '@/lib/scope';
import { rateLimit } from '@/lib/ratelimit';
import { notFound } from '@/lib/errors';
import { ActionCreate, createAction, listActions } from '@/lib/complaint-actions';

type Ctx = { params: Promise<{ code: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'));
  const code = decodeURIComponent((await params).code);
  const [c] = await sql`SELECT c.id FROM complaints c WHERE c.code = ${code} AND (${complaintScope(u)})`;
  if (!c) throw notFound();
  return { actions: await listActions(c.id as number) };
});

export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'), 'action.create');
  await rateLimit(`actions:${u.id}`, 200, 3600);
  return createAction(u, decodeURIComponent((await params).code), await body(req, ActionCreate));
});
