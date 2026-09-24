import { z } from 'zod';
import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { audit } from '@/lib/audit';
import { badRequest } from '@/lib/errors';
import { analyzeComplaint } from '@/lib/nlp/service';
import { routeComplaint } from '@/lib/routing';
import { slaHours } from '@/lib/sla';
import { storeEvidence } from '@/lib/evidence';
import { transition } from '@/lib/workflow';
import { notify } from '@/lib/notify';
import { buildSummary, haversineKm, nextComplaintCode, notifyOfficials } from '@/lib/complaints';
import { getSetting } from '@/lib/settings';
import { decrypt } from '@/lib/crypto';

const Payload = z.object({
  text: z.string().trim().min(3).max(4000),
  inputMode: z.enum(['TEXT', 'VOICE']),
  categoryCode: z.string().max(40),
  localBodyId: z.number().int().positive(),
  wardId: z.number().int().positive().nullable(),
  streetId: z.number().int().positive().nullable(),
  streetText: z.string().trim().max(120).nullable().optional(),
  landmark: z.string().trim().max(120).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  accuracy: z.number().min(0).max(100000).nullable(),
  gpsAt: z.string().datetime().nullable(),
  duplicateOverride: z.boolean().default(false),
  possibleDuplicateOf: z.coerce.number().int().positive().nullable().optional(),
});
const FileMeta = z.object({
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  accuracy: z.number().nullable().optional(),
  capturedAt: z.string().datetime().nullable().optional(),
  source: z.enum(['CAMERA', 'UPLOAD']).nullable().optional(),
  imageHash: z.string().nullable().optional(),
});

export const POST = route(async (req) => {
  const u = await requireApiUser('PUBLIC', 'complaint.create');
  await rateLimit(`complaint:create:${u.id}`, 10, 3600);
  const form = await req.formData();
  const p = Payload.parse(JSON.parse(String(form.get('payload') ?? '{}')));
  const files = form.getAll('evidence').filter((f): f is File => f instanceof File && f.size > 0).slice(0, 4);
  const metas = z.array(FileMeta).parse(JSON.parse(String(form.get('evidenceMeta') ?? '[]')));

  // Validate jurisdiction hierarchy from the DB (never trust client-provided relationships)
  const [lb] = await sql`SELECT id, name_en, name_ta, district_id, center_lat, center_lng FROM local_bodies WHERE id = ${p.localBodyId} AND status = 'ACTIVE'`;
  if (!lb) throw badRequest('Invalid local body');
  const [ward] = p.wardId ? await sql`SELECT id, ward_number, center_lat, center_lng FROM wards WHERE id = ${p.wardId} AND local_body_id = ${lb.id} AND status = 'ACTIVE'` : [];
  if (p.wardId && !ward) throw badRequest('Invalid ward');
  const [street] = p.streetId ? await sql`SELECT id, name_en, name_ta FROM streets WHERE id = ${p.streetId} AND ward_id = ${p.wardId ?? 0} AND status = 'ACTIVE'` : [];
  if (p.streetId && !street) throw badRequest('Invalid street');
  const [cat] = await sql`SELECT * FROM complaint_categories WHERE code = ${p.categoryCode} AND status = 'ACTIVE'`;
  if (!cat) throw badRequest('Invalid category');
  if (cat.evidence_required && files.length === 0) throw badRequest('report.photoNeeded');

  // AI analysis (assistive) — recomputed server-side from the citizen's own words
  const a = await analyzeComplaint(p.text, { localBodyId: lb.id as number });
  const priority = a.severity === 'LOW' && cat.default_priority !== 'LOW' ? (cat.default_priority as string) : a.severity;
  const summary = buildSummary(a, cat.code as string, {
    street: (street?.name_en as string) ?? p.streetText ?? null, streetTa: (street?.name_ta as string) ?? p.streetText ?? null,
    ward: (ward?.ward_number as number) ?? null, lbEn: lb.name_en as string, lbTa: lb.name_ta as string,
  });

  // GPS vs administrative location consistency (flag, never silently override)
  let conflict = false;
  let conflictNote: string | null = null;
  const ref = ward?.center_lat != null ? ward : lb;
  if (p.latitude != null && p.longitude != null && ref?.center_lat != null) {
    const km = haversineKm(p.latitude, p.longitude, ref.center_lat as number, ref.center_lng as number);
    const limit = Number(await getSetting('gps.conflict_km', 3));
    if (km > limit) { conflict = true; conflictNote = `GPS point is ${km.toFixed(1)} km from the selected ${ward ? 'ward' : 'local body'} centre`; }
  }

  const routed = await routeComplaint(lb.id as number, cat.id as number, (ward?.id as number) ?? null);
  const sla = await slaHours(cat.id as number, priority, lb.id as number);
  const code = await nextComplaintCode();
  const [cz] = await sql`SELECT address_enc, landmark, pincode, ward_id, street_id, street_text FROM citizens WHERE user_id = ${u.id}`;

  const [c] = await sql`
    INSERT INTO complaints (code, citizen_id, category_id, department_id, local_body_id, ward_id, street_id, street_text, landmark,
      pincode, district_id, location_snapshot, citizen_address_snapshot, latitude, longitude, gps_accuracy_m, gps_captured_at,
      location_conflict, location_conflict_note, original_text, input_mode, detected_language, title_en, title_ta, summary_en, summary_ta,
      ai_extraction, ai_engine, severity, priority, safety_risk, duration_text, status, possible_duplicate_of_id, duplicate_override,
      sla_due_at, submitted_at)
    VALUES (${code}, ${u.id}, ${cat.id}, ${routed.departmentId}, ${lb.id}, ${ward?.id ?? null}, ${street?.id ?? null},
      ${street ? null : p.streetText ?? null}, ${p.landmark ?? null}, ${(cz?.pincode as string) ?? null}, ${lb.district_id},
      ${sql.json({ local_body: lb.name_en, local_body_ta: lb.name_ta, ward: ward?.ward_number ?? null, street: street?.name_en ?? p.streetText ?? null, street_ta: street?.name_ta ?? null })},
      ${sql.json({ pincode: cz?.pincode ?? null, ward_id: cz?.ward_id ?? null, street_id: cz?.street_id ?? null, street_text: cz?.street_text ?? null, address: cz ? decrypt(cz.address_enc as string) : null })},
      ${p.latitude}, ${p.longitude}, ${p.accuracy}, ${p.gpsAt}, ${conflict}, ${conflictNote},
      ${p.text}, ${p.inputMode}, ${a.language}, ${summary.title_en}, ${summary.title_ta}, ${summary.summary_en}, ${summary.summary_ta},
      ${sql.json(JSON.parse(JSON.stringify({ ...a, citizenChoseCategory: cat.code !== a.category ? cat.code : undefined })))}, ${a.engine},
      ${a.severity}, ${priority}, ${a.safety.risk}, ${a.duration?.en ?? null}, 'SUBMITTED', ${p.possibleDuplicateOf ?? null}, ${p.duplicateOverride},
      now() + make_interval(hours => ${sla.resolution}), now())
    RETURNING id, code`;
  const complaintId = c.id as number;

  await sql`INSERT INTO complaint_status_history (complaint_id, from_status, to_status, actor_id, actor_label, note)
            VALUES (${complaintId}, 'DRAFT', 'SUBMITTED', ${u.id}, ${`${u.fullName} (Citizen)`}, ${p.inputMode === 'VOICE' ? 'Submitted by voice' : null})`;

  for (let i = 0; i < files.length; i++) {
    const m = metas[i] ?? {};
    await storeEvidence(complaintId, 'CITIZEN', files[i], u.id, { ...m, latitude: m.latitude ?? p.latitude, longitude: m.longitude ?? p.longitude, accuracy: m.accuracy ?? p.accuracy });
  }

  await audit(u, { action: 'complaint.create', entityType: 'complaint', entityId: code, newValue: { category: cat.code, localBodyId: lb.id, wardId: ward?.id ?? null, priority, evidence: files.length, duplicateOverride: p.duplicateOverride } });
  await notify(u.id, 'SUBMITTED', { code, category_en: cat.name_en as string, category_ta: cat.name_ta as string }, complaintId);

  // AI classification step (system actor) — suggestion only; officials review next.
  const [dept] = routed.departmentId ? await sql`SELECT name_en FROM departments WHERE id = ${routed.departmentId}` : [];
  await transition(complaintId, 'AI_CLASSIFIED', null, {
    note: `Classified as ${cat.name_en} (${a.engine}, confidence ${a.confidence}); routed to ${dept?.name_en ?? 'unassigned department'}`,
    publicNote: false,
    skipCitizenNotify: true,
    auditAction: 'complaint.ai_classified',
  });
  await notifyOfficials(complaintId, 'NEW_COMPLAINT');
  return { ok: true, code, id: complaintId };
});
