import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { conflict, notFound } from '@/lib/errors';
import { notifyOfficials } from '@/lib/complaints';

/** The reporting citizen rates how a finished complaint was handled (1–5, optional comment). One per complaint; can be updated. */
export const POST = route<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const u = await requireApiUser('PUBLIC', 'complaint.create');
  await rateLimit(`feedback:${u.id}`, 10, 3600);
  const { code } = await params;
  const { rating, comment } = await body(req, z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }));
  const [c] = await sql`SELECT id, status FROM complaints WHERE code = ${code} AND citizen_id = ${u.id}`;
  if (!c) throw notFound();
  if (!['CLOSED', 'REJECTED', 'DUPLICATE'].includes(c.status as string)) throw conflict('Feedback opens once the complaint is finished');
  await sql`INSERT INTO complaint_feedback (complaint_id, citizen_id, rating, comment) VALUES (${c.id}, ${u.id}, ${rating}, ${comment || null})
            ON CONFLICT (complaint_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()`;
  await audit(u, { action: 'FEEDBACK_SUBMITTED', entityType: 'complaint', entityId: code, newValue: { rating } });
  await notifyOfficials(c.id as number, 'FEEDBACK_RECEIVED', { rating }, { includeWardMember: false });
  return { ok: true };
});
