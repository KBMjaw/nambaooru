import 'server-only';
import { z } from 'zod';
import { sql } from './db';
import { has, type AuthUser } from './auth';
import { audit } from './audit';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { assertLocalBody, assertWard } from './scope';

/*
 * Dynamic location administration: local bodies (with controlling authority and responsible officer),
 * generated wards, ward details and streets. New places never need a code change. Records are
 * deactivated, never deleted, so historical complaints keep their references.
 */
export const CONTROLLING_AUTHORITIES = ['Executive Officer', 'Commissioner', 'Municipal Commissioner', 'Block Development Officer', 'Panchayat President', 'Special Officer'] as const;

const optId = z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : v));
const optNum = z.union([z.coerce.number(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : v));

export const LocalBodyInput = z.object({
  districtId: z.coerce.number().int().positive(),
  talukId: optId,
  nameEn: z.string().trim().min(2).max(120),
  nameTa: z.string().trim().max(120).optional().nullable().transform((v) => (v ? v : null)),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,40}$/, 'Code: 3–40 letters, digits or dashes').optional().nullable(),
  typeId: z.coerce.number().int().positive(),
  pincode: z.union([z.string().regex(/^[1-9]\d{5}$/, 'err.pincode'), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  controllingAuthority: z.string().trim().min(2).max(80),
  responsibleOfficerId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  centerLat: optNum, centerLng: optNum,
  wardCount: z.coerce.number().int().min(0).max(300).default(0),
  departments: z.array(z.string().max(40)).max(40).default([]),
});

async function checkOfficer(officerId: string | null, localBodyId: number | null) {
  if (!officerId) return;
  const [o] = await sql`SELECT u.id, o.local_body_id FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN officials o ON o.user_id = u.id
                        WHERE u.id = ${officerId} AND u.status = 'ACTIVE' AND r.portal = 'OFFICE'`;
  if (!o) throw badRequest('Responsible officer must be an active official', { responsibleOfficerId: ['Invalid'] });
  if (localBodyId && o.local_body_id && o.local_body_id !== localBodyId) throw badRequest('Responsible officer belongs to another local body', { responsibleOfficerId: ['Mismatch'] });
}

export async function createLocalBody(u: AuthUser, d: z.infer<typeof LocalBodyInput>) {
  if (!has(u, 'location.manage')) throw forbidden();
  const [dist] = await sql`SELECT id, code FROM districts WHERE id = ${d.districtId}`;
  if (!dist) throw badRequest('Unknown district', { districtId: ['Unknown'] });
  if (d.talukId) {
    const [tk] = await sql`SELECT 1 FROM taluks WHERE id = ${d.talukId} AND district_id = ${d.districtId}`;
    if (!tk) throw badRequest('Taluk is not in the district', { talukId: ['Mismatch'] });
  }
  const [type] = await sql`SELECT id, code, category FROM local_body_types WHERE id = ${d.typeId}`;
  if (!type) throw badRequest('Unknown local body type', { typeId: ['Unknown'] });
  const [dupName] = await sql`SELECT 1 FROM local_bodies WHERE district_id = ${d.districtId} AND type_id = ${d.typeId} AND lower(name_en) = ${d.nameEn.toLowerCase()}`;
  if (dupName) throw conflict('A local body with this name and type already exists in the district', { nameEn: ['Taken'] });
  const prefix = ({ CORPORATION: 'CORP', MUNICIPALITY: 'MUN', TOWN_PANCHAYAT: 'TP', VILLAGE_PANCHAYAT: 'VP' } as Record<string, string>)[type.code as string] ?? 'LB';
  const code = d.code || `${prefix}-${dist.code}-${d.nameEn.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 24)}`;
  const [dupCode] = await sql`SELECT 1 FROM local_bodies WHERE code = ${code}`;
  if (dupCode) throw conflict(`Code ${code} is already used`, { code: ['Taken'] });
  await checkOfficer(d.responsibleOfficerId, null);
  if (d.pincode) await sql`INSERT INTO pincodes (pincode) VALUES (${d.pincode}) ON CONFLICT DO NOTHING`;
  const templates = d.departments.length
    ? await sql`SELECT DISTINCT ON (code) code, name_en, name_ta FROM departments WHERE code IN ${sql(d.departments)} ORDER BY code, local_body_id NULLS LAST`
    : [];
  const lb = await sql.begin(async (tx) => {
    const [row] = await tx`
      INSERT INTO local_bodies (code, type_id, district_id, taluk_id, name_en, name_ta, center_lat, center_lng, status, controlling_authority, responsible_officer_id, pincode, ward_count, created_by)
      VALUES (${code}, ${d.typeId}, ${d.districtId}, ${d.talukId}, ${d.nameEn}, ${d.nameTa}, ${d.centerLat}, ${d.centerLng}, ${d.status}, ${d.controllingAuthority},
              ${d.responsibleOfficerId}, ${d.pincode}, ${d.wardCount}, ${u.id}) RETURNING id`;
    for (let n = 1; n <= d.wardCount; n++) await tx`INSERT INTO wards (local_body_id, ward_number, name_en) VALUES (${row.id}, ${n}, ${`Ward ${n}`})`;
    for (const t of templates) await tx`INSERT INTO departments (code, local_body_id, name_en, name_ta) VALUES (${t.code}, ${row.id}, ${t.name_en}, ${t.name_ta}) ON CONFLICT DO NOTHING`;
    return row;
  });
  await audit(u, { action: 'LOCATION_CREATED', entityType: 'local_bodies', entityId: lb.id as number,
    newValue: { code, name: d.nameEn, type: type.code, category: type.category, districtId: d.districtId, talukId: d.talukId, controllingAuthority: d.controllingAuthority,
      responsibleOfficerId: d.responsibleOfficerId, pincode: d.pincode, status: d.status, departments: templates.map((t) => t.code) } });
  if (d.wardCount) await audit(u, { action: 'WARD_CREATED', entityType: 'wards', entityId: `lb:${lb.id}`, newValue: { localBodyId: lb.id, wards: `1–${d.wardCount}`, count: d.wardCount } });
  return { ok: true, id: lb.id as number, code };
}

export const LocalBodyUpdate = LocalBodyInput.omit({ wardCount: true, departments: true, districtId: true })
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).partial().extend({ reason: z.string().trim().max(500).optional().nullable() });

export async function updateLocalBody(u: AuthUser, id: number, d: z.infer<typeof LocalBodyUpdate>) {
  if (!has(u, 'location.manage')) throw forbidden();
  const [cur] = await sql`SELECT * FROM local_bodies WHERE id = ${id}`;
  if (!cur) throw notFound();
  if (d.talukId) {
    const [tk] = await sql`SELECT 1 FROM taluks WHERE id = ${d.talukId} AND district_id = ${cur.district_id}`;
    if (!tk) throw badRequest('Taluk is not in the district', { talukId: ['Mismatch'] });
  }
  if (d.responsibleOfficerId !== undefined) await checkOfficer(d.responsibleOfficerId, id);
  const map: Record<string, string> = {
    talukId: 'taluk_id', nameEn: 'name_en', nameTa: 'name_ta', typeId: 'type_id', pincode: 'pincode', controllingAuthority: 'controlling_authority',
    responsibleOfficerId: 'responsible_officer_id', status: 'status', centerLat: 'center_lat', centerLng: 'center_lng', code: 'code',
  };
  const set: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(map)) {
    const v = (d as Record<string, unknown>)[k];
    if (v !== undefined && String(v ?? '') !== String(cur[col] ?? '')) set[col] = v;
  }
  if (!Object.keys(set).length) return { ok: true };
  if (set.pincode) await sql`INSERT INTO pincodes (pincode) VALUES (${set.pincode as string}) ON CONFLICT DO NOTHING`;
  try { await sql`UPDATE local_bodies SET ${sql(set)} WHERE id = ${id}`; }
  catch (e) { if ((e as { code?: string }).code === '23505') throw conflict('Code already used'); throw e; }
  await audit(u, { action: 'LOCATION_UPDATED', entityType: 'local_bodies', entityId: id, reason: d.reason ?? null,
    oldValue: Object.fromEntries(Object.keys(set).map((k) => [k, cur[k]])), newValue: set });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Wards & streets (ward.manage inside jurisdiction, or location.manage anywhere)
// ---------------------------------------------------------------------------
async function canWard(u: AuthUser, localBodyId: number) {
  if (has(u, 'location.manage')) return;
  if (!has(u, 'ward.manage')) throw forbidden();
  await assertLocalBody(u, localBodyId);
}

export const AddWards = z.object({ localBodyId: z.coerce.number().int().positive(), count: z.coerce.number().int().min(1).max(300) });

/** Append `count` wards after the highest existing ward number. */
export async function addWards(u: AuthUser, d: z.infer<typeof AddWards>) {
  await canWard(u, d.localBodyId);
  const [lb] = await sql`SELECT id FROM local_bodies WHERE id = ${d.localBodyId}`;
  if (!lb) throw notFound();
  const [mx] = await sql`SELECT COALESCE(max(ward_number), 0)::int AS n FROM wards WHERE local_body_id = ${d.localBodyId}`;
  const start = (mx.n as number) + 1;
  await sql.begin(async (tx) => {
    for (let n = start; n < start + d.count; n++) await tx`INSERT INTO wards (local_body_id, ward_number, name_en) VALUES (${d.localBodyId}, ${n}, ${`Ward ${n}`})`;
    await tx`UPDATE local_bodies SET ward_count = (SELECT count(*) FROM wards WHERE local_body_id = ${d.localBodyId}) WHERE id = ${d.localBodyId}`;
  });
  await audit(u, { action: 'WARD_CREATED', entityType: 'wards', entityId: `lb:${d.localBodyId}`, newValue: { localBodyId: d.localBodyId, wards: `${start}–${start + d.count - 1}`, count: d.count } });
  return { ok: true, from: start, to: start + d.count - 1 };
}

export const WardUpdate = z.object({
  nameEn: z.string().trim().max(120).optional().nullable(),
  nameTa: z.string().trim().max(120).optional().nullable(),
  population: z.union([z.coerce.number().int().min(0).max(10_000_000), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  description: z.string().trim().max(1000).optional().nullable(),
  streetCount: z.union([z.coerce.number().int().min(0).max(5000), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  centerLat: optNum, centerLng: optNum,
});

export async function updateWard(u: AuthUser, id: number, d: z.infer<typeof WardUpdate>) {
  const [w] = await sql`SELECT * FROM wards WHERE id = ${id}`;
  if (!w) throw notFound();
  await canWard(u, w.local_body_id as number);
  if (!has(u, 'location.manage')) await assertWard(u, id);
  const map: Record<string, string> = { nameEn: 'name_en', nameTa: 'name_ta', population: 'population', description: 'description', streetCount: 'street_count', status: 'status', centerLat: 'center_lat', centerLng: 'center_lng' };
  const set: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(map)) {
    const v = (d as Record<string, unknown>)[k];
    if (v !== undefined && String(v ?? '') !== String(w[col] ?? '')) set[col] = v === '' ? null : v;
  }
  if (!Object.keys(set).length) return { ok: true };
  await sql`UPDATE wards SET ${sql(set)} WHERE id = ${id}`;
  await audit(u, { action: 'WARD_UPDATED', entityType: 'wards', entityId: id, oldValue: Object.fromEntries(Object.keys(set).map((k) => [k, w[k]])), newValue: set });
  return { ok: true };
}

export const StreetInput = z.object({
  nameEn: z.string().trim().min(2).max(120),
  nameTa: z.string().trim().max(120).optional().nullable().transform((v) => (v ? v : null)),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export async function addStreet(u: AuthUser, wardId: number, d: z.infer<typeof StreetInput>) {
  const [w] = await sql`SELECT id, local_body_id FROM wards WHERE id = ${wardId}`;
  if (!w) throw notFound();
  await canWard(u, w.local_body_id as number);
  if (!has(u, 'location.manage')) await assertWard(u, wardId);
  try {
    const [s] = await sql`INSERT INTO streets (ward_id, name_en, name_ta) VALUES (${wardId}, ${d.nameEn}, ${d.nameTa}) RETURNING id`;
    await audit(u, { action: 'LOCATION_CREATED', entityType: 'streets', entityId: s.id as number, newValue: { wardId, name: d.nameEn, nameTa: d.nameTa } });
    return { ok: true, id: s.id as number };
  } catch (e) { if ((e as { code?: string }).code === '23505') throw conflict('This street already exists in the ward'); throw e; }
}

export async function updateStreet(u: AuthUser, id: number, d: Partial<z.infer<typeof StreetInput>>) {
  const [s] = await sql`SELECT s.*, w.local_body_id FROM streets s JOIN wards w ON w.id = s.ward_id WHERE s.id = ${id}`;
  if (!s) throw notFound();
  await canWard(u, s.local_body_id as number);
  if (!has(u, 'location.manage')) await assertWard(u, s.ward_id as number);
  const set: Record<string, unknown> = {};
  if (d.nameEn !== undefined && d.nameEn !== s.name_en) set.name_en = d.nameEn;
  if (d.nameTa !== undefined && d.nameTa !== s.name_ta) set.name_ta = d.nameTa;
  if (d.status !== undefined && d.status !== s.status) set.status = d.status;
  if (!Object.keys(set).length) return { ok: true };
  await sql`UPDATE streets SET ${sql(set)} WHERE id = ${id}`;
  await audit(u, { action: 'LOCATION_UPDATED', entityType: 'streets', entityId: id, oldValue: Object.fromEntries(Object.keys(set).map((k) => [k, s[k]])), newValue: set });
  return { ok: true };
}
