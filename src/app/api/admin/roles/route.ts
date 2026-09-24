import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { forbidden, badRequest } from '@/lib/errors';

const CITIZEN_PERMS = ['complaint.create', 'complaint.view.own', 'appeal.create'];

/** Configure role permissions. Super Admin row is locked; security permissions stay with Super Admin only. */
export const POST = route(async (req) => {
  const u = await requireApiUser('ADMIN', 'role.manage');
  const d = await body(req, z.object({ role: z.string(), permission: z.string(), granted: z.boolean() }));
  const [role] = await sql`SELECT id, code FROM roles WHERE code = ${d.role}`;
  const [perm] = await sql`SELECT id, code, is_security FROM permissions WHERE code = ${d.permission}`;
  if (!role || !perm) throw badRequest('Unknown role or permission');
  if (role.code === 'SUPER_ADMIN') throw forbidden('Super Admin permissions are fixed');
  if (d.granted && perm.is_security) throw forbidden('Security permissions can only be held by Super Admin');
  if (role.code === 'CITIZEN' && d.granted && !CITIZEN_PERMS.includes(perm.code as string)) throw forbidden('Citizens cannot receive official permissions');
  if (role.code !== 'CITIZEN' && d.granted && CITIZEN_PERMS.includes(perm.code as string)) throw forbidden('Citizen-only permission');
  if (d.granted) await sql`INSERT INTO role_permissions (role_id, permission_id) VALUES (${role.id}, ${perm.id}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM role_permissions WHERE role_id = ${role.id} AND permission_id = ${perm.id}`;
  await audit(u, { action: d.granted ? 'role.permission_grant' : 'role.permission_revoke', entityType: 'role', entityId: role.code as string, newValue: { permission: perm.code } });
  return { ok: true };
});
