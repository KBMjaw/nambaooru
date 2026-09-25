import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { notFound } from '@/lib/errors';

/** "Track existing complaint": the citizen joins an existing open complaint instead of filing a duplicate. */
export const POST = route<{ params: Promise<{ code: string }> }>(async (_req, { params }) => {
  const u = await requireApiUser('PUBLIC', 'complaint.create');
  const { code } = await params;
  const [c] = await sql`SELECT id, citizen_id FROM complaints WHERE code = ${code} AND status NOT IN ('CLOSED','REJECTED','DUPLICATE','DRAFT')`;
  if (!c) throw notFound();
  if (c.citizen_id !== u.id) {
    const ins = await sql`INSERT INTO complaint_supporters (complaint_id, user_id) VALUES (${c.id}, ${u.id}) ON CONFLICT DO NOTHING RETURNING 1`;
    if (ins.length) await sql`UPDATE complaints SET supporters_count = supporters_count + 1 WHERE id = ${c.id}`;
    await audit(u, { action: 'COMPLAINT_SUPPORTED', entityType: 'complaint', entityId: code });
  }
  return { ok: true, redirect: `/complaints/${code}` };
});
