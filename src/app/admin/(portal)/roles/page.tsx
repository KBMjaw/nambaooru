import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { canEditRole } from '@/lib/roles';
import { RoleMatrix } from '@/components/admin/RoleMatrix';
import { RoleManager, type RoleRowUI, type PermUI } from '@/components/admin/RoleManager';
import { Tabs } from '@/components/admin/Tabs';

export const metadata = { title: 'Roles & permissions' };

export default async function Roles({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requirePageUser('ADMIN', ['role.manage', 'role.custom.manage']);
  const { t } = await getT();
  const tab = (await searchParams).tab === 'matrix' && has(u, 'role.manage') ? 'matrix' : 'roles';
  const [roles, perms, grants, depts] = await Promise.all([
    sql`SELECT r.id, r.code, r.name_en, r.name_ta, r.description, r.department_code, r.default_scope, r.rank, r.status, r.is_system, r.portal,
               (SELECT count(*) FROM users x WHERE x.role_id = r.id AND x.status = 'ACTIVE')::int AS active_users,
               COALESCE((SELECT array_agg(p.code) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id), '{}') AS permissions
        FROM roles r ORDER BY r.rank DESC, r.name_en`,
    sql`SELECT code, label, description, perm_group, is_security FROM permissions ORDER BY perm_group, code`,
    sql`SELECT r.code || '|' || p.code AS k FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id`,
    sql`SELECT DISTINCT ON (code) code, name_en FROM departments WHERE status = 'ACTIVE' ORDER BY code, name_en`,
  ]);
  const rows = roles.map((r) => ({ ...r, editable: r.code !== 'CITIZEN' && canEditRole(u, r as never) })) as unknown as RoleRowUI[];
  const tabs: [string, string][] = [['roles', t('admin.rolesTab')]];
  if (has(u, 'role.manage')) tabs.push(['matrix', t('admin.matrixTab')]);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">🔐 {t('nav.roles')}</h1>
      <p className="text-sm text-slate-500">{t('admin.rolesIntro')}</p>
      <Tabs tabs={tabs} active={tab} base="/admin/roles" />
      {tab === 'roles' ? (
        <RoleManager roles={JSON.parse(JSON.stringify(rows))} perms={perms as unknown as PermUI[]} departments={depts as never} myRank={u.roleRank} isSuper={has(u, 'role.manage')} />
      ) : (
        <RoleMatrix roles={roles.map((r) => ({ code: r.code as string, name: r.name_en as string }))} perms={perms as never} grants={grants.map((g) => g.k as string)} />
      )}
    </div>
  );
}
