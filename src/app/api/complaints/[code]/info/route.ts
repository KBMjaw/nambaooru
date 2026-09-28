import { z } from 'zod';
import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { conflict, notFound } from '@/lib/errors';
import { storeEvidence, validateFile } from '@/lib/evidence';
import { notifyOfficials } from '@/lib/complaints';

/**
 * The reporting citizen adds information to their own open complaint (usually after officials asked for it).
 * Extra photos are added as new citizen evidence; the original evidence is never replaced.
 */
export const POST = route<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const u = await requireApiUser('PUBLIC', 'complaint.create');
  await rateLimit(`info:${u.id}`, 20, 3600);
  const { code } = await params;
  const form = await req.formData();
  const text = z.string().trim().min(3).max(2000).parse(String(form.get('text') ?? ''));
  const files = form.getAll('evidence').filter((f): f is File => f instanceof File && f.size > 0).slice(0, 3);
  const [c] = await sql`SELECT id, status, info_requested_at FROM complaints WHERE code = ${code} AND citizen_id = ${u.id}`;
  if (!c) throw notFound();
  if (['CLOSED', 'REJECTED', 'DUPLICATE', 'DRAFT'].includes(c.status as string)) throw conflict('This complaint is finished; request reconsideration instead');
  for (const f of files) await validateFile(f); // reject bad files before anything is recorded
  const ids: number[] = [];
  for (const f of files) ids.push(await storeEvidence(c.id as number, 'CITIZEN', f, u.id, { source: 'UPLOAD' }) as number);
  await sql`UPDATE complaints SET info_requested_at = NULL, updated_at = now() WHERE id = ${c.id}`;
  await sql`INSERT INTO complaint_status_history (complaint_id, from_status, to_status, actor_id, actor_label, note, public_note)
            VALUES (${c.id}, ${c.status}, ${c.status}, ${u.id}, ${`${u.fullName} (Citizen)`}, ${`Citizen added information: ${text}`}, true)`;
  await audit(u, { action: 'CITIZEN_INFO_ADDED', entityType: 'complaint', entityId: code, newValue: { answeredRequest: !!c.info_requested_at, evidenceIds: ids } });
  await notifyOfficials(c.id as number, 'CITIZEN_INFO_ADDED', {}, { includeWardMember: false });
  return { ok: true };
});
