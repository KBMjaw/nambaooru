import Link from 'next/link';
import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { bucketCounts, listComplaints } from '@/lib/office-queries';
import { analytics } from '@/lib/analytics';
import { mapComplaints } from '@/lib/map-data';
import { Stat, Section, Alert } from '@/components/ui';
import { BarList } from '@/components/charts';
import { ComplaintsMap } from '@/components/office/ComplaintsMap';
import { ComplaintsTable } from '@/components/office/ComplaintsTable';
import { FieldHome } from './FieldHome';
import { dashboardData } from '@/lib/dashboard';
import { DashboardSections } from '@/components/DashboardSections';

export default async function OfficeHome() {
  const u = await requirePageUser('OFFICE');
  const { t, lang } = await getT();
  if (u.scope === 'ASSIGNED') return <FieldHome />;

  const counts = await bucketCounts(u);
  const [dept] = u.departmentId ? await sql`SELECT name_en, name_ta FROM departments WHERE id = ${u.departmentId}` : [];
  const [ward] = u.wardId ? await sql`SELECT ward_number FROM wards WHERE id = ${u.wardId}` : [];
  const title = u.scope === 'LOCAL_BODY' ? t('office.eoTitle')
    : u.scope === 'WARD' ? t('office.wardTitle', { n: (ward?.ward_number as number) ?? '' })
    : dept ? t('office.deptTitle', { dept: String(lang === 'ta' ? dept.name_ta : dept.name_en) }) : t('office.dashboardTitle');
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');

  const attention = await listComplaints(u, { bucket: undefined }, 10);
  const open = attention.rows.filter((r) => !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(r.status as string));
  const a = has(u, 'analytics.view') ? await analytics(u) : null;
  const markers = has(u, 'map.view') ? await mapComplaints(u, {}, true) : [];
  const [appeals] = has(u, 'appeal.review') ? await sql`SELECT count(*)::int AS n FROM appeals ap JOIN complaints c ON c.id = ap.complaint_id WHERE ap.status = 'PENDING' AND c.local_body_id = ${u.localBodyId}` : [{ n: 0 }];

  const cards: [string, number, string, string][] = [
    [t('office.new'), counts.new, 'navy', 'new'],
    [t('office.pendingReview'), counts.review, 'violet', 'review'],
    [t('office.inspectionPending'), counts.inspection, 'violet', 'inspection'],
    [t('office.readyToAssign'), counts.verified, 'navy', 'verified'],
    [t('office.assigned'), counts.assigned, 'navy', 'assigned'],
    [t('office.inProgress'), counts.progress, 'sun', 'progress'],
    [t('office.awaitingVerification'), counts.verification, 'sun', 'verification'],
    [t('office.completed'), counts.completed, 'leaf', 'completed'],
    [t('office.rejected'), counts.rejected + counts.duplicate, 'slate', 'rejected'],
    [t('office.overdue'), counts.overdue, 'pin', 'overdue'],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-800">{title}</h1>
          <p className="text-sm text-slate-500">{t('office.total')}: <b>{counts.total}</b> · {t('office.pending')}: <b>{counts.pending}</b></p>
        </div>
        <Link href="/office/complaints" className="btn btn-navy btn-sm">📋 {t('nav.complaints')}</Link>
      </div>

      {(counts.escalated > 0 || (appeals.n as number) > 0 || counts.conflict > 0) && (
        <div className="grid gap-2 sm:grid-cols-3">
          {counts.escalated > 0 && <Link href="/office/complaints?escalated=1"><Alert tone="warn">⬆️ {t('office.escalatedList')}: <b>{counts.escalated}</b></Alert></Link>}
          {(appeals.n as number) > 0 && <Link href="/office/appeals"><Alert tone="info">🔁 {t('office.appealsPending')}: <b>{appeals.n as number}</b></Alert></Link>}
          {counts.conflict > 0 && <Link href="/office/complaints?conflict=1"><Alert tone="warn">📍 {t('office.locationConflict')}: <b>{counts.conflict}</b></Alert></Link>}
        </div>
      )}

      {u.scope === 'LOCAL_BODY' && (
        <DashboardSections d={await dashboardData(u)} base="/office" showLocalBodies={false}
          canCitizens={has(u, 'citizen.view')} canUsers={has(u, 'user.view') || has(u, 'user.manage')} />
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map(([label, value, tone, bucket]) => <Stat key={bucket} label={label} value={value} tone={tone} href={`/office/complaints?bucket=${bucket}`} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Section title={`⚡ ${t('office.pending')}`} className="lg:col-span-3" action={<Link className="text-sm font-semibold text-navy-600" href="/office/complaints">{t('common.showMore')} →</Link>}>
          <ComplaintsTable rows={open as never} compact />
        </Section>
        {has(u, 'map.view') && (
          <Section title={`🗺️ ${t('office.wardMap')}`} className="lg:col-span-2">
            <ComplaintsMap items={markers} height={320} />
          </Section>
        )}
      </div>

      {a && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Section title={t('office.byWard')}>
            <BarList items={a.byWard.map((w) => ({ label: `${t('complaint.ward')} ${w.ward_number}`, value: w.n as number, href: `/office/complaints?ward=${w.id}` }))} />
          </Section>
          <Section title={t('office.byCategory')}>
            <BarList items={a.byCategory.map((c) => ({ label: `${c.icon} ${L(c.name_en, c.name_ta)}`, value: c.n as number, href: `/office/complaints?category=${c.code}` }))} />
          </Section>
        </div>
      )}
    </div>
  );
}
