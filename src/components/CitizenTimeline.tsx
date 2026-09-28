import { makeT, type Lang, type MessageKey } from '@/i18n';
import { fmtDateTime } from '@/lib/format';
import type { ComplaintDetail } from '@/lib/complaint-detail';

type At = string | Date | null | undefined;

/**
 * Citizen tracking timeline built from the complaint's recorded events (not just its status):
 * Submitted → Acknowledged → Classified → Department assigned → Officer / staff assigned → Work started →
 * Progress updates → Work completed → Verification → Resolved / Closed. Public information only.
 */
export function CitizenTimeline({ d, lang }: { d: ComplaintDetail; lang: Lang }) {
  const t = makeT(lang);
  const { c } = d;
  const status = c.status as string;
  const first = (...s: string[]) => d.history.find((h) => s.includes(h.to_status as string))?.created_at as At;
  const workAssign = d.assignments.filter((a) => a.purpose === 'WORK' && ['PRIMARY', 'SUPERVISOR'].includes(a.assignee_role as string));
  const progress = d.updates.filter((u) => u.update_type === 'PROGRESS');
  const finished = ['CLOSED', 'REJECTED', 'DUPLICATE'].includes(status);
  const reworks = d.history.filter((h) => h.to_status === 'REWORK_REQUIRED' && h.from_status !== h.to_status);
  const steps: { key: string; label: string; at: At; note?: string }[] = [
    { key: 'submitted', label: t('ct.submitted'), at: c.submitted_at as At },
    { key: 'received', label: t('ct.received'), at: first('AI_CLASSIFIED') ?? first('INITIAL_REVIEW'), note: [c.category_en, c.sub_en, c.issue_en].filter(Boolean).join(' › ') },
    { key: 'reviewed', label: t('ct.reviewed'), at: first('INITIAL_REVIEW', 'SITE_INSPECTION', 'VERIFIED') },
    { key: 'dept', label: t('ct.department'), at: c.department_id ? (c.department_assigned_at as At) : null, note: (lang === 'ta' ? c.dept_ta ?? c.dept_en : c.dept_en) as string },
    { key: 'assigned', label: t('ct.assigned'), at: first('ASSIGNED') ?? (workAssign.at(-1)?.created_at as At) },
    { key: 'started', label: t('ct.started'), at: (c.work_started_at as At) ?? first('IN_PROGRESS') },
    { key: 'progress', label: t('ct.progress', { n: progress.length }), at: progress[0]?.created_at as At, note: progress[0]?.progress_pct != null ? `${progress[0].progress_pct}%` : undefined },
    { key: 'completed', label: t('ct.completed'), at: first('WORK_COMPLETED', 'VERIFICATION_PENDING') },
    { key: 'verifying', label: t('ct.underVerification'), at: first('VERIFICATION_PENDING'), note: reworks.length ? t('ct.reworkCount', { n: reworks.length }) : undefined },
    { key: 'approved', label: t('ct.approved'), at: first('COMPLETION_VERIFIED') },
    { key: 'closed', label: finished && status !== 'CLOSED' ? `${t(`status.${status}` as MessageKey)}${c.resolution_type ? ` — ${t(`res.${c.resolution_type}` as MessageKey)}` : ''}` : t('ct.closed'),
      at: finished ? ((c.resolved_at as At) ?? (c.closed_at as At) ?? first(status)) : null,
      note: status === 'REJECTED' || status === 'DUPLICATE' ? (c.rejection_notes as string) ?? undefined : status === 'CLOSED' ? (c.resolution_notes as string) ?? undefined : undefined },
  ];
  // Later events imply earlier ones (e.g. work can start without a separate "assigned" moment)
  const last = steps.reduce((m, s, i) => (s.at ? i : m), -1);
  const currentIdx = finished ? -1 : last + 1;
  const sideNote = status === 'ON_HOLD' ? t('status.ON_HOLD') : status === 'REWORK_REQUIRED' ? `↻ ${t('status.REWORK_REQUIRED')}` : null;
  const rejected = status === 'REJECTED' || status === 'DUPLICATE';
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        // A complaint that ended without work only shows the steps that really happened
        const done = !!s.at || (i < last && !rejected);
        const skipped = !s.at && i < last && !rejected;
        const current = i === currentIdx;
        const bad = rejected && s.key === 'closed';
        return (
          <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && <span className={`absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5 ${done ? 'bg-leaf-500' : 'bg-slate-200'}`} />}
            <span className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${bad ? 'bg-red-600 text-white' : done ? 'bg-leaf-600 text-white' : current ? 'bg-amber-400 text-white ring-4 ring-amber-100' : 'bg-slate-200 text-slate-400'}`}>
              {bad ? '✕' : done ? '✓' : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`font-semibold ${bad ? 'text-red-700' : done || current ? 'text-slate-800' : 'text-slate-400'}`}>{s.label}{current && <span className="ml-2 badge bg-amber-100 text-amber-800">{t('ct.now')}</span>}</p>
              {s.at && <p className="text-xs text-slate-500">{fmtDateTime(s.at, lang)}</p>}
              {skipped && s.key !== 'progress' && <p className="text-xs text-slate-400">—</p>}
              {s.note && (s.at || done) && <p className="text-xs text-slate-600">{s.note}</p>}
              {current && sideNote && <p className="text-xs font-bold text-amber-700">{sideNote}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
