import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { RoleInput, createRole, togglePermission, canEditRole } from '@/lib/roles';

const PERMS = ['role.manage', 'role.custom.manage'];

export const GET = route(async () => {
  const u = await requireApiUser('ADMIN', PERMS);
  const roles = await sql`SELECT r.*, (SELECT count(*) FROM users x WHERE x.role_id = r.id AND x.status = 'ACTIVE')::int AS active_users,
                                 COALESCE((SELECT array_agg(p.code) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id), '{}') AS permissions
                          FROM roles r ORDER BY r.rank DESC, r.name_en`;
  return { roles: roles.map((r) => ({ ...r, editable: canEditRole(u, r as never) })) };
});

/** Create a custom operational role. */
export const POST = route(async (req) => {
  const u = await requireApiUser('ADMIN', PERMS);
  return createRole(u, await body(req, RoleInput));
});

/** Toggle one permission of one role (permission matrix). */
export const PUT = route(async (req) => {
  const u = await requireApiUser('ADMIN', PERMS);
  const d = await body(req, z.object({ role: z.string(), permission: z.string(), granted: z.boolean() }));
  return togglePermission(u, d.role, d.permission, d.granted);
});
