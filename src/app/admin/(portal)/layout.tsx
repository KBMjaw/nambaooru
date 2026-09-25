import { requirePageUser, has } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { PortalShell, type NavItem } from '@/components/PortalShell';
import type { AddItem } from '@/components/admin/AddMenu';
import type { MessageKey } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser('ADMIN');
  const { t, lang } = await getT();
  const any = (perm: string | string[]) => (Array.isArray(perm) ? perm : [perm]).some((p) => has(u, p));
  const nav: NavItem[] = [{ href: '/admin', label: t('nav.dashboard'), icon: '📊' }];
  const add = (perm: string | string[], href: string, key: MessageKey, icon: string) => { if (any(perm)) nav.push({ href, label: t(key), icon }); };
  add('complaint.view.all', '/admin/complaints', 'nav.complaints', '📋');
  add(['user.manage.all', 'user.manage', 'user.view'], '/admin/users', 'nav.users', '👥');
  add(['citizen.view', 'citizen.manage'], '/admin/citizens', 'admin.citizens', '🧑‍🤝‍🧑');
  add(['role.manage', 'role.custom.manage'], '/admin/roles', 'nav.roles', '🔐');
  add(['location.manage', 'ward.manage'], '/admin/local-bodies', 'admin.localBodies', '🏛️');
  add(['wardmap.view', 'wardmap.edit'], '/admin/ward-maps', 'admin.wardMaps', '🗺️');
  add('location.manage', '/admin/locations', 'nav.locations', '📍');
  add('location.manage', '/admin/postal', 'nav.postal', '📮');
  add(['department.manage', 'masterdata.manage'], '/admin/departments', 'nav.departments', '🏢');
  add('masterdata.manage', '/admin/categories', 'nav.categories', '🏷️');
  add('masterdata.manage', '/admin/sla', 'nav.sla', '⏱️');
  add('masterdata.manage', '/admin/routing', 'nav.routing', '🔀');
  add('masterdata.manage', '/admin/templates', 'nav.templates', '✉️');
  add(['settings.manage', 'masterdata.manage', 'language.manage'], '/admin/settings', 'nav.settings', '⚙️');
  add(['audit.view', 'audit.manage'], '/admin/audit', 'nav.audit', '🧾');
  nav.push({ href: '/admin/profile', label: t('nav.profile'), icon: '👤' });

  // Central "+ Add" menu — only what this user is allowed to create
  const addItems: AddItem[] = [];
  const item = (ok: boolean, href: string, key: MessageKey, icon: string) => { if (ok) addItems.push({ href, label: t(key), icon }); };
  item(has(u, 'citizen.manage'), '/admin/citizens?new=1', 'admin.addCitizen', '🧑');
  item(any(['user.manage', 'user.manage.all']), '/admin/users?new=1', 'admin.addUser', '👤');
  item(any(['role.custom.manage', 'role.manage']), '/admin/roles?new=1', 'admin.addRole', '🎭');
  item(any(['department.manage', 'masterdata.manage']), '/admin/departments?new=1', 'admin.addDepartment', '🏢');
  item(has(u, 'location.manage'), '/admin/locations?tab=districts&new=1', 'admin.addDistrict', '🗺️');
  item(has(u, 'location.manage'), '/admin/locations?tab=taluks&new=1', 'admin.addTaluk', '📍');
  item(has(u, 'location.manage'), '/admin/local-bodies/new', 'admin.addLocalBody', '🏛️');
  item(has(u, 'location.manage'), '/admin/locations?tab=wards&new=1', 'admin.addWard', '🏘️');
  item(has(u, 'location.manage'), '/admin/locations?tab=streets&new=1', 'admin.addStreet', '🛣️');
  return (
    <PortalShell portal="ADMIN" tone="slate" title={t('app.name')} subtitle={t('portal.admin')} userName={u.fullName}
      roleLabel={lang === 'ta' ? u.roleNameTa : u.roleNameEn} nav={nav} addItems={addItems}>
      {children}
    </PortalShell>
  );
}
