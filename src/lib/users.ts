import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from './db';
import { has, hashPassword, type AuthUser } from './auth';
import { audit } from './audit';
import { badRequest, conflict, forbidden, notFound } from './errors';

export const OPERATIONAL_ROLES = ['SUPERVISOR', 'DEPT_OFFICER', 'FIELD_STAFF', 'WARD_MEMBER'] as const;
export const ALL_STAFF_ROLES = ['SUPER_ADMIN', 'SYSTEM_ADMIN', 'EO', ...OPERATIONAL_ROLES] as const;

/** Which roles may this actor create / manage? (Server-side hierarchy guard.) */
export function manageableRoles(actor: AuthUser): string[] {
  if (has(actor, 'user.manage.all')) return [...ALL_STAFF_ROLES];
  if (has(actor, 'user.manage')) return [...OPERATIONAL_ROLES];
  return [];
}

/** SQL visibility of user accounts for the actor. Use with aliases usr / r / o. */
export function userVisibility(actor: AuthUser) {
  if (has(actor, 'user.manage.all')) return sql`r.code <> 'CITIZEN'`;
  if (!actor.localBodyId) return sql`FALSE`;
  // EO / supervisors: operational (non-admin) users of their own local body; never Super Admin / System Admin.
  return sql`r.code IN ${sql([...OPERATIONAL_ROLES, 'EO'])} AND o.local_body_id = ${actor.localBodyId}`;
}

const base = {
  fullName: z.string().trim().min(2).max(100),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  email: z.string().trim().email().max(120),
  designation: z.string().trim().max(100).optional().or(z.literal('')),
  employeeId: z.string().trim().max(40).optional().or(z.literal('')),
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  localBodyId: z.coerce.number().int().positive().nullable().optional(),
  wardId: z.coerce.number().int().positive().nullable().optional(),
  supervisorId: z.string().uuid().nullable().optional().or(z.literal('')),
  jurisdiction: z.string().trim().max(200).optional().or(z.literal('')),
};
export const CreateUser = z.object({
  ...base,
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3–40 letters, digits, dot, dash, underscore'),
  role: z.enum(ALL_STAFF_ROLES),
});
export const UpdateUser = z.object({
  ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
  role: z.enum(ALL_STAFF_ROLES).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  resetPassword: z.boolean().optional(),
}) as z.ZodType<Partial<z.infer<typeof CreateUser>> & { status?: 'ACTIVE' | 'INACTIVE'; resetPassword?: boolean }>;

function tempPassword() {
  return `${randomBytes(6).toString('base64').replace(/[+/=]/g, 'x')}#${Math.floor(10 + Math.random() * 89)}`;
}

/** Role-specific mandatory profile fields. */
async function validateProfile(role: string, p: { designation?: string | null; employeeId?: string | null; departmentId?: number | null; localBodyId?: number | null; wardId?: number | null; supervisorId?: string | null }) {
  const miss = (f: string) => { throw badRequest(`${f} is required for this role`, { [f]: ['Required'] }); };
  if (['EO', ...OPERATIONAL_ROLES].includes(role) && !p.localBodyId) miss('localBodyId');
  if (role === 'WARD_MEMBER' && !p.wardId) miss('wardId');
  if (['SUPERVISOR', 'DEPT_OFFICER'].includes(role)) { if (!p.designation) miss('designation'); if (!p.departmentId) miss('departmentId'); if (!p.employeeId) miss('employeeId'); }
  if (role === 'FIELD_STAFF') { if (!p.departmentId) miss('departmentId'); if (!p.supervisorId) miss('supervisorId'); if (!p.wardId) miss('wardId'); if (!p.employeeId) miss('employeeId'); }
  if (role === 'EO' && !p.designation) miss('designation');
  // Referential consistency within the local body
  if (p.departmentId) {
    const [d] = await sql`SELECT 1 FROM departments WHERE id = ${p.departmentId} AND local_body_id = ${p.localBodyId ?? 0}`;
    if (!d) throw badRequest('Department does not belong to the local body');
  }
  if (p.wardId) {
    const [w] = await sql`SELECT 1 FROM wards WHERE id = ${p.wardId} AND local_body_id = ${p.localBodyId ?? 0}`;
    if (!w) throw badRequest('Ward does not belong to the local body');
  }
  if (p.supervisorId) {
    const [s] = await sql`SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id JOIN officials o ON o.user_id = u.id
                          WHERE u.id = ${p.supervisorId} AND r.code IN ('SUPERVISOR','DEPT_OFFICER','EO') AND o.local_body_id = ${p.localBodyId ?? 0}`;
    if (!s) throw badRequest('Supervisor must be a supervisor/officer of the same local body');
  }
}

export async function createUser(actor: AuthUser, input: z.infer<typeof CreateUser>) {
  const allowed = manageableRoles(actor);
  if (!allowed.includes(input.role)) throw forbidden('You cannot create users with this role');
  // EO: jurisdiction is forced to their own local body
  const localBodyId = has(actor, 'user.manage.all') ? input.localBodyId ?? null : actor.localBodyId;
  const profile = { ...input, localBodyId, supervisorId: input.supervisorId || null, designation: input.designation || null, employeeId: input.employeeId || null };
  await validateProfile(input.role, profile);
  const dup = await sql`SELECT 1 FROM users WHERE lower(username) = ${input.username}`;
  if (dup.length) throw conflict('Username already exists');
  const pw = tempPassword();
  const user = await sql.begin(async (tx) => {
    const [u] = await tx`
      INSERT INTO users (username, password_hash, full_name, mobile, email, role_id, created_by)
      VALUES (${input.username}, ${await hashPassword(pw)}, ${input.fullName}, ${input.mobile}, ${input.email}, (SELECT id FROM roles WHERE code = ${input.role}), ${actor.id})
      RETURNING id`;
    await tx`
      INSERT INTO officials (user_id, designation, employee_id, department_id, local_body_id, ward_id, supervisor_id, jurisdiction)
      VALUES (${u.id}, ${profile.designation}, ${profile.employeeId}, ${input.departmentId ?? null}, ${localBodyId}, ${input.wardId ?? null},
              ${profile.supervisorId}, ${input.jurisdiction || null})`;
    return u;
  });
  const { ...safe } = { ...input };
  await audit(actor, { action: 'user.create', entityType: 'user', entityId: user.id as string, targetUserId: user.id as string, newValue: { ...safe, localBodyId } });
  return { id: user.id as string, tempPassword: pw };
}

export async function loadManagedUser(actor: AuthUser, id: string) {
  const [t] = await sql`
    SELECT usr.*, r.code AS role, r.rank, o.designation, o.employee_id, o.department_id, o.local_body_id, o.ward_id, o.supervisor_id, o.jurisdiction
    FROM users usr JOIN roles r ON r.id = usr.role_id LEFT JOIN officials o ON o.user_id = usr.id
    WHERE usr.id = ${id} AND (${userVisibility(actor)})`;
  if (!t) throw notFound('User not found');
  return t;
}

export async function updateUser(actor: AuthUser, id: string, input: Record<string, unknown>) {
  const target = await loadManagedUser(actor, id);
  const allowed = manageableRoles(actor);
  // Super Admin accounts can never be touched by EO or anyone without user.manage.all
  if (!allowed.includes(target.role as string)) throw forbidden('You cannot modify this account');
  if (input.role && !allowed.includes(input.role as string)) throw forbidden('You cannot assign this role');
  if (target.id === actor.id && (input.status === 'INACTIVE' || (input.role && input.role !== target.role))) {
    throw forbidden('You cannot deactivate or change the role of your own account');
  }
  if (target.role === 'SUPER_ADMIN' && (input.status === 'INACTIVE' || (input.role && input.role !== 'SUPER_ADMIN'))) {
    const [n] = await sql`SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'SUPER_ADMIN' AND u.status = 'ACTIVE'`;
    if ((n.n as number) <= 1) throw forbidden('The last active Super Admin cannot be deactivated or demoted');
  }

  const role = (input.role as string) ?? (target.role as string);
  const next = {
    fullName: (input.fullName as string) ?? target.full_name, mobile: (input.mobile as string) ?? target.mobile, email: (input.email as string) ?? target.email,
    designation: input.designation !== undefined ? (input.designation as string) || null : target.designation,
    employeeId: input.employeeId !== undefined ? (input.employeeId as string) || null : target.employee_id,
    departmentId: input.departmentId !== undefined ? (input.departmentId as number | null) : target.department_id,
    localBodyId: has(actor, 'user.manage.all') ? (input.localBodyId !== undefined ? (input.localBodyId as number | null) : target.local_body_id) : actor.localBodyId,
    wardId: input.wardId !== undefined ? (input.wardId as number | null) : target.ward_id,
    supervisorId: input.supervisorId !== undefined ? ((input.supervisorId as string) || null) : target.supervisor_id,
    jurisdiction: input.jurisdiction !== undefined ? (input.jurisdiction as string) || null : target.jurisdiction,
  };
  await validateProfile(role, next as never);

  const oldValue = {
    role: target.role, status: target.status, fullName: target.full_name, mobile: target.mobile, email: target.email, designation: target.designation,
    employeeId: target.employee_id, departmentId: target.department_id, localBodyId: target.local_body_id, wardId: target.ward_id, supervisorId: target.supervisor_id,
  };
  let tempPw: string | null = null;
  await sql.begin(async (tx) => {
    await tx`UPDATE users SET full_name = ${next.fullName as string}, mobile = ${next.mobile as string}, email = ${next.email as string},
               role_id = (SELECT id FROM roles WHERE code = ${role}), updated_at = now() WHERE id = ${id}`;
    await tx`
      INSERT INTO officials (user_id, designation, employee_id, department_id, local_body_id, ward_id, supervisor_id, jurisdiction)
      VALUES (${id}, ${next.designation as string | null}, ${next.employeeId as string | null}, ${next.departmentId as number | null}, ${next.localBodyId as number | null},
              ${next.wardId as number | null}, ${next.supervisorId as string | null}, ${next.jurisdiction as string | null})
      ON CONFLICT (user_id) DO UPDATE SET designation = EXCLUDED.designation, employee_id = EXCLUDED.employee_id, department_id = EXCLUDED.department_id,
        local_body_id = EXCLUDED.local_body_id, ward_id = EXCLUDED.ward_id, supervisor_id = EXCLUDED.supervisor_id, jurisdiction = EXCLUDED.jurisdiction`;
    if (input.status && input.status !== target.status) {
      // Deactivation keeps the record (history & audit keep the identity) and revokes sessions.
      await tx`UPDATE users SET status = ${input.status as string}, token_version = token_version + 1,
                 deactivated_at = ${input.status === 'INACTIVE' ? new Date() : null}, deactivated_by = ${input.status === 'INACTIVE' ? actor.id : null},
                 failed_logins = 0, locked_until = NULL WHERE id = ${id}`;
    }
    if (role !== target.role) await tx`UPDATE users SET token_version = token_version + 1 WHERE id = ${id}`;
    if (input.resetPassword) {
      tempPw = tempPassword();
      await tx`UPDATE users SET password_hash = ${await hashPassword(tempPw)}, token_version = token_version + 1, failed_logins = 0, locked_until = NULL WHERE id = ${id}`;
    }
  });
  const newValue = { ...next, role, status: (input.status as string) ?? target.status };
  const changed = Object.fromEntries(Object.entries(newValue).filter(([k, v]) => String((oldValue as Record<string, unknown>)[k] ?? '') !== String(v ?? '')));
  const action = input.status === 'INACTIVE' ? 'user.deactivate' : input.status === 'ACTIVE' && target.status !== 'ACTIVE' ? 'user.activate'
    : input.resetPassword ? 'user.password_reset' : role !== target.role ? 'user.role_change' : 'user.update';
  await audit(actor, {
    action, entityType: 'user', entityId: id, targetUserId: id,
    oldValue: Object.fromEntries(Object.keys(changed).map((k) => [k, (oldValue as Record<string, unknown>)[k]])),
    newValue: { ...changed, ...(input.resetPassword ? { password: '(reset)' } : {}) },
  });
  return { ok: true, tempPassword: tempPw };
}

export async function listUsers(actor: AuthUser, q: { q?: string; role?: string; status?: string }) {
  const search = q.q ? `%${q.q.slice(0, 60)}%` : null;
  return sql`
    SELECT usr.id, usr.username, usr.full_name, usr.mobile, usr.email, usr.status, usr.created_at, usr.last_login_at, r.code AS role,
           o.designation, o.employee_id, o.department_id, o.local_body_id, o.ward_id, o.supervisor_id, o.jurisdiction,
           d.name_en AS dept_en, d.name_ta AS dept_ta, lb.name_en AS lb_en, lb.name_ta AS lb_ta, w.ward_number, s.full_name AS supervisor_name
    FROM users usr JOIN roles r ON r.id = usr.role_id LEFT JOIN officials o ON o.user_id = usr.id
    LEFT JOIN departments d ON d.id = o.department_id LEFT JOIN local_bodies lb ON lb.id = o.local_body_id LEFT JOIN wards w ON w.id = o.ward_id
    LEFT JOIN users s ON s.id = o.supervisor_id
    WHERE (${userVisibility(actor)})
      ${search ? sql`AND (usr.full_name ILIKE ${search} OR usr.username ILIKE ${search} OR usr.mobile ILIKE ${search})` : sql``}
      ${q.role ? sql`AND r.code = ${q.role}` : sql``}
      ${q.status ? sql`AND usr.status = ${q.status}` : sql``}
    ORDER BY r.rank DESC, usr.full_name LIMIT 500`;
}
