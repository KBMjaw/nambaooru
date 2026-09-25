import 'server-only';
import { z } from 'zod';
import { sql } from './db';
import { has, hashPassword, isSystemScope, type AuthUser } from './auth';
import bcrypt from 'bcryptjs';
import { audit, type AuditInput } from './audit';
import { encrypt, decrypt, maskMobile } from './crypto';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { complaintScope, localBodyScope, assertLocalBody } from './scope';
import { passwordSchema, passwordContextIssue } from './validation';
import { tempPassword, type BulkOpts } from './users';

/*
 * Citizen records for officials. Visibility: citizen.view + jurisdiction — a citizen is visible when
 * registered in a local body the official covers, or when they filed a complaint the official can see.
 * Contact details are masked unless the official also holds citizen.pii.view.
 */
export function citizenVisibility(u: AuthUser) {
  if (!has(u, 'citizen.view') && !has(u, 'citizen.manage')) return sql`FALSE`;
  if (isSystemScope(u)) return sql`TRUE`;
  return sql`((${localBodyScope(u, sql`ct.local_body_id`)}) OR EXISTS (SELECT 1 FROM complaints c WHERE c.citizen_id = usr.id AND (${complaintScope(u)})))`;
}

export interface CitizenQuery { q?: string; lb?: string; ward?: string; status?: string; page?: string }

export async function listCitizens(u: AuthUser, f: CitizenQuery, pageSize = 50) {
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const like = f.q ? `%${f.q.trim().slice(0, 60)}%` : null;
  const rows = await sql`
    SELECT usr.id, usr.username, usr.full_name, usr.mobile, usr.email, usr.status, usr.created_at, usr.last_login_at,
           lb.name_en AS lb_en, lb.name_ta AS lb_ta, w.ward_number, d.name_en AS district_en, ct.pincode,
           (SELECT count(*) FROM complaints c WHERE c.citizen_id = usr.id)::int AS complaints,
           (SELECT count(*) FROM complaints c WHERE c.citizen_id = usr.id AND c.status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS open_complaints,
           count(*) OVER()::int AS total_count
    FROM users usr JOIN roles r ON r.id = usr.role_id AND r.code = 'CITIZEN' JOIN citizens ct ON ct.user_id = usr.id
    LEFT JOIN local_bodies lb ON lb.id = ct.local_body_id LEFT JOIN wards w ON w.id = ct.ward_id LEFT JOIN districts d ON d.id = ct.district_id
    WHERE (${citizenVisibility(u)})
      ${like ? sql`AND (usr.full_name ILIKE ${like} OR usr.mobile ILIKE ${like} OR usr.username ILIKE ${like} OR usr.email ILIKE ${like})` : sql``}
      ${f.lb && Number(f.lb) ? sql`AND ct.local_body_id = ${Number(f.lb)}` : sql``}
      ${f.ward && Number(f.ward) ? sql`AND ct.ward_id = ${Number(f.ward)}` : sql``}
      ${f.status ? sql`AND usr.status = ${f.status}` : sql``}
    ORDER BY usr.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const pii = has(u, 'citizen.pii.view');
  return {
    rows: rows.map((r) => ({ ...r, mobile: pii ? r.mobile : maskMobile(r.mobile as string), email: pii ? r.email : r.email ? '•••@•••' : null }) as Record<string, unknown>),
    total: (rows[0]?.total_count as number) ?? 0, page, pageSize,
  };
}

export async function getCitizen(u: AuthUser, id: string) {
  const [c] = await sql`
    SELECT usr.id, usr.username, usr.full_name, usr.mobile, usr.email, usr.status, usr.status_reason, usr.created_at, usr.last_login_at, usr.must_change_password,
           ct.address_enc, ct.landmark, ct.pincode, ct.street_text, ct.district_id, ct.taluk_id, ct.local_body_id, ct.ward_id, ct.street_id, ct.identity_verified,
           d.name_en AS district_en, tk.name_en AS taluk_en, lb.name_en AS lb_en, lb.name_ta AS lb_ta, w.ward_number, s.name_en AS street_en, pl.place_name
    FROM users usr JOIN roles r ON r.id = usr.role_id AND r.code = 'CITIZEN' JOIN citizens ct ON ct.user_id = usr.id
    LEFT JOIN districts d ON d.id = ct.district_id LEFT JOIN taluks tk ON tk.id = ct.taluk_id LEFT JOIN local_bodies lb ON lb.id = ct.local_body_id
    LEFT JOIN wards w ON w.id = ct.ward_id LEFT JOIN streets s ON s.id = ct.street_id LEFT JOIN postal_locations pl ON pl.id = ct.postal_location_id
    WHERE usr.id = ${id} AND (${citizenVisibility(u)})`;
  if (!c) throw notFound('Citizen not found');
  const pii = has(u, 'citizen.pii.view');
  let address = '';
  if (pii) { try { address = decrypt(c.address_enc as string); } catch { address = '(unreadable)'; } }
  const { address_enc: _enc, ...rest } = c as Record<string, unknown>;
  const scope = isSystemScope(u) || has(u, 'complaint.view.all') ? sql`TRUE` : complaintScope(u);
  const complaints = await sql`
    SELECT c.id, c.code, c.status, c.priority, c.created_at, c.submitted_at, c.closed_at, c.sla_due_at, c.title_en, c.title_ta,
           cat.name_en AS category_en, cat.name_ta AS category_ta, cat.icon, au.full_name AS assigned_name, w.ward_number, lb.name_en AS lb_en
    FROM complaints c LEFT JOIN complaint_categories cat ON cat.id = c.category_id LEFT JOIN users au ON au.id = c.assigned_to
    LEFT JOIN wards w ON w.id = c.ward_id LEFT JOIN local_bodies lb ON lb.id = c.local_body_id
    WHERE c.citizen_id = ${id} AND (${scope}) ORDER BY c.created_at DESC LIMIT 200`;
  const ids = complaints.map((x) => x.id as number);
  const history = ids.length ? await sql`
    SELECT h.complaint_id, h.from_status, h.to_status, h.note, h.actor_label, h.created_at FROM complaint_status_history h
    WHERE h.complaint_id IN ${sql(ids)} ORDER BY h.created_at` : [];
  const [hidden] = await sql`SELECT count(*)::int AS n FROM complaints WHERE citizen_id = ${id}`;
  return {
    citizen: { ...rest, address, mobile: pii ? rest.mobile : maskMobile(rest.mobile as string), email: pii ? rest.email : rest.email ? '•••@•••' : null, pii } as Record<string, unknown>,
    complaints: [...complaints], history: [...history], totalComplaints: hidden.n as number,
  };
}

const optId = z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : v));
export const CitizenInput = z.object({
  fullName: z.string().trim().min(2).max(100),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'err.mobile'),
  email: z.union([z.string().trim().email().max(120), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  username: z.union([z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  password: z.union([passwordSchema, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  localBodyId: optId, wardId: optId, streetId: optId,
  streetText: z.string().trim().max(120).optional().nullable().transform((v) => (v ? v : null)),
  pincode: z.union([z.string().regex(/^[1-9]\d{5}$/, 'err.pincode'), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  address: z.string().trim().max(200).optional().nullable().transform((v) => (v ? v : null)),
  landmark: z.string().trim().max(120).optional().nullable().transform((v) => (v ? v : null)),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
  reason: z.string().trim().max(500).optional().nullable(),
});

/** Partial update — no defaults, so fields that are not sent stay untouched. */
export const CitizenUpdate = CitizenInput.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).partial();

async function resolveCitizenLocation(u: AuthUser, d: { localBodyId: number | null; wardId: number | null; streetId: number | null }) {
  if (!d.localBodyId) {
    if (!isSystemScope(u)) throw badRequest('Local body is required', { localBodyId: ['Required'] });
    return { districtId: null, talukId: null };
  }
  await assertLocalBody(u, d.localBodyId);
  const [lb] = await sql`SELECT district_id, taluk_id FROM local_bodies WHERE id = ${d.localBodyId}`;
  if (!lb) throw badRequest('Unknown local body');
  if (d.wardId) {
    const [w] = await sql`SELECT 1 FROM wards WHERE id = ${d.wardId} AND local_body_id = ${d.localBodyId}`;
    if (!w) throw badRequest('Ward does not belong to the local body', { wardId: ['Mismatch'] });
  }
  if (d.streetId) {
    const [s] = await sql`SELECT 1 FROM streets WHERE id = ${d.streetId} AND ward_id = ${d.wardId ?? 0}`;
    if (!s) throw badRequest('Street does not belong to the ward', { streetId: ['Mismatch'] });
  }
  return { districtId: lb.district_id as number, talukId: (lb.taluk_id as number) ?? null };
}

export async function createCitizen(u: AuthUser, input: z.infer<typeof CitizenInput>, opts: BulkOpts = {}) {
  if (!has(u, 'citizen.manage')) throw forbidden();
  const db = opts.db ?? sql;
  const loc = await resolveCitizenLocation(u, input);
  const [dup] = await db`SELECT 1 FROM users x JOIN roles r ON r.id = x.role_id WHERE x.mobile = ${input.mobile} AND r.code = 'CITIZEN'`;
  if (dup) throw conflict('reg.mobileTaken', { mobile: ['reg.mobileTaken'] });
  const username = input.username ?? `c${input.mobile}`;
  const [dupU] = await db`SELECT 1 FROM users WHERE lower(username) = ${username}`;
  if (dupU) throw conflict('Username already exists', { username: ['Taken'] });
  if (input.password) {
    const issue = passwordContextIssue(input.password, { username, mobile: input.mobile });
    if (issue) throw badRequest(issue, { password: [issue] });
  }
  const pw = input.password ?? tempPassword();
  if (input.pincode) await db`INSERT INTO pincodes (pincode) VALUES (${input.pincode}) ON CONFLICT DO NOTHING`;
  const hash = opts.dryRun ? '$2b$04$abcdefghijklmnopqrstuuJ1Q1b5v7v3Qm8lJ2Kk7cQyqfP0N4z9e' : opts.fastHash ? bcrypt.hashSync(pw, 10) : await hashPassword(pw);
  const run = async (tx: typeof db) => {
    const [x] = await tx`
      INSERT INTO users (username, password_hash, full_name, mobile, email, role_id, status, created_by, must_change_password, preferred_language)
      VALUES (${username}, ${hash}, ${input.fullName}, ${input.mobile}, ${input.email}, (SELECT id FROM roles WHERE code = 'CITIZEN'), ${input.status}, ${u.id}, true, 'ta')
      RETURNING id`;
    await tx`
      INSERT INTO citizens (user_id, dob_enc, address_enc, landmark, pincode, district_id, taluk_id, local_body_id, ward_id, street_id, street_text, created_by_official)
      VALUES (${x.id}, NULL, ${encrypt(input.address ?? '')}, ${input.landmark}, ${input.pincode}, ${loc.districtId}, ${loc.talukId}, ${input.localBodyId},
              ${input.wardId}, ${input.streetId}, ${input.streetText}, ${u.id})`;
    await tx`INSERT INTO user_roles (user_id, role_id, assigned_by, reason) VALUES (${x.id}, (SELECT id FROM roles WHERE code = 'CITIZEN'), ${u.id}, 'Created by official')`;
    return x.id as string;
  };
  const id = opts.db ? await run(db) : await sql.begin((tx) => run(tx));
  await (opts.auditSink ?? ((a: AuditInput) => audit(u, a)))({ action: 'CITIZEN_CREATED', entityType: 'user', entityId: id, targetUserId: id, reason: input.reason ?? null,
    newValue: { username, fullName: input.fullName, localBodyId: input.localBodyId, wardId: input.wardId, streetId: input.streetId, status: input.status, credential: input.password ? 'SET_BY_OFFICIAL' : 'TEMPORARY', forcedChangeAtFirstLogin: true, source: opts.source ?? 'FORM' } });
  return { id, username, tempPassword: input.password ? null : pw };
}

export async function updateCitizen(u: AuthUser, id: string, input: z.infer<typeof CitizenUpdate>) {
  if (!has(u, 'citizen.manage')) throw forbidden();
  const { citizen: cur } = await getCitizen(u, id);
  const [raw] = await sql`SELECT mobile, email FROM users WHERE id = ${id}`;
  const next = {
    fullName: input.fullName ?? (cur.full_name as string),
    mobile: input.mobile ?? (raw.mobile as string),
    email: input.email !== undefined ? input.email : (raw.email as string | null),
    localBodyId: input.localBodyId !== undefined ? input.localBodyId : (cur.local_body_id as number | null),
    wardId: input.wardId !== undefined ? input.wardId : (cur.ward_id as number | null),
    streetId: input.streetId !== undefined ? input.streetId : (cur.street_id as number | null),
    streetText: input.streetText !== undefined ? input.streetText : (cur.street_text as string | null),
    pincode: input.pincode !== undefined ? input.pincode : (cur.pincode as string | null),
    landmark: input.landmark !== undefined ? input.landmark : (cur.landmark as string | null),
  };
  const loc = await resolveCitizenLocation(u, next);
  if (next.mobile !== raw.mobile) {
    const [dup] = await sql`SELECT 1 FROM users x JOIN roles r ON r.id = x.role_id WHERE x.mobile = ${next.mobile} AND r.code = 'CITIZEN' AND x.id <> ${id}`;
    if (dup) throw conflict('reg.mobileTaken', { mobile: ['reg.mobileTaken'] });
  }
  const statusChanged = !!input.status && input.status !== cur.status;
  if (statusChanged && input.status === 'INACTIVE' && (!input.reason || input.reason.length < 3)) throw badRequest('err.reasonRequired', { reason: ['err.reasonRequired'] });
  if (next.pincode) await sql`INSERT INTO pincodes (pincode) VALUES (${next.pincode}) ON CONFLICT DO NOTHING`;
  await sql.begin(async (tx) => {
    await tx`UPDATE users SET full_name = ${next.fullName}, mobile = ${next.mobile}, email = ${next.email}, updated_at = now() WHERE id = ${id}`;
    await tx`UPDATE citizens SET local_body_id = ${next.localBodyId}, ward_id = ${next.wardId}, street_id = ${next.streetId}, street_text = ${next.streetText},
               pincode = ${next.pincode}, landmark = ${next.landmark}, district_id = COALESCE(${loc.districtId}, district_id), taluk_id = COALESCE(${loc.talukId}, taluk_id)
               ${input.address != null ? tx`, address_enc = ${encrypt(input.address)}` : tx``}
             WHERE user_id = ${id}`;
    if (statusChanged) {
      await tx`UPDATE users SET status = ${input.status!}, status_reason = ${input.reason ?? null}, token_version = token_version + 1,
                 deactivated_at = ${input.status === 'INACTIVE' ? new Date() : null}, deactivated_by = ${input.status === 'INACTIVE' ? u.id : null} WHERE id = ${id}`;
    }
  });
  const oldV = { fullName: cur.full_name, localBodyId: cur.local_body_id, wardId: cur.ward_id, streetId: cur.street_id, pincode: cur.pincode, landmark: cur.landmark };
  const newV = { fullName: next.fullName, localBodyId: next.localBodyId, wardId: next.wardId, streetId: next.streetId, pincode: next.pincode, landmark: next.landmark };
  const changed = Object.keys(newV).filter((k) => String((oldV as Record<string, unknown>)[k] ?? '') !== String((newV as Record<string, unknown>)[k] ?? ''));
  const extra = [next.mobile !== raw.mobile ? 'mobile' : null, next.email !== raw.email ? 'email' : null, input.address != null ? 'address' : null].filter(Boolean);
  if (changed.length || extra.length) {
    // Contact / address values are PII: the audit notes that they changed, not what they are.
    await audit(u, { action: 'CITIZEN_UPDATED', entityType: 'user', entityId: id, targetUserId: id, reason: input.reason ?? null,
      oldValue: Object.fromEntries(changed.map((k) => [k, (oldV as Record<string, unknown>)[k]])),
      newValue: { ...Object.fromEntries(changed.map((k) => [k, (newV as Record<string, unknown>)[k]])), ...(extra.length ? { contactFieldsChanged: extra } : {}) } });
  }
  if (statusChanged) {
    await audit(u, { action: input.status === 'INACTIVE' ? 'USER_DEACTIVATED' : 'USER_REACTIVATED', entityType: 'user', entityId: id, targetUserId: id,
      reason: input.reason ?? null, oldValue: { status: cur.status }, newValue: { status: input.status } });
  }
  return { ok: true };
}
