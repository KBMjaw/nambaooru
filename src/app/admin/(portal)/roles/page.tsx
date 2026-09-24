import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { RoleMatrix } from '@/components/admin/RoleMatrix';

export default async function Roles() {
  await requirePageUser('ADMIN', 'role.manage');
  const { t } = await getT();
  const [roles, perms, grants] = await Promise.all([
    sql`SELECT code FROM roles ORDER BY rank DESC`,
    sql`SELECT code, description, is_security FROM permissions ORDER BY code`,
    sql`SELECT r.code || '|' || p.code AS k FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id`,
  ]);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">🔐 {t('nav.roles')}</h1>
      <p className="text-sm text-slate-500">Hierarchy: Super Admin → Executive Officer → Supervisor / Department Officer → Field Staff; Ward Member → ward-level. Permissions are enforced by the backend on every request. Super Admin permissions are fixed; security permissions cannot be delegated.</p>
      <RoleMatrix roles={roles as never} perms={perms as never} grants={grants.map((g) => g.k as string)} />
    </div>
  );
}
