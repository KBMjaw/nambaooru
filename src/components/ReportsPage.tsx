import type { AuthUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n';
import type { Filters } from '@/lib/office-queries';
import { reportSummary, reportFilterOptions } from '@/lib/reports';
import { ACTION_BUCKETS } from './ActionBuckets';
import { Section, Stat } from './ui';

const STATUSES = ['AI_CLASSIFIED', 'INITIAL_REVIEW', 'SITE_INSPECTION', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'WORK_COMPLETED', 'VERIFICATION_PENDING', 'REWORK_REQUIRED', 'COMPLETION_VERIFIED', 'CLOSED', 'REJECTED', 'DUPLICATE', 'REOPENED'];
const KEYS = ['bucket', 'status', 'priority', 'category', 'dept', 'lb', 'ward', 'district', 'taluk', 'staff', 'from', 'to'] as const;

/** Report builder: jurisdiction-scoped filters, on-screen summary and CSV / PDF export (office and admin portals). */
export async function ReportsPage({ u, f, portal }: { u: AuthUser; f: Filters; portal: 'OFFICE' | 'ADMIN' }) {
  const { t } = await getT();
  const [summary, o] = await Promise.all([reportSummary(u, f), reportFilterOptions(u, f)]);
  const q = new URLSearchParams({ portal });
  for (const k of KEYS) if (f[k]) q.set(k, String(f[k]));
  const tt = summary.totals;
  const sel = (name: keyof Filters, label: string, opts: { v: string; l: string }[]) => (
    <label className="block"><span className="label">{label}</span>
      <select name={name} defaultValue={f[name] ?? ''} className="input">
        <option value="">{t('common.all')}</option>
        {opts.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
      </select>
    </label>
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-navy-800">📑 {t('rep.title')}</h1>
      <form className="card grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block"><span className="label">{t('rep.from')}</span><input type="date" name="from" defaultValue={f.from} className="input" /></label>
        <label className="block"><span className="label">{t('rep.to')}</span><input type="date" name="to" defaultValue={f.to} className="input" /></label>
        {sel('bucket', t('rep.report'), ACTION_BUCKETS.filter(([b]) => b !== 'mine').map(([b, l]) => ({ v: b, l: t(l) })))}
        {sel('status', t('complaint.status'), STATUSES.map((s) => ({ v: s, l: t(`status.${s}` as MessageKey) })))}
        {sel('district', t('rep.district'), o.districts.map((x) => ({ v: String(x.id), l: x.name_en as string })))}
        {sel('taluk', t('rep.taluk'), o.taluks.map((x) => ({ v: String(x.id), l: x.name_en as string })))}
        {sel('lb', t('users.localBody'), o.localBodies.map((x) => ({ v: String(x.id), l: x.name_en as string })))}
        {sel('ward', t('complaint.ward'), o.wards.map((x) => ({ v: String(x.id), l: `${t('complaint.ward')} ${x.ward_number}` })))}
        {sel('dept', t('users.department'), o.depts.map((x) => ({ v: String(x.id), l: x.name_en as string })))}
        {sel('category', t('wf.category'), o.categories.map((x) => ({ v: x.code as string, l: x.name_en as string })))}
        {sel('priority', t('office.priority'), ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => ({ v: p, l: t(`priority.${p}` as MessageKey) })))}
        {sel('staff', t('rep.staff'), o.staff.map((x) => ({ v: x.id as string, l: `${x.full_name} (${x.role})` })))}
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          <button className="btn btn-navy">{t('office.apply')}</button>
          <a className="btn btn-primary" href={`/api/reports/complaints?${q}&format=csv`}>⬇️ CSV</a>
          <a className="btn btn-outline" href={`/api/reports/complaints?${q}&format=pdf`}>⬇️ PDF</a>
        </div>
      </form>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label={t('office.total')} value={tt.total} />
        <Stat label={t('office.pending')} value={tt.pending} tone="sun" />
        <Stat label={t('wf.bucket.verification')} value={tt.verification} tone="violet" />
        <Stat label={t('wf.bucket.closed')} value={tt.closed} tone="leaf" />
        <Stat label={t('rep.inSla')} value={tt.closed_in_sla} tone="leaf" />
        <Stat label={t('wf.bucket.overdue')} value={tt.overdue} tone="pin" />
        <Stat label={t('admin.avgHours')} value={tt.avg_hours ?? '—'} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={`🏢 ${t('rep.deptPerf')}`}>
          <div className="overflow-x-auto"><table className="table-std text-sm">
            <thead><tr><th>{t('users.department')}</th><th>{t('office.total')}</th><th>{t('office.pending')}</th><th>{t('wf.bucket.closed')}</th><th>{t('wf.bucket.overdue')}</th><th>{t('admin.avgHours')}</th></tr></thead>
            <tbody>{summary.byDept.map((d) => <tr key={d.name as string}><td>{d.name as string}</td><td>{d.n as number}</td><td>{d.pending as number}</td><td>{d.closed as number}</td><td className={(d.overdue as number) ? 'font-bold text-red-600' : ''}>{d.overdue as number}</td><td>{(d.avg_hours as number) ?? '—'}</td></tr>)}</tbody>
          </table></div>
        </Section>
        <Section title={`🏘️ ${t('admin.wardWise')}`}>
          <div className="overflow-x-auto"><table className="table-std text-sm">
            <thead><tr><th>{t('complaint.ward')}</th><th>{t('office.total')}</th><th>{t('office.pending')}</th><th>{t('wf.bucket.closed')}</th><th>{t('wf.bucket.overdue')}</th></tr></thead>
            <tbody>{summary.byWard.map((d) => <tr key={d.name as string}><td>{d.name as string}</td><td>{d.n as number}</td><td>{d.pending as number}</td><td>{d.closed as number}</td><td className={(d.overdue as number) ? 'font-bold text-red-600' : ''}>{d.overdue as number}</td></tr>)}</tbody>
          </table></div>
        </Section>
      </div>
      <p className="text-xs text-slate-500">{t('rep.note')}</p>
    </div>
  );
}
