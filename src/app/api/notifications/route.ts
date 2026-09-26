import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { getUser } from '@/lib/auth';
import { unauthorized } from '@/lib/errors';

async function anyUser(req: NextRequest) {
  const portal = (['PUBLIC', 'OFFICE', 'ADMIN'] as const).find((p) => p === req.nextUrl.searchParams.get('portal')) ?? 'PUBLIC';
  const u = await getUser(portal);
  if (!u) throw unauthorized();
  return u;
}

export const GET = route(async (req) => {
  const u = await anyUser(req);
  const items = await sql`SELECT n.id, n.title_en, n.title_ta, n.body_en, n.body_ta, n.read_at, n.created_at, c.code
                          FROM notifications n LEFT JOIN complaints c ON c.id = n.complaint_id
                          WHERE n.user_id = ${u.id} AND n.channel = 'IN_APP' ORDER BY n.created_at DESC LIMIT 50`;
  return { items };
});

export const POST = route(async (req) => {
  const u = await anyUser(req);
  const { id } = await body(req, z.object({ id: z.number().int().positive().optional() }));
  if (id) await sql`UPDATE notifications SET read_at = now() WHERE id = ${id} AND user_id = ${u.id} AND read_at IS NULL`;
  else await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${u.id} AND read_at IS NULL`;
  return { ok: true };
});
