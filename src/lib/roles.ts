import 'server-only';
import { z } from 'zod';
import { sql } from './db';
import { has, isSystemScope, type AuthUser } from './auth';
import { audit } from './audit';
import { badRequest, conflict, forbidden, notFound } from './errors';

const CITIZEN_PERMS = ['complaint.create', 'complaint.view.own', 'appeal.create'];

/** Authority levels offered when creating an operational role (rank must stay below the creator's). */
export const ROLE_LEVELS = [
  { rank: 75, label: 'Local body head level' },
  { rank: 60, label: 'Officer / Supervisor level' },
  { rank: 50, label: 'Engineer / Inspector level' },
  { rank: 40, label: 'Ward level' },
  { rank: 30, label: 'Field worker level' },
] as const;

export const RoleInput = z.object({
  name_en: z.string().trim().min(2).max(60),
  name_ta: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(300).optional().nullable(),
  department_code: z.string().trim().max(40).optional().nullable().transform((v) => (v ? v : null)),
  default_scope: z.enum(['DISTRICT', 'LOCAL_BODY', 'DEPARTMENT', 'WARD', 'ASSIGNED']),
  rank: z.coerce.number().int().min(11).max(89),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  permissions: z.array(z.string().max(60)).max(80).default([]),
  reason: z.string().trim().max(500).optional().nullable(),
});

/** Partial update — no defaults, so fields that are not sent stay untouched. */
export const RoleUpdate = RoleInput.extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  permissions: z.array(z.string().max(60)).max(80).optional(),
}).partial();

type Role = { id: number; code: string; rank: number; is_system: boolean; portal: string; status: string };

/** May the actor edit this role's definition / permissions? */
export function canEditRole(actor: AuthUser, role: Role) {
  if (role.code === 'SUPER_ADMIN') return false; // fixed
  if (has(actor, 'role.manage')) return true;   // Super Admin: system and custom roles
  if (!has(actor, 'role.custom.manage')) return false;
  return !role.is_system && role.portal === 'OFFICE' && role.rank < actor.roleRank;
}

async function validatePermissions(actor: AuthUser, codes: string[], role: { code: string }) {
  if (!codes.length) return [] as { id: number; code: string }[];
  const rows = await sql`SELECT id, code, is_security FROM permissions WHERE code IN ${sql(codes)}`;
  if (rows.length !== new Set(codes).size) throw badRequest('Unknown permission in list');
  for (const p of rows) {
    if (p.is_security && !has(actor, 'role.manage')) throw forbidden(`${p.code}: security permissions are Super Admin only`);
    if (p.is_security && role.code !== 'SUPER_ADMIN') throw forbidden(`${p.code}: security permissions can only be held by Super Admin`);
    if (role.code === 'CITIZEN' ? !CITIZEN_PERMS.includes(p.code as string) : CITIZEN_PERMS.includes(p.code as string)) throw forbidden(`${p.code}: not allowed for this role`);
  }
  return rows.map((r) => ({ id: r.id as number, code: r.code as string }));
}

function roleCode(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'ROLE';
}

export async function createRole(actor: AuthUser, input: z.infer<typeof RoleInput>) {
  if (!has(actor, 'role.custom.manage') && !has(actor, 'role.manage')) throw forbidden();
  if (input.rank >= actor.roleRank) throw forbidden('A new role must rank below your own');
  if (input.default_scope === 'DISTRICT' && !isSystemScope(actor)) throw forbidden();
  if (input.department_code) {
    const [d] = await sql`SELECT 1 FROM departments WHERE code = ${input.department_code} LIMIT 1`;
    if (!d) throw badRequest('Unknown department code', { department_code: ['Unknown'] });
  }
  let code = roleCode(input.name_en);
  const [dup] = await sql`SELECT 1 FROM roles WHERE code = ${code} OR lower(name_en) = ${input.name_en.toLowerCase()}`;
  if (dup) throw conflict('A role with this name already exists', { name_en: ['Taken'] });
  const perms = await validatePermissions(actor, input.permissions, { code });
  const [r] = await sql.begin(async (tx) => {
    const [row] = await tx`
      INSERT INTO roles (code, name_en, name_ta, portal, rank, is_system, description, department_code, default_scope, status, created_by)
      VALUES (${code}, ${input.name_en}, ${input.name_ta || input.name_en}, 'OFFICE', ${input.rank}, false, ${input.description ?? null},
              ${input.department_code}, ${input.default_scope}, ${input.status}, ${actor.id}) RETURNING id, code`;
    for (const p of perms) await tx`INSERT INTO role_permissions (role_id, permission_id) VALUES (${row.id}, ${p.id}) ON CONFLICT DO NOTHING`;
    return [row];
  });
  code = r.code as string;
  await audit(actor, { action: 'ROLE_CREATED', entityType: 'role', entityId: code, reason: input.reason,
    newValue: { code, name: input.name_en, scope: input.default_scope, rank: input.rank, department: input.department_code, permissions: perms.map((p) => p.code), status: input.status } });
  return { ok: true, id: r.id, code };
}

export async function updateRole(actor: AuthUser, id: number, input: Partial<z.infer<typeof RoleInput>>) {
  const [role] = await sql`SELECT * FROM roles WHERE id = ${id}`;
  if (!role) throw notFound();
  if (!canEditRole(actor, role as unknown as Role)) throw forbidden('You cannot edit this role');
  if (input.rank !== undefined && role.is_system) throw badRequest('The rank of a built-in role cannot change');
  if (input.default_scope !== undefined && role.is_system) throw badRequest('The scope of a built-in role cannot change');
  if (input.rank !== undefined && input.rank >= actor.roleRank) throw forbidden('A role must rank below your own');
  if (input.status === 'INACTIVE' && role.status === 'ACTIVE') {
    if (role.is_system) throw badRequest('Built-in roles cannot be deactivated');
    const [n] = await sql`SELECT count(*)::int AS n FROM users WHERE role_id = ${id} AND status = 'ACTIVE'`;
    if ((n.n as number) > 0) throw conflict(`${n.n} active user(s) still hold this role — move them first`);
  }
  const set: Record<string, unknown> = {};
  for (const k of ['name_en', 'name_ta', 'description', 'department_code', 'default_scope', 'rank', 'status'] as const) {
    if (input[k] !== undefined && String(input[k] ?? '') !== String(role[k] ?? '')) set[k] = input[k];
  }
  const before = await sql`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ${id}`;
  const oldPerms = before.map((p) => p.code as string);
  let added: string[] = [];
  let removed: string[] = [];
  if (input.permissions) {
    const want = await validatePermissions(actor, input.permissions, role as unknown as Role);
    added = want.filter((p) => !oldPerms.includes(p.code)).map((p) => p.code);
    removed = oldPerms.filter((c) => !input.permissions!.includes(c));
    // Security permissions held by a role can only be removed by Super Admin
    if (removed.length && !has(actor, 'role.manage')) {
      const sec = await sql`SELECT code FROM permissions WHERE code IN ${sql(removed)} AND is_security`;
      if (sec.length) throw forbidden('Security permissions can only be changed by Super Admin');
    }
  }
  await sql.begin(async (tx) => {
    if (Object.keys(set).length) await tx`UPDATE roles SET ${tx({ ...set, updated_at: new Date() })} WHERE id = ${id}`;
    for (const c of added) await tx`INSERT INTO role_permissions (role_id, permission_id) SELECT ${id}, id FROM permissions WHERE code = ${c} ON CONFLICT DO NOTHING`;
    if (removed.length) await tx`DELETE FROM role_permissions WHERE role_id = ${id} AND permission_id IN (SELECT id FROM permissions WHERE code IN ${sql(removed)})`;
  });
  if (Object.keys(set).length) {
    await audit(actor, { action: 'ROLE_UPDATED', entityType: 'role', entityId: role.code as string, reason: input.reason ?? null,
      oldValue: Object.fromEntries(Object.keys(set).map((k) => [k, role[k]])), newValue: set });
  }
  if (added.length || removed.length) {
    await audit(actor, { action: 'PERMISSION_CHANGED', entityType: 'role', entityId: role.code as string, reason: input.reason ?? null,
      oldValue: { permissions: oldPerms }, newValue: { added, removed } });
  }
  return { ok: true };
}

/** Single-cell toggle used by the permission matrix. */
export async function togglePermission(actor: AuthUser, roleCodeIn: string, permission: string, granted: boolean) {
  const [role] = await sql`SELECT id FROM roles WHERE code = ${roleCodeIn}`;
  if (!role) throw badRequest('Unknown role');
  const cur = (await sql`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ${role.id}`).map((p) => p.code as string);
  const next = granted ? [...new Set([...cur, permission])] : cur.filter((c) => c !== permission);
  return updateRole(actor, role.id as number, { permissions: next });
}
