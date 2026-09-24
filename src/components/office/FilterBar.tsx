import { makeT, type Lang, type MessageKey } from '@/i18n';
import type { Filters } from '@/lib/office-queries';
import { STATUSES } from '@/lib/workflow-constants';

export function FilterBar({ f, opts, lang, action }: {
  f: Filters; lang: Lang; action: string;
  opts: { wards: Record<string, unknown>[]; categories: Record<string, unknown>[]; staff: Record<string, unknown>[]; depts: Record<string, unknown>[] };
}) {
  const t = makeT(lang);
  return (
    <form action={action} className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-8">
      {f.bucket && <input type="hidden" name="bucket" value={f.bucket} />}
      <input name="q" defaultValue={f.q} placeholder={t('office.search')} className="input col-span-2" />
      <select name="ward" defaultValue={f.ward ?? ''} className="input" aria-label={t('complaint.ward')}>
        <option value="">{t('office.allWards')}</option>
        {opts.wards.map((w) => <option key={w.id as number} value={w.id as number}>{t('complaint.ward')} {w.ward_number as number}</option>)}
      </select>
      <select name="category" defaultValue={f.category ?? ''} className="input" aria-label={t('complaint.category')}>
        <option value="">{t('office.allCategories')}</option>
        {opts.categories.map((c) => <option key={c.code as string} value={c.code as string}>{c.icon as string} {(lang === 'ta' ? c.name_ta : c.name_en) as string}</option>)}
      </select>
      <select name="status" defaultValue={f.status ?? ''} className="input" aria-label={t('users.status')}>
        <option value="">{t('office.allStatuses')}</option>
        {STATUSES.filter((s) => s !== 'DRAFT').map((s) => <option key={s} value={s}>{t(`status.${s}` as MessageKey)}</option>)}
      </select>
      <select name="priority" defaultValue={f.priority ?? ''} className="input" aria-label={t('complaint.priority')}>
        <option value="">{t('office.allPriorities')}</option>
        {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => <option key={p} value={p}>{t(`priority.${p}` as MessageKey)}</option>)}
      </select>
      <select name="staff" defaultValue={f.staff ?? ''} className="input" aria-label={t('complaint.assignedOfficer')}>
        <option value="">{t('office.allStaff')}</option>
        {opts.staff.map((s) => <option key={s.id as string} value={s.id as string}>{s.full_name as string}</option>)}
      </select>
      <select name="dept" defaultValue={f.dept ?? ''} className="input" aria-label={t('complaint.department')}>
        <option value="">{t('complaint.department')}: {t('common.all')}</option>
        {opts.depts.map((d) => <option key={d.id as number} value={d.id as number}>{(lang === 'ta' ? d.name_ta : d.name_en) as string}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs text-slate-500">{t('office.from')}<input type="date" name="from" defaultValue={f.from} className="input py-2" /></label>
      <label className="flex items-center gap-1 text-xs text-slate-500">{t('office.to')}<input type="date" name="to" defaultValue={f.to} className="input py-2" /></label>
      <div className="col-span-2 flex gap-2">
        <button className="btn btn-navy flex-1">{t('office.apply')}</button>
        <a href={action} className="btn btn-outline">{t('office.reset')}</a>
      </div>
    </form>
  );
}
