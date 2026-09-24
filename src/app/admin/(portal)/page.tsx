import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { analytics } from '@/lib/analytics';
import { AnalyticsView } from '@/components/AnalyticsView';
import { Stat } from '@/components/ui';

export default async function AdminHome() {
  const u = await requirePageUser('ADMIN');
  const { t, lang } = await getT();
  const [sys] = await sql`
    SELECT (SELECT count(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code <> 'CITIZEN' AND u.status = 'ACTIVE')::int AS staff,
           (SELECT count(*) FROM citizens)::int AS citizens,
           (SELECT count(*) FROM local_bodies WHERE status = 'ACTIVE')::int AS local_bodies,
           (SELECT count(*) FROM districts WHERE status = 'ACTIVE')::int AS districts,
           (SELECT count(*) FROM wards WHERE status = 'ACTIVE')::int AS wards,
           (SELECT count(*) FROM postal_locations WHERE status = 'ACTIVE')::int AS postal,
           (SELECT count(*) FROM audit_logs WHERE created_at > now() - interval '24 hours')::int AS audit24`;
  const a = has(u, 'analytics.view') ? await analytics(u) : null;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold text-slate-800">📊 {t('portal.admin')}</h1>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label={`${t('nav.users')} (staff)`} value={sys.staff as number} href="/admin/users" />
        <Stat label={t('role.CITIZEN')} value={sys.citizens as number} />
        <Stat label={t('reg.district')} value={sys.districts as number} href="/admin/locations?tab=districts" />
        <Stat label={t('users.localBody')} value={sys.local_bodies as number} href="/admin/locations?tab=local_bodies" />
        <Stat label={t('reg.ward')} value={sys.wards as number} href="/admin/locations?tab=wards" />
        <Stat label={t('nav.postal')} value={sys.postal as number} href="/admin/postal" />
        <Stat label={`${t('nav.audit')} (24h)`} value={sys.audit24 as number} href="/admin/audit" />
      </div>
      {a && <AnalyticsView a={a} lang={lang} showLocalBodies linkBase="/admin/complaints" />}
    </div>
  );
}
