import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { analytics } from '@/lib/analytics';
import { dashboardData } from '@/lib/dashboard';
import { AnalyticsView } from '@/components/AnalyticsView';
import { DashboardSections } from '@/components/DashboardSections';
import { Stat } from '@/components/ui';

export default async function AdminHome() {
  const u = await requirePageUser('ADMIN');
  const { t, lang } = await getT();
  const [d, [sys]] = await Promise.all([
    dashboardData(u),
    sql`SELECT (SELECT count(*) FROM local_bodies WHERE status = 'ACTIVE')::int AS local_bodies,
               (SELECT count(*) FROM districts WHERE status = 'ACTIVE')::int AS districts,
               (SELECT count(*) FROM wards WHERE status = 'ACTIVE')::int AS wards,
               (SELECT count(*) FROM roles WHERE status = 'ACTIVE')::int AS roles,
               (SELECT count(*) FROM audit_logs WHERE created_at > now() - interval '24 hours')::int AS audit24`,
  ]);
  const a = has(u, 'analytics.view') ? await analytics(u) : null;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold text-slate-800">📊 {t('portal.admin')}</h1>
      <DashboardSections d={d} base="/admin" canCitizens={has(u, 'citizen.view')} canUsers={has(u, 'user.view') || has(u, 'user.manage') || has(u, 'user.manage.all')} />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Stat label={t('reg.district')} value={sys.districts as number} href="/admin/locations?tab=districts" />
        <Stat label={t('admin.localBodies')} value={sys.local_bodies as number} href="/admin/local-bodies" />
        <Stat label={t('admin.wards')} value={sys.wards as number} href="/admin/ward-maps" />
        <Stat label={t('nav.roles')} value={sys.roles as number} href="/admin/roles" />
        <Stat label={`${t('nav.audit')} (24h)`} value={sys.audit24 as number} href="/admin/audit" />
      </div>
      {a && <AnalyticsView a={a} lang={lang} showLocalBodies linkBase="/admin/complaints" />}
    </div>
  );
}
