import { z } from 'zod';
import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { storeEvidence } from '@/lib/evidence';
import { notifyOfficials } from '@/lib/complaints';

/** Citizen "Request Reconsideration" for rejected / duplicate / closed complaints — separate review workflow. */
export const POST = route<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const u = await requireApiUser('PUBLIC', 'appeal.create');
  await rateLimit(`appeal:${u.id}`, 5, 3600);
  const { code } = await params;
  const form = await req.formData();
  const reason = z.string().trim().min(5).max(2000).parse(String(form.get('reason') ?? ''));
  const inputMode = z.enum(['TEXT', 'VOICE']).parse(String(form.get('inputMode') ?? 'TEXT'));
  const files = form.getAll('evidence').filter((f): f is File => f instanceof File && f.size > 0).slice(0, 3);

  const [c] = await sql`SELECT id, status FROM complaints WHERE code = ${code} AND citizen_id = ${u.id}`;
  if (!c) throw notFound();
  if (!['REJECTED', 'DUPLICATE', 'CLOSED'].includes(c.status as string)) throw badRequest('Reconsideration is only possible for rejected or closed complaints');
  const pending = await sql`SELECT 1 FROM appeals WHERE complaint_id = ${c.id} AND status = 'PENDING'`;
  if (pending.length) throw conflict('A reconsideration request is already under review');

  const [a] = await sql`INSERT INTO appeals (complaint_id, citizen_id, reason_text, input_mode, status_at_appeal)
                        VALUES (${c.id}, ${u.id}, ${reason}, ${inputMode}, ${c.status}) RETURNING id`;
  for (const f of files) await storeEvidence(c.id as number, 'APPEAL', f, u.id, { source: 'UPLOAD' }, a.id as number);
  await sql`INSERT INTO complaint_status_history (complaint_id, from_status, to_status, actor_id, actor_label, note)
            VALUES (${c.id}, ${c.status}, ${c.status}, ${u.id}, ${`${u.fullName} (Citizen)`}, 'Reconsideration requested')`;
  await audit(u, { action: 'APPEAL_CREATED', entityType: 'complaint', entityId: code, newValue: { appealId: a.id, statusAtAppeal: c.status } });
  await notifyOfficials(c.id as number, 'APPEAL_SUBMITTED', {}, { includeWardMember: false });
  return { ok: true };
});
