import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { PortalShell, type NavItem } from '@/components/PortalShell';
import type { MessageKey } from '@/i18n';

export const dynamic = 'force-dynamic';

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser('OFFICE');
  const { t, lang } = await getT();
  const [n] = await sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${u.id} AND read_at IS NULL AND channel = 'IN_APP'`;
  const [lb] = u.localBodyId ? await sql`SELECT name_en, name_ta FROM local_bodies WHERE id = ${u.localBodyId}` : [];
  const nav: NavItem[] = [{ href: '/office', label: u.role === 'FIELD_STAFF' ? t('nav.myWork') : t('nav.dashboard'), icon: u.role === 'FIELD_STAFF' ? '🧰' : '📊' }];
  if (u.role !== 'FIELD_STAFF') nav.push({ href: '/office/complaints', label: t('nav.complaints'), icon: '📋' });
  if (has(u, 'map.view')) nav.push({ href: '/office/map', label: t('nav.map'), icon: '🗺️' });
  if (has(u, 'analytics.view')) nav.push({ href: '/office/analytics', label: t('nav.analytics'), icon: '📈' });
  if (has(u, 'appeal.review')) nav.push({ href: '/office/appeals', label: t('nav.appeals'), icon: '🔁' });
  if (has(u, 'user.view')) nav.push({ href: '/office/users', label: t('nav.users'), icon: '👥' });
  nav.push({ href: '/office/notifications', label: t('nav.notifications'), icon: '🔔', badge: n.n as number });
  nav.push({ href: '/office/profile', label: t('nav.profile'), icon: '👤' });
  const lbName = lb ? (lang === 'ta' ? lb.name_ta ?? lb.name_en : lb.name_en) : '';
  return (
    <PortalShell portal="OFFICE" title={t('app.name')} subtitle={`${t('portal.office')}${lbName ? ` · ${lbName}` : ''}`} userName={u.fullName} roleLabel={t(`role.${u.role}` as MessageKey)} nav={nav}>
      {children}
    </PortalShell>
  );
}
