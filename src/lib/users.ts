import 'server-only';
import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import type postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { sql } from './db';
import { has, hashPassword, isSystemScope, type AuthUser, type RoleScope } from './auth';
import { audit, type AuditInput } from './audit';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { localBodyScope, assertLocalBody, type Frag } from './scope';
import { passwordSchema, passwordContextIssue } from './validation';

type Db = postgres.Sql | postgres.TransactionSql;

export interface RoleRow {
  id: number; code: string; name_en: string; name_ta: string; portal: string; rank: number; default_scope: RoleScope;
  department_code: string | null; is_system: boolean; status: string; description: string | null;
}

// ---------------------------------------------------------------------------
// Hierarchy guard — decided on the server from DB state only.
// ---------------------------------------------------------------------------

/** Can the actor create / edit / reset / deactivate users holding this role? */
export function canManageRole(actor: AuthUser, role: Pick<RoleRow, 'code' | 'rank' | 'portal' | 'default_scope'>) {
  if (role.code === 'CITIZEN') return false; // citizens are managed through the citizen module
  if (has(actor, 'user.manage.all')) return true; // Super Admin: every role, including Super Admin
  if (!has(actor, 'user.manage')) return false;
  if (role.code === 'SUPER_ADMIN') return false; // Only Super Admin manages Super Admin — always
  if (role.rank >= actor.roleRank) return false; // never a peer or a superior (Admin cannot create Admins)
  if (!isSystemScope(actor) && (role.portal !== 'OFFICE' || role.default_scope === 'SYSTEM' || role.default_scope === 'DISTRICT')) return false;
  return true;
}

export async function allRoles(): Promise<RoleRow[]> {
  return (await sql`SELECT id, code, name_en, name_ta, portal, rank, default_scope, department_code, is_system, status, description FROM roles ORDER BY rank DESC, name_en`) as unknown as RoleRow[];
}

/** Roles the actor may assign, as full rows (for forms). */
export async function manageableRoles(actor: AuthUser): Promise<RoleRow[]> {
  return (await allRoles()).filter((r) => r.status === 'ACTIVE' && canManageRole(actor, r));
}

/** SQL visibility of staff accounts for the actor. Use with aliases usr / r / o. Citizens are never listed here. */
export function userVisibility(actor: AuthUser) {
  if (!has(actor, 'user.view') && !has(actor, 'user.manage') && !has(actor, 'user.manage.all')) return sql`FALSE`;
  if (isSystemScope(actor)) return sql`r.code <> 'CITIZEN'`;
  // Local officials see operational accounts inside their jurisdiction — never admin-portal accounts.
  return sql`r.portal = 'OFFICE' AND (${localBodyScope(actor, sql`o.local_body_id`)})`;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------
const id = z.coerce.number().int().positive();
const optId = z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : v));
const optStr = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const UserFields = z.object({
  fullName: z.string().trim().min(2).max(100),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'err.mobile'),
  email: z.union([z.string().trim().email().max(120), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  designation: optStr(100),
  employeeId: optStr(40),
  districtId: optId,
  talukId: optId,
  localBodyId: optId,
  wardId: optId,
  departmentId: optId,
  supervisorId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
});

export const CreateUser = UserFields.extend({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3–40 letters, digits, dot, dash, underscore'),
  role: z.string().trim().min(2).max(40),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
  password: z.union([passwordSchema, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  reason: optStr(500),
});
export type CreateUserInput = z.infer<typeof CreateUser>;

export const UpdateUser = UserFields.partial().extend({
  role: z.string().trim().min(2).max(40).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  reason: optStr(500),
});

export const ResetPassword = z.object({
  password: z.union([passwordSchema, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  reason: z.string().trim().min(3, 'err.reasonRequired').max(500),
});

/** Temporary password shown once to the admin; the user must replace it at first login. */
export function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${s.slice(0, 5)}-${s.slice(5)}${randomInt(10, 99)}`;
}

// ---------------------------------------------------------------------------
// Jurisdiction resolution (validates every id against the hierarchy)
// ---------------------------------------------------------------------------
export interface ResolvedJurisdiction {
  stateId: number | null; districtId: number | null; talukId: number | null; localBodyId: number | null; wardId: number | null; departmentId: number | null;
}

export async function resolveJurisdiction(db: Db, j: { districtId?: number | null; talukId?: number | null; localBodyId?: number | null; wardId?: number | null; departmentId?: number | null }): Promise<ResolvedJurisdiction> {
  let { districtId = null, talukId = null } = j;
  const { localBodyId = null, wardId = null, departmentId = null } = j;
  let stateId: number | null = null;
  if (localBodyId) {
    const [lb] = await db`SELECT lb.id, lb.district_id, lb.taluk_id, d.state_id FROM local_bodies lb JOIN districts d ON d.id = lb.district_id WHERE lb.id = ${localBodyId}`;
    if (!lb) throw badRequest('Unknown local body', { localBodyId: ['Unknown'] });
    if (districtId && districtId !== lb.district_id) throw badRequest('Local body is not in the selected district', { localBodyId: ['Mismatch'] });
    if (talukId && lb.taluk_id && talukId !== lb.taluk_id) throw badRequest('Local body is not in the selected taluk', { localBodyId: ['Mismatch'] });
    districtId = lb.district_id as number; talukId = (lb.taluk_id as number) ?? talukId; stateId = lb.state_id as number;
  } else if (talukId) {
    const [t] = await db`SELECT t.district_id, d.state_id FROM taluks t JOIN districts d ON d.id = t.district_id WHERE t.id = ${talukId}`;
    if (!t) throw badRequest('Unknown taluk', { talukId: ['Unknown'] });
    if (districtId && districtId !== t.district_id) throw badRequest('Taluk is not in the selected district', { talukId: ['Mismatch'] });
    districtId = t.district_id as number; stateId = t.state_id as number;
  } else if (districtId) {
    const [d] = await db`SELECT state_id FROM districts WHERE id = ${districtId}`;
    if (!d) throw badRequest('Unknown district', { districtId: ['Unknown'] });
    stateId = d.state_id as number;
  }
  if (wardId) {
    const [w] = await db`SELECT 1 FROM wards WHERE id = ${wardId} AND local_body_id = ${localBodyId ?? 0}`;
    if (!w) throw badRequest('Ward does not belong to the local body', { wardId: ['Mismatch'] });
  }
  if (departmentId) {
    const [d] = await db`SELECT 1 FROM departments WHERE id = ${departmentId} AND (local_body_id = ${localBodyId ?? 0} OR local_body_id IS NULL)`;
    if (!d) throw badRequest('Department does not belong to the local body', { departmentId: ['Mismatch'] });
  }
  return { stateId, districtId, talukId, localBodyId, wardId, departmentId };
}

/** Role-scope-specific mandatory jurisdiction fields. */
function requireForScope(scope: RoleScope, j: ResolvedJurisdiction) {
  const miss = (f: string) => { throw badRequest(`${f} is required for this role`, { [f]: ['Required'] }); };
  if (scope === 'DISTRICT' && !j.districtId) miss('districtId');
  if (['LOCAL_BODY', 'DEPARTMENT', 'WARD', 'ASSIGNED'].includes(scope) && !j.localBodyId) miss('localBodyId');
  if (scope === 'DEPARTMENT' && !j.departmentId) miss('departmentId');
  if (scope === 'WARD' && !j.wardId) miss('wardId');
}

async function checkSupervisor(db: Db, supervisorId: string | null, role: RoleRow, j: ResolvedJurisdiction) {
  if (!supervisorId) return;
  const [s] = await db`SELECT r.rank, o.local_body_id FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN officials o ON o.user_id = u.id
                       WHERE u.id = ${supervisorId} AND u.status = 'ACTIVE' AND r.portal IN ('OFFICE','ADMIN')`;
  if (!s) throw badRequest('Supervisor not found', { supervisorId: ['Unknown'] });
  if ((s.rank as number) <= role.rank) throw badRequest('Supervisor must hold a higher role', { supervisorId: ['Rank'] });
  if (j.localBodyId && s.local_body_id && s.local_body_id !== j.localBodyId) throw badRequest('Supervisor must be from the same local body', { supervisorId: ['Mismatch'] });
}

async function roleByCode(db: Db, code: string): Promise<RoleRow> {
  const [r] = await db`SELECT id, code, name_en, name_ta, portal, rank, default_scope, department_code, is_system, status, description
                       FROM roles WHERE code = ${code} OR lower(name_en) = ${code.toLowerCase()} LIMIT 1`;
  if (!r) throw badRequest('Unknown role', { role: ['Unknown'] });
  return r as unknown as RoleRow;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export interface BulkOpts { db?: Db; source?: string; fastHash?: boolean; dryRun?: boolean; auditSink?: (a: AuditInput) => void }
const DRY_HASH = '$2b$04$abcdefghijklmnopqrstuuJ1Q1b5v7v3Qm8lJ2Kk7cQyqfP0N4z9e';

export async function createUser(actor: AuthUser, input: CreateUserInput, opts: BulkOpts = {}) {
  const db = opts.db ?? sql;
  const role = await roleByCode(db, input.role);
  if (role.status !== 'ACTIVE') throw badRequest('This role is inactive', { role: ['Inactive'] });
  if (!canManageRole(actor, role)) throw forbidden('You cannot create users with this role');
  const j = await resolveJurisdiction(db, input);
  requireForScope(role.default_scope, j);
  if (role.default_scope === 'SYSTEM') Object.assign(j, { stateId: null, districtId: null, talukId: null, localBodyId: null, wardId: null, departmentId: null });
  if (!isSystemScope(actor)) await assertLocalBody(actor, j.localBodyId);
  await checkSupervisor(db, input.supervisorId, role, j);

  const [dupU] = await db`SELECT 1 FROM users WHERE lower(username) = ${input.username}`;
  if (dupU) throw conflict('Username already exists', { username: ['Taken'] });
  const [dupM] = await db`SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.mobile = ${input.mobile} AND r.portal <> 'PUBLIC' AND u.status = 'ACTIVE'`;
  if (dupM) throw conflict('Mobile number already used by another official', { mobile: ['Taken'] });
  if (input.password) {
    const issue = passwordContextIssue(input.password, { username: input.username, mobile: input.mobile });
    if (issue) throw badRequest(issue, { password: [issue] });
  }
  const pw = input.password ?? tempPassword();
  const hash = opts.dryRun ? DRY_HASH : opts.fastHash ? bcrypt.hashSync(pw, 10) : await hashPassword(pw);

  const run = async (tx: Db) => {
    const [u] = await tx`
      INSERT INTO users (username, password_hash, full_name, mobile, email, role_id, status, created_by, must_change_password, deactivated_at, deactivated_by)
      VALUES (${input.username}, ${hash}, ${input.fullName}, ${input.mobile}, ${input.email}, ${role.id}, ${input.status}, ${actor.id}, true,
              ${input.status === 'INACTIVE' ? new Date() : null}, ${input.status === 'INACTIVE' ? actor.id : null})
      RETURNING id`;
    const deptId = j.departmentId ?? (role.department_code && j.localBodyId
      ? ((await tx`SELECT id FROM departments WHERE code = ${role.department_code} AND local_body_id = ${j.localBodyId}`)[0]?.id as number | undefined) ?? null
      : null);
    await tx`
      INSERT INTO officials (user_id, designation, employee_id, department_id, local_body_id, ward_id, supervisor_id, jurisdiction)
      VALUES (${u.id}, ${input.designation ?? role.name_en}, ${input.employeeId}, ${deptId}, ${j.localBodyId}, ${j.wardId}, ${input.supervisorId}, NULL)`;
    await tx`INSERT INTO user_roles (user_id, role_id, assigned_by, reason) VALUES (${u.id}, ${role.id}, ${actor.id}, ${opts.source ?? 'Account created'})`;
    if (j.districtId || j.localBodyId) {
      await tx`INSERT INTO user_jurisdictions (user_id, state_id, district_id, taluk_id, local_body_id, ward_id, department_id, is_primary, granted_by)
               VALUES (${u.id}, ${j.stateId}, ${j.districtId}, ${j.talukId}, ${j.localBodyId}, ${j.wardId}, ${deptId}, true, ${actor.id})`;
    }
    return { id: u.id as string, deptId };
  };
  const created = opts.db ? await run(db) : await sql.begin((tx) => run(tx));

  await (opts.auditSink ?? ((a: AuditInput) => audit(actor, a)))({
    action: 'USER_CREATED', entityType: 'user', entityId: created.id, targetUserId: created.id, reason: input.reason,
    newValue: {
      username: input.username, fullName: input.fullName, role: role.code, status: input.status, designation: input.designation, employeeId: input.employeeId,
      districtId: j.districtId, talukId: j.talukId, localBodyId: j.localBodyId, wardId: j.wardId, departmentId: created.deptId, supervisorId: input.supervisorId,
      credential: input.password ? 'SET_BY_ADMIN' : 'TEMPORARY', forcedChangeAtFirstLogin: true, source: opts.source ?? 'FORM',
    },
  });
  // The one-time temporary password is returned to the creating admin exactly once and never stored in plain text.
  return { id: created.id, tempPassword: input.password ? null : pw };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
export async function loadManagedUser(actor: AuthUser, userId: string) {
  const [t] = await sql`
    SELECT usr.id, usr.username, usr.full_name, usr.mobile, usr.email, usr.role_id, usr.status, usr.status_reason, usr.preferred_language,
           usr.last_login_at, usr.created_at, usr.updated_at, usr.created_by, usr.deactivated_at, usr.deactivated_by,
           usr.must_change_password, usr.password_changed_at, usr.failed_logins, usr.locked_until,
           r.code AS role, r.rank, r.portal, r.default_scope, r.name_en AS role_en, r.name_ta AS role_ta,
           o.designation, o.employee_id, o.department_id, o.local_body_id, o.ward_id, o.supervisor_id, o.jurisdiction,
           lb.district_id, lb.taluk_id
    FROM users usr JOIN roles r ON r.id = usr.role_id LEFT JOIN officials o ON o.user_id = usr.id LEFT JOIN local_bodies lb ON lb.id = o.local_body_id
    WHERE usr.id = ${userId} AND (${userVisibility(actor)})`;
  if (!t) throw notFound('User not found');
  return t;
}

export interface ListQuery { q?: string; role?: string; status?: string; lb?: string; dept?: string; page?: string; sort?: string }

export async function listUsers(actor: AuthUser, q: ListQuery, pageSize = 50) {
  const search = q.q ? `%${q.q.trim().slice(0, 60)}%` : null;
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const sorts: Record<string, Frag> = {
    name: sql`usr.full_name`, username: sql`usr.username`, role: sql`r.rank DESC, usr.full_name`, created: sql`usr.created_at DESC`,
    login: sql`usr.last_login_at DESC NULLS LAST`, status: sql`usr.status, usr.full_name`,
  };
  const order = sorts[q.sort ?? ''] ?? sorts.role;
  const rows = await sql`
    SELECT usr.id, usr.username, usr.full_name, usr.mobile, usr.email, usr.status, usr.created_at, usr.last_login_at, usr.must_change_password,
           r.code AS role, r.name_en AS role_en, r.name_ta AS role_ta, r.rank, r.portal, r.default_scope,
           o.designation, o.employee_id, o.department_id, o.local_body_id, o.ward_id, o.supervisor_id,
           d.name_en AS dept_en, d.name_ta AS dept_ta, lb.name_en AS lb_en, lb.name_ta AS lb_ta, w.ward_number, s.full_name AS supervisor_name,
           count(*) OVER()::int AS total_count
    FROM users usr JOIN roles r ON r.id = usr.role_id LEFT JOIN officials o ON o.user_id = usr.id
    LEFT JOIN departments d ON d.id = o.department_id LEFT JOIN local_bodies lb ON lb.id = o.local_body_id LEFT JOIN wards w ON w.id = o.ward_id
    LEFT JOIN users s ON s.id = o.supervisor_id
    WHERE (${userVisibility(actor)})
      ${search ? sql`AND (usr.full_name ILIKE ${search} OR usr.username ILIKE ${search} OR usr.mobile ILIKE ${search} OR o.employee_id ILIKE ${search} OR o.designation ILIKE ${search})` : sql``}
      ${q.role ? sql`AND r.code = ${q.role}` : sql``}
      ${q.status ? sql`AND usr.status = ${q.status}` : sql``}
      ${q.lb && Number(q.lb) ? sql`AND o.local_body_id = ${Number(q.lb)}` : sql``}
      ${q.dept && Number(q.dept) ? sql`AND o.department_id = ${Number(q.dept)}` : sql``}
    ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  return { rows: [...rows], total: (rows[0]?.total_count as number) ?? 0, page, pageSize };
}

// ---------------------------------------------------------------------------
// Update (role, jurisdiction, status, profile) — every change keeps history
// ---------------------------------------------------------------------------
export async function updateUser(actor: AuthUser, userId: string, input: z.infer<typeof UpdateUser>) {
  const target = await loadManagedUser(actor, userId);
  const current = await roleByCode(sql, target.role as string);
  if (!canManageRole(actor, current)) throw forbidden('You cannot modify this account');
  const nextRole = input.role && input.role !== current.code ? await roleByCode(sql, input.role) : current;
  if (nextRole !== current) {
    if (!canManageRole(actor, nextRole)) throw forbidden('You cannot assign this role');
    if (nextRole.status !== 'ACTIVE') throw badRequest('This role is inactive');
  }
  const self = target.id === actor.id;
  if (self && (input.status === 'INACTIVE' || nextRole !== current)) throw forbidden('You cannot deactivate or change the role of your own account');
  if (current.code === 'SUPER_ADMIN' && (input.status === 'INACTIVE' || nextRole !== current)) {
    const [n] = await sql`SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'SUPER_ADMIN' AND u.status = 'ACTIVE'`;
    if ((n.n as number) <= 1) throw forbidden('The last active Super Admin cannot be deactivated or demoted');
  }

  const pick = <T>(k: keyof typeof input, cur: T): T => (input[k] !== undefined ? (input[k] as T) : cur);
  const jIn = {
    districtId: pick('districtId', target.district_id as number | null),
    talukId: pick('talukId', target.taluk_id as number | null),
    localBodyId: pick('localBodyId', target.local_body_id as number | null),
    wardId: pick('wardId', target.ward_id as number | null),
    departmentId: pick('departmentId', target.department_id as number | null),
  };
  // Changing the local body invalidates old district/taluk unless given again
  if (input.localBodyId !== undefined && input.localBodyId !== target.local_body_id) {
    if (input.districtId === undefined) jIn.districtId = null;
    if (input.talukId === undefined) jIn.talukId = null;
    if (input.wardId === undefined) jIn.wardId = null;
    if (input.departmentId === undefined) jIn.departmentId = null;
  }
  const j = await resolveJurisdiction(sql, jIn);
  if (nextRole.default_scope === 'SYSTEM') Object.assign(j, { stateId: null, districtId: null, talukId: null, localBodyId: null, wardId: null, departmentId: null });
  requireForScope(nextRole.default_scope, j);
  if (!isSystemScope(actor)) await assertLocalBody(actor, j.localBodyId);

  const next = {
    fullName: pick('fullName', target.full_name as string), mobile: pick('mobile', target.mobile as string), email: pick('email', target.email as string | null),
    designation: pick('designation', target.designation as string | null), employeeId: pick('employeeId', target.employee_id as string | null),
    supervisorId: pick('supervisorId', target.supervisor_id as string | null),
  };
  if (next.supervisorId === userId) throw badRequest('A user cannot supervise themselves');
  await checkSupervisor(sql, next.supervisorId, nextRole, j);
  if (next.mobile !== target.mobile) {
    const [dupM] = await sql`SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.mobile = ${next.mobile} AND r.portal <> 'PUBLIC' AND u.status = 'ACTIVE' AND u.id <> ${userId}`;
    if (dupM) throw conflict('Mobile number already used by another official', { mobile: ['Taken'] });
  }

  const roleChanged = nextRole.id !== current.id;
  const oldJ = { districtId: target.district_id ?? null, talukId: target.taluk_id ?? null, localBodyId: target.local_body_id ?? null, wardId: target.ward_id ?? null, departmentId: target.department_id ?? null };
  const newJ = { districtId: j.districtId, talukId: j.talukId, localBodyId: j.localBodyId, wardId: j.wardId, departmentId: j.departmentId };
  const jChanged = (['localBodyId', 'wardId', 'departmentId'] as const).some((k) => (oldJ[k] ?? null) !== (newJ[k] ?? null))
    || (!newJ.localBodyId && (oldJ.districtId ?? null) !== (newJ.districtId ?? null));
  const statusChanged = !!input.status && input.status !== target.status;
  const reason = input.reason ?? null;
  if ((roleChanged || jChanged || (statusChanged && input.status === 'INACTIVE')) && (!reason || reason.length < 3)) {
    throw badRequest('err.reasonRequired', { reason: ['err.reasonRequired'] });
  }
  const profileOld = { fullName: target.full_name, mobile: target.mobile, email: target.email, designation: target.designation, employeeId: target.employee_id, supervisorId: target.supervisor_id };
  const profileChanges = Object.fromEntries(Object.entries(next).filter(([k, v]) => String((profileOld as Record<string, unknown>)[k] ?? '') !== String(v ?? '')));

  await sql.begin(async (tx) => {
    await tx`UPDATE users SET full_name = ${next.fullName}, mobile = ${next.mobile}, email = ${next.email}, role_id = ${nextRole.id}, updated_at = now() WHERE id = ${userId}`;
    await tx`
      INSERT INTO officials (user_id, designation, employee_id, department_id, local_body_id, ward_id, supervisor_id)
      VALUES (${userId}, ${next.designation}, ${next.employeeId}, ${j.departmentId}, ${j.localBodyId}, ${j.wardId}, ${next.supervisorId})
      ON CONFLICT (user_id) DO UPDATE SET designation = EXCLUDED.designation, employee_id = EXCLUDED.employee_id, department_id = EXCLUDED.department_id,
        local_body_id = EXCLUDED.local_body_id, ward_id = EXCLUDED.ward_id, supervisor_id = EXCLUDED.supervisor_id`;
    if (roleChanged) {
      await tx`UPDATE user_roles SET revoked_at = now(), revoked_by = ${actor.id} WHERE user_id = ${userId} AND revoked_at IS NULL`;
      await tx`INSERT INTO user_roles (user_id, role_id, assigned_by, reason) VALUES (${userId}, ${nextRole.id}, ${actor.id}, ${reason})`;
      await tx`UPDATE users SET token_version = token_version + 1 WHERE id = ${userId}`;
    }
    if (jChanged || roleChanged) {
      await tx`UPDATE user_jurisdictions SET revoked_at = now(), revoked_by = ${actor.id}, reason = ${reason}
               WHERE user_id = ${userId} AND is_primary AND revoked_at IS NULL`;
      if (j.districtId || j.localBodyId) {
        await tx`INSERT INTO user_jurisdictions (user_id, state_id, district_id, taluk_id, local_body_id, ward_id, department_id, is_primary, granted_by, reason)
                 VALUES (${userId}, ${j.stateId}, ${j.districtId}, ${j.talukId}, ${j.localBodyId}, ${j.wardId}, ${j.departmentId}, true, ${actor.id}, ${reason})`;
      }
    }
    if (statusChanged) {
      // Deactivation keeps the record (history and audit keep the identity) and revokes every session.
      await tx`UPDATE users SET status = ${input.status!}, status_reason = ${reason}, token_version = token_version + 1,
                 deactivated_at = ${input.status === 'INACTIVE' ? new Date() : null}, deactivated_by = ${input.status === 'INACTIVE' ? actor.id : null},
                 failed_logins = 0, locked_until = NULL WHERE id = ${userId}`;
    }
  });

  const base = { entityType: 'user', entityId: userId, targetUserId: userId, reason };
  if (roleChanged) await audit(actor, { ...base, action: 'ROLE_CHANGED', oldValue: { role: current.code }, newValue: { role: nextRole.code } });
  if (jChanged) await audit(actor, { ...base, action: 'JURISDICTION_CHANGED', oldValue: oldJ, newValue: newJ });
  if (statusChanged) await audit(actor, { ...base, action: input.status === 'INACTIVE' ? 'USER_DEACTIVATED' : 'USER_REACTIVATED', oldValue: { status: target.status }, newValue: { status: input.status } });
  if (Object.keys(profileChanges).length) {
    await audit(actor, { ...base, action: 'USER_UPDATED', oldValue: Object.fromEntries(Object.keys(profileChanges).map((k) => [k, (profileOld as Record<string, unknown>)[k]])), newValue: profileChanges });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Password reset by an administrator — the admin never sees the user's own password
// ---------------------------------------------------------------------------
export async function resetPassword(actor: AuthUser, userId: string, input: z.infer<typeof ResetPassword>, opts: { allowCitizen?: boolean } = {}) {
  if (!has(actor, 'user.password_reset') && !has(actor, 'user.manage.all')) throw forbidden();
  let username: string, mobile: string;
  if (opts.allowCitizen) {
    const [c] = await sql`SELECT u.username, u.mobile FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${userId} AND r.code = 'CITIZEN'`;
    if (!c) throw notFound();
    username = c.username as string; mobile = c.mobile as string;
  } else {
    const target = await loadManagedUser(actor, userId);
    if (!canManageRole(actor, await roleByCode(sql, target.role as string))) throw forbidden('You cannot reset this account');
    username = target.username as string; mobile = target.mobile as string;
  }
  if (userId === actor.id) throw badRequest('Use “Change password” on your profile for your own account');
  if (input.password) {
    const issue = passwordContextIssue(input.password, { username, mobile });
    if (issue) throw badRequest(issue, { password: [issue] });
  }
  const pw = input.password ?? tempPassword();
  await sql`UPDATE users SET password_hash = ${await hashPassword(pw)}, must_change_password = true, password_changed_at = now(),
              token_version = token_version + 1, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = ${userId}`;
  await audit(actor, {
    action: 'PASSWORD_RESET', entityType: 'user', entityId: userId, targetUserId: userId, reason: input.reason,
    newValue: { source: has(actor, 'user.manage.all') ? 'SUPER_ADMIN_RESET' : 'ADMIN_RESET', credential: input.password ? 'SET_BY_ADMIN' : 'TEMPORARY', forcedChangeAtNextLogin: true, sessionsRevoked: true },
  });
  return { ok: true, tempPassword: input.password ? null : pw };
}

// ---------------------------------------------------------------------------
// Additional jurisdictions & per-user permission overrides
// ---------------------------------------------------------------------------
export const JurisdictionInput = z.object({
  districtId: optId, talukId: optId, localBodyId: optId, wardId: optId, departmentId: optId,
  reason: z.string().trim().min(3, 'err.reasonRequired').max(500),
});

export async function addJurisdiction(actor: AuthUser, userId: string, input: z.infer<typeof JurisdictionInput>) {
  const target = await loadManagedUser(actor, userId);
  if (!canManageRole(actor, await roleByCode(sql, target.role as string))) throw forbidden();
  const j = await resolveJurisdiction(sql, input);
  if (!j.districtId && !j.localBodyId && !has(actor, 'user.manage.all')) throw forbidden('Only Super Admin can grant state-wide jurisdiction');
  if (!isSystemScope(actor)) {
    if (!j.localBodyId) throw forbidden('You can only grant jurisdiction inside your own local body');
    await assertLocalBody(actor, j.localBodyId);
  }
  const [row] = await sql`
    INSERT INTO user_jurisdictions (user_id, state_id, district_id, taluk_id, local_body_id, ward_id, department_id, is_primary, granted_by, reason)
    VALUES (${userId}, ${j.stateId}, ${j.districtId}, ${j.talukId}, ${j.localBodyId}, ${j.wardId}, ${j.departmentId}, false, ${actor.id}, ${input.reason}) RETURNING id`;
  await sql`UPDATE users SET token_version = token_version + 1 WHERE id = ${userId}`;
  await audit(actor, { action: 'JURISDICTION_CHANGED', entityType: 'user', entityId: userId, targetUserId: userId, reason: input.reason, newValue: { added: { id: row.id, ...j } } });
  return { ok: true, id: row.id };
}

export async function revokeJurisdiction(actor: AuthUser, userId: string, jurisdictionId: number, reason: string) {
  const target = await loadManagedUser(actor, userId);
  if (!canManageRole(actor, await roleByCode(sql, target.role as string))) throw forbidden();
  const [row] = await sql`SELECT * FROM user_jurisdictions WHERE id = ${jurisdictionId} AND user_id = ${userId} AND revoked_at IS NULL`;
  if (!row) throw notFound();
  if (row.is_primary) throw badRequest('Change the primary jurisdiction by editing the user');
  if (!isSystemScope(actor)) await assertLocalBody(actor, row.local_body_id as number | null);
  await sql`UPDATE user_jurisdictions SET revoked_at = now(), revoked_by = ${actor.id}, reason = ${reason} WHERE id = ${jurisdictionId}`;
  await sql`UPDATE users SET token_version = token_version + 1 WHERE id = ${userId}`;
  await audit(actor, { action: 'JURISDICTION_CHANGED', entityType: 'user', entityId: userId, targetUserId: userId, reason,
    oldValue: { removed: { id: row.id, districtId: row.district_id, talukId: row.taluk_id, localBodyId: row.local_body_id, wardId: row.ward_id, departmentId: row.department_id } } });
  return { ok: true };
}

export const PermissionOverride = z.object({
  permission: z.string().min(3).max(60),
  effect: z.enum(['GRANT', 'DENY', 'NONE']),
  reason: z.string().trim().min(3, 'err.reasonRequired').max(500),
});

const CITIZEN_ONLY = ['complaint.create', 'complaint.view.own', 'appeal.create'];

export async function setPermissionOverride(actor: AuthUser, userId: string, input: z.infer<typeof PermissionOverride>) {
  if (!has(actor, 'permission.manage') && !has(actor, 'user.manage.all')) throw forbidden();
  const target = await loadManagedUser(actor, userId);
  if (!canManageRole(actor, await roleByCode(sql, target.role as string))) throw forbidden();
  if (userId === actor.id) throw forbidden('You cannot change your own permissions');
  const [perm] = await sql`SELECT id, code, is_security FROM permissions WHERE code = ${input.permission}`;
  if (!perm) throw badRequest('Unknown permission');
  if (perm.is_security && !has(actor, 'user.manage.all')) throw forbidden('Security permissions can only be granted by Super Admin');
  if (CITIZEN_ONLY.includes(perm.code as string) && input.effect === 'GRANT') throw forbidden('Citizen-only permission');
  // Nobody can hand out a permission they do not hold themselves (Super Admin excepted).
  if (input.effect === 'GRANT' && !has(actor, 'user.manage.all') && !has(actor, perm.code as string)) throw forbidden('You cannot grant a permission you do not hold');
  const [prev] = await sql`SELECT effect FROM user_permissions WHERE user_id = ${userId} AND permission_id = ${perm.id} AND revoked_at IS NULL`;
  await sql.begin(async (tx) => {
    await tx`UPDATE user_permissions SET revoked_at = now(), revoked_by = ${actor.id} WHERE user_id = ${userId} AND permission_id = ${perm.id} AND revoked_at IS NULL`;
    if (input.effect !== 'NONE') {
      await tx`INSERT INTO user_permissions (user_id, permission_id, effect, granted_by, reason) VALUES (${userId}, ${perm.id}, ${input.effect}, ${actor.id}, ${input.reason})`;
    }
    await tx`UPDATE users SET token_version = token_version + 1 WHERE id = ${userId}`;
  });
  await audit(actor, { action: 'PERMISSION_CHANGED', entityType: 'user', entityId: userId, targetUserId: userId, reason: input.reason,
    oldValue: { permission: perm.code, override: prev?.effect ?? 'NONE' }, newValue: { permission: perm.code, override: input.effect } });
  return { ok: true };
}

/** Everything the user-detail screen needs; history is read from append-only / revoked-not-deleted rows. */
export async function userDetail(actor: AuthUser, userId: string) {
  const t = await loadManagedUser(actor, userId);
  const [jur, roles, perms, overrides, auditRows, sup, stats] = await Promise.all([
    sql`SELECT j.*, d.name_en AS district_en, tk.name_en AS taluk_en, lb.name_en AS lb_en, w.ward_number, dp.name_en AS dept_en,
               g.full_name AS granted_by_name, rv.full_name AS revoked_by_name
        FROM user_jurisdictions j LEFT JOIN districts d ON d.id = j.district_id LEFT JOIN taluks tk ON tk.id = j.taluk_id
        LEFT JOIN local_bodies lb ON lb.id = j.local_body_id LEFT JOIN wards w ON w.id = j.ward_id LEFT JOIN departments dp ON dp.id = j.department_id
        LEFT JOIN users g ON g.id = j.granted_by LEFT JOIN users rv ON rv.id = j.revoked_by
        WHERE j.user_id = ${userId} ORDER BY j.revoked_at NULLS FIRST, j.is_primary DESC, j.created_at DESC`,
    sql`SELECT ur.*, r.code, r.name_en, r.name_ta, a.full_name AS assigned_by_name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        LEFT JOIN users a ON a.id = ur.assigned_by WHERE ur.user_id = ${userId} ORDER BY ur.assigned_at DESC`,
    sql`SELECT p.code, p.label, p.description, p.perm_group, p.is_security,
               EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = ${t.role_id} AND rp.permission_id = p.id) AS from_role,
               (SELECT up.effect FROM user_permissions up WHERE up.user_id = ${userId} AND up.permission_id = p.id AND up.revoked_at IS NULL) AS override
        FROM permissions p WHERE p.code NOT IN ('complaint.create','complaint.view.own','appeal.create') ORDER BY p.perm_group, p.code`,
    sql`SELECT up.effect, up.created_at, up.revoked_at, up.reason, p.code, g.full_name AS by_name FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
        LEFT JOIN users g ON g.id = up.granted_by WHERE up.user_id = ${userId} ORDER BY up.created_at DESC LIMIT 50`,
    sql`SELECT a.id, a.action, a.created_at, a.reason, a.old_value, a.new_value, a.ip_address, a.user_agent, x.full_name AS actor, a.actor_role
        FROM audit_logs a LEFT JOIN users x ON x.id = a.actor_id WHERE a.target_user_id = ${userId} AND a.action NOT LIKE 'auth.%' ORDER BY a.created_at DESC LIMIT 100`,
    t.supervisor_id ? sql`SELECT id, full_name, username FROM users WHERE id = ${t.supervisor_id}` : Promise.resolve([]),
    sql`SELECT (SELECT count(*) FROM assignments a WHERE a.assigned_to = ${userId})::int AS assignments,
               (SELECT count(*) FROM assignments a WHERE a.assigned_to = ${userId} AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS'))::int AS open_assignments,
               (SELECT count(*) FROM complaint_action_assignees x WHERE x.user_id = ${userId} AND x.removed_at IS NULL)::int AS actions,
               (SELECT count(*) FROM users s JOIN officials o ON o.user_id = s.id WHERE o.supervisor_id = ${userId})::int AS reports`,
  ]);
  const effective = new Set(perms.filter((p) => (p.from_role && p.override !== 'DENY') || p.override === 'GRANT').map((p) => p.code as string));
  return { user: t, jurisdictions: [...jur], roleHistory: [...roles], permissions: [...perms], overrides: [...overrides], audit: [...auditRows], supervisor: sup[0] ?? null, stats: stats[0], effective: [...effective] };
}
