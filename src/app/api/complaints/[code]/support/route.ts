import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { forbidden, notFound } from '@/lib/errors';
import { verifySupportToken } from '@/lib/support-token';

/**
 * "Track existing complaint": the citizen joins an existing open complaint instead of filing a duplicate.
 * Allowed only for a complaint the duplicate check offered to this citizen (signed, short-lived token);
 * a complaint code alone never grants anything. Supporters see the public summary only (no photos,
 * description, names or internal notes), see the complaint page.
 */
export const POST = route<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const u = await requireApiUser('PUBLIC', 'complaint.create');
  await rateLimit(`support:${u.id}`, 30, 3600);
  const { code } = await params;
  const raw = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof raw?.token === 'string' ? raw.token.slice(0, 200) : null;
  const [c] = await sql`SELECT id, citizen_id FROM complaints WHERE code = ${code} AND status NOT IN ('CLOSED','REJECTED','DUPLICATE','DRAFT')`;
  if (!c) throw notFound();
  if (c.citizen_id === u.id) return { ok: true, redirect: `/complaints/${code}` };
  if (!verifySupportToken(token, u.id, c.id as number)) throw forbidden();
  const ins = await sql`INSERT INTO complaint_supporters (complaint_id, user_id) VALUES (${c.id}, ${u.id}) ON CONFLICT DO NOTHING RETURNING 1`;
  if (ins.length) await sql`UPDATE complaints SET supporters_count = supporters_count + 1 WHERE id = ${c.id}`;
  await audit(u, { action: 'COMPLAINT_SUPPORTED', entityType: 'complaint', entityId: code });
  return { ok: true, redirect: `/complaints/${code}` };
});
