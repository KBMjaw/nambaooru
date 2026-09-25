import Link from 'next/link';
import { getT } from '@/i18n/server';
import type { dashboardData } from '@/lib/dashboard';
import { fmtDate } from '@/lib/format';
import { Section, Stat } from './ui';
import { BarList } from './charts';

type D = Awaited<ReturnType<typeof dashboardData>>;

/** Clickable counters, ward / department / local-body breakdowns and recent people for the Admin and EO dashboards. */
export async function DashboardSections({ d, base, showPeople = true, showLocalBodies = true, canCitizens = true, canUsers = true }: {
  d: D; base: '/admin' | '/office'; showPeople?: boolean; showLocalBodies?: boolean; canCitizens?: boolean; canUsers?: boolean;
}) {
  const { t, lang } = await getT();
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const c = d.counts as Record<string, number>;
  const p = d.people as Record<string, number>;
  return (
    <div className="space-y-4">
      {showPeople && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label={t('admin.totalCitizens')} value={p.citizens} tone="navy" href={canCitizens ? `${base}/citizens` : undefined} />
          <Stat label={t('admin.totalOfficers')} value={p.officers} href={canUsers ? `${base}/users` : undefined} />
          <Stat label={t('admin.activeUsers')} value={p.active} tone="leaf" href={canUsers ? `${base}/users?status=ACTIVE` : undefined} />
          <Stat label={t('admin.inactiveUsers')} value={p.inactive} tone="slate" href={canUsers ? `${base}/users?status=INACTIVE` : undefined} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t('nav.complaints')} value={c.total} href={`${base}/complaints`} />
        <Stat label={t('office.pending')} value={c.pending} tone="sun" href={`${base}/complaints?bucket=open`} />
        <Stat label={t('office.inProgress')} value={c.in_progress} tone="navy" href={`${base}/complaints?bucket=active`} />
        <Stat label={t('office.completed')} value={c.completed} tone="leaf" href={`${base}/complaints?bucket=completed`} />
        <Stat label={t('office.overdue')} value={c.overdue} tone="pin" href={`${base}/complaints?bucket=overdue`} />
        <Stat label={t('admin.highPriority')} value={c.high} tone="pin" href={`${base}/complaints?bucket=high`} />
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={t('office.inspectionPending')} value={c.inspection} tone="violet" href={`${base}/complaints?bucket=inspection`} />
        <Stat label={t('office.awaitingVerification')} value={c.awaiting_verification} tone="sun" href={`${base}/complaints?bucket=verification`} />
        <Stat label={t('admin.assignedWork')} value={d.work.assigned_work as number} tone="navy" href={`${base}/complaints?bucket=active`} />
        <Stat label={t('admin.openActions')} value={`${d.work.open_actions as number}${(d.work.unassigned_actions as number) ? ` (${d.work.unassigned_actions} ⚠)` : ''}`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={`🏘️ ${t('admin.wardWise')}`}>
          <BarList items={d.byWard.map((w) => ({ label: `${t('complaint.ward')} ${w.ward_number}${showLocalBodies ? ` · ${L(w.lb_en, w.lb_ta)}` : ''} (${w.open} ${t('office.pending').toLowerCase()})`, value: w.n as number, href: `${base}/ward-maps/${w.id}` }))} />
        </Section>
        <Section title={`🏢 ${t('admin.departmentWise')}`}>
          <div className="overflow-x-auto"><table className="table-std text-sm">
            <thead><tr><th>{t('users.department')}</th><th>{t('nav.complaints')}</th><th>{t('office.pending')}</th><th>{t('office.completed')}</th><th>{t('office.overdue')}</th><th>{t('admin.avgHours')}</th></tr></thead>
            <tbody>{d.byDept.map((x) => (
              <tr key={x.id as number}><td><Link className="font-semibold text-navy-700 hover:underline" href={`${base}/complaints?dept=${x.id}`}>{L(x.name_en, x.name_ta)}</Link>{showLocalBodies && <div className="text-xs text-slate-400">{x.lb_en as string}</div>}</td>
                <td>{x.n as number}</td><td>{x.open as number}</td><td className="text-leaf-700">{x.done as number}</td><td className={(x.overdue as number) ? 'font-bold text-red-600' : ''}>{x.overdue as number}</td><td>{(x.avg_hours as number) ?? '—'}</td></tr>
            ))}</tbody>
          </table></div>
        </Section>
      </div>
      {showLocalBodies && d.byLb.length > 0 && (
        <Section title={`🏛️ ${t('admin.localBodyWise')}`}>
          <BarList items={d.byLb.map((x) => ({ label: `${L(x.name_en, x.name_ta)} (${x.open} ${t('office.pending').toLowerCase()}, ${x.overdue} ${t('office.overdue').toLowerCase()})`, value: x.n as number, href: base === '/admin' ? `/admin/local-bodies/${x.id}` : `${base}/complaints?lb=${x.id}` }))} />
        </Section>
      )}
      {showPeople && (
        <div className="grid gap-4 md:grid-cols-2">
          {canCitizens && (
            <Section title={`🧑 ${t('admin.recentCitizens')}`} action={<Link className="text-sm font-semibold text-navy-600" href={`${base}/citizens`}>{t('common.showMore')} →</Link>}>
              <ul className="divide-y divide-slate-100 text-sm">{d.recentCitizens.map((x) => (
                <li key={x.id as string}><Link className="flex justify-between gap-2 py-1.5 hover:text-navy-700" href={`${base}/citizens/${x.id}`}><span className="font-semibold">{x.full_name as string}</span><span className="text-xs text-slate-500">{[x.lb_en, x.ward_number != null ? `W${x.ward_number}` : null].filter(Boolean).join(' · ')} · {fmtDate(x.created_at as string, lang)}</span></Link></li>
              ))}</ul>
            </Section>
          )}
          {canUsers && (
            <Section title={`👥 ${t('admin.recentUsers')}`} action={<Link className="text-sm font-semibold text-navy-600" href={`${base}/users`}>{t('common.showMore')} →</Link>}>
              <ul className="divide-y divide-slate-100 text-sm">{d.recentUsers.map((x) => (
                <li key={x.id as string}><Link className="flex justify-between gap-2 py-1.5 hover:text-navy-700" href={`${base}/users/${x.id}`}><span className="font-semibold">{x.full_name as string}</span><span className="text-xs text-slate-500">{x.role_en as string}{x.lb_en ? ` · ${x.lb_en}` : ''}</span></Link></li>
              ))}</ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
