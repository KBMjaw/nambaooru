import { requirePageUser, has } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { PortalShell, type NavItem } from '@/components/PortalShell';
import type { MessageKey } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser('ADMIN');
  const { t } = await getT();
  const nav: NavItem[] = [{ href: '/admin', label: t('nav.dashboard'), icon: '📊' }];
  const add = (perm: string | string[], href: string, key: MessageKey, icon: string) => { if ((Array.isArray(perm) ? perm : [perm]).some((p) => has(u, p))) nav.push({ href, label: t(key), icon }); };
  add('complaint.view.all', '/admin/complaints', 'nav.complaints', '📋');
  add(['user.manage.all', 'user.view'], '/admin/users', 'nav.users', '👥');
  add('role.manage', '/admin/roles', 'nav.roles', '🔐');
  add('location.manage', '/admin/locations', 'nav.locations', '🗺️');
  add('location.manage', '/admin/postal', 'nav.postal', '📮');
  add('masterdata.manage', '/admin/departments', 'nav.departments', '🏛️');
  add('masterdata.manage', '/admin/categories', 'nav.categories', '🏷️');
  add('masterdata.manage', '/admin/sla', 'nav.sla', '⏱️');
  add('masterdata.manage', '/admin/routing', 'nav.routing', '🔀');
  add('masterdata.manage', '/admin/templates', 'nav.templates', '✉️');
  add(['settings.manage', 'masterdata.manage', 'language.manage'], '/admin/settings', 'nav.settings', '⚙️');
  add('audit.view', '/admin/audit', 'nav.audit', '🧾');
  nav.push({ href: '/admin/profile', label: t('nav.profile'), icon: '👤' });
  return (
    <PortalShell portal="ADMIN" tone="slate" title={t('app.name')} subtitle={t('portal.admin')} userName={u.fullName} roleLabel={t(`role.${u.role}` as MessageKey)} nav={nav}>
      {children}
    </PortalShell>
  );
}
