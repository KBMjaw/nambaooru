'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { StatusBadge, PriorityBadge } from '@/components/badges';
import { fmtDate, timeAgo } from '@/lib/format';

export interface Row {
  code: string; status: string; priority: string; created_at: string | Date; sla_due_at: string | Date | null; escalated: boolean; location_conflict: boolean;
  safety_risk: boolean; icon: string | null; category_en: string; category_ta: string; ward_number: number | null; street: string | null; street_ta: string | null;
  assigned_name: string | null; supporters_count: number; title_en: string | null; title_ta: string | null;
  /** Server-computed: this user has workflow actions on this complaint (TAKE ACTION shown) */
  can_act?: boolean;
}

export function ComplaintsTable({ rows, compact = false, base = '/office/complaints' }: { rows: Row[]; compact?: boolean; base?: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  if (!rows.length) return <p className="py-8 text-center text-sm text-slate-500">{t('office.noResults')}</p>;
  const isOpen = (s: string) => !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(s);
  const flags = (r: Row) => (
    <>
      {r.escalated && <span title={t('complaint.escalated')}>⬆️</span>}
      {r.location_conflict && <span title={t('complaint.locationFlag')}>📍❗</span>}
      {r.safety_risk && <span title={t('complaint.safety')}>⚠️</span>}
      {r.supporters_count > 0 && <span className="text-xs text-slate-500">👥{r.supporters_count}</span>}
    </>
  );
  const due = (r: Row) => {
    if (!r.sla_due_at || !isOpen(r.status)) return <span className="text-slate-400">—</span>;
    const over = new Date(r.sla_due_at) < new Date();
    return <span className={over ? 'font-bold text-red-600' : 'text-slate-600'}>{over ? `⏰ ${t('complaint.overdue')}` : fmtDate(r.sla_due_at, lang)}</span>;
  };
  // TAKE ACTION opens the complaint page with its TAKE ACTION panel already open — the one action workflow
  const actions = (r: Row, mobile = false) => (
    <div className={`flex gap-2 ${mobile ? 'mt-2' : ''}`}>
      <Link href={`${base}/${r.code}`} className={`btn btn-outline ${mobile ? 'min-h-11 flex-1' : 'btn-sm'}`} aria-label={`${t('wf.openComplaint')} ${r.code}`}>👁️ {t('office.open')}</Link>
      {r.can_act && (
        <Link href={`${base}/${r.code}?action=1#take-action`} data-testid="list-take-action" className={`btn btn-primary font-extrabold ${mobile ? 'min-h-11 flex-1' : 'btn-sm'}`} aria-label={`${t('wf.takeAction')} ${r.code}`}>⚡ {t('wf.takeAction')}</Link>
      )}
    </div>
  );
  const place = (r: Row) => [lang === 'ta' ? r.street_ta ?? r.street : r.street, r.ward_number != null ? `W${r.ward_number}` : null].filter(Boolean).join(', ') || '—';
  return (
    <>
      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.code} className="rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
            <Link href={`${base}/${r.code}`} className="block">
              <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-xs font-bold text-navy-700">{r.code}</span><StatusBadge status={r.status} /><PriorityBadge priority={r.priority} />{flags(r)}</div>
              <div className="mt-1 text-sm font-semibold">{r.icon} {lang === 'ta' ? r.category_ta : r.category_en}</div>
              <div className="text-xs text-slate-500">📍 {place(r)} · <span suppressHydrationWarning>{timeAgo(r.created_at, lang)}</span> · {due(r)}</div>
            </Link>
            {!compact && actions(r, true)}
          </li>
        ))}
      </ul>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="table-std">
          <thead>
            <tr>
              <th>{t('complaint.id')}</th><th>{t('complaint.category')}</th><th>{t('complaint.location')}</th><th>{t('users.status')}</th>
              <th>{t('complaint.priority')}</th>{!compact && <th>{t('complaint.assignedOfficer')}</th>}<th>{t('complaint.submitted')}</th><th>{t('complaint.dueIn')}</th>{!compact && <th>{t('common.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              // The whole row opens the complaint (the number stays a real link for keyboard / new-tab use)
              <tr key={r.code} className="cursor-pointer hover:bg-navy-50/60" tabIndex={0} aria-label={`${t('wf.openComplaint')} ${r.code}`}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,input,select')) router.push(`${base}/${r.code}`); }}
                onKeyDown={(e) => { if (e.key === 'Enter') router.push(`${base}/${r.code}`); }}>
                <td className="whitespace-nowrap"><Link className="font-mono text-xs font-bold text-navy-700 hover:underline" href={`${base}/${r.code}`}>{r.code}</Link> <span className="ml-1">{flags(r)}</span></td>
                <td>{r.icon} {lang === 'ta' ? r.category_ta : r.category_en}</td>
                <td className="max-w-[14rem] truncate">{place(r)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td><PriorityBadge priority={r.priority} /></td>
                {!compact && <td className="text-slate-600">{r.assigned_name ?? '—'}</td>}
                <td className="whitespace-nowrap text-slate-500" suppressHydrationWarning>{timeAgo(r.created_at, lang)}</td>
                <td className="whitespace-nowrap">{due(r)}</td>
                {!compact && <td className="whitespace-nowrap">{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
