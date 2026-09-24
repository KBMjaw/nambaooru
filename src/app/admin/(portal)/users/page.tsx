import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { listUsers, manageableRoles } from '@/lib/users';
import { UserManager } from '@/components/UserManager';

export const metadata = { title: 'Users' };

export default async function AdminUsers() {
  const u = await requirePageUser('ADMIN', ['user.manage.all', 'user.view']);
  const { t } = await getT();
  const [items, lbs] = await Promise.all([
    listUsers(u, {}),
    sql`SELECT lb.id, lb.name_en, lb.name_ta, d.name_en AS district_en FROM local_bodies lb JOIN districts d ON d.id = lb.district_id WHERE lb.status = 'ACTIVE' ORDER BY d.name_en, lb.name_en`,
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-slate-800">👥 {t('users.title')}</h1>
      <UserManager apiBase="/api/admin/users" items={JSON.parse(JSON.stringify(items))} manageable={manageableRoles(u)} meId={u.id} localBodies={JSON.parse(JSON.stringify(lbs))} />
    </div>
  );
}
