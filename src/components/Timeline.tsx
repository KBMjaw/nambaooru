import { makeT, type Lang, type MessageKey } from '@/i18n';
import { fmtDateTime } from '@/lib/format';

const STEPS = ['SUBMITTED', 'INITIAL_REVIEW', 'SITE_INSPECTION', 'ASSIGNED', 'IN_PROGRESS', 'WORK_COMPLETED', 'VERIFICATION_PENDING', 'COMPLETION_VERIFIED', 'CLOSED'] as const;
/** Temporary states shown on the step they belong to. */
const SIDE: Record<string, string> = { ON_HOLD: 'IN_PROGRESS', REWORK_REQUIRED: 'IN_PROGRESS' };

/** Citizen-facing progress timeline: ✓ Submitted → Review → Inspection → Assigned → Started → Completed → Verified → Closed */
export function Timeline({ history, status, lang, rejectionLabel }: { history: { to_status: string; created_at: string | Date }[]; status: string; lang: Lang; rejectionLabel?: string }) {
  const t = makeT(lang);
  const reached = new Map<string, string | Date>();
  for (const h of history) if (!reached.has(h.to_status)) reached.set(h.to_status, h.created_at);
  // Later steps imply earlier ones (e.g. verified without inspection)
  const order = STEPS as readonly string[];
  // After a reopen or rework, only the path since then counts
  let furthest = Math.max(...[...reached.keys()].map((s) => order.indexOf(s)), 0);
  if (status === 'REOPENED') furthest = 0;
  if (SIDE[status]) furthest = Math.min(furthest, order.indexOf(SIDE[status]) - 1);
  const terminal = status === 'REJECTED' || status === 'DUPLICATE';
  return (
    <ol className="relative space-y-0">
      {STEPS.map((s, i) => {
        const at = i <= furthest ? reached.get(s) : undefined;
        const done = !!at || i < furthest || (i === furthest && reached.has(s));
        const current = !terminal && !done && i === furthest + 1;
        const side = current && SIDE[status] ? t(`status.${status}` as MessageKey) : null;
        return (
          <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
            {i < STEPS.length - 1 && <span className={`absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5 ${done ? 'bg-leaf-500' : 'bg-slate-200'}`} />}
            <span className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-leaf-600 text-white' : current ? 'bg-amber-400 text-white ring-4 ring-amber-100' : 'bg-slate-200 text-slate-400'}`}>
              {done ? '✓' : i + 1}
            </span>
            <div className="pt-0.5">
              <p className={`font-semibold ${done ? 'text-slate-800' : 'text-slate-400'}`}>{t(`timeline.${s}` as MessageKey)}</p>
              {at && <p className="text-xs text-slate-500">{fmtDateTime(at, lang)}</p>}
              {side && <p className="text-xs font-bold text-amber-700">{side}</p>}
            </div>
          </li>
        );
      })}
      {terminal && (
        <li className="relative mt-2 flex gap-3">
          <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">✕</span>
          <div className="pt-0.5">
            <p className="font-semibold text-red-700">{t(`status.${status}` as MessageKey)}</p>
            {rejectionLabel && <p className="text-xs text-red-600">{rejectionLabel}</p>}
            {reached.get(status) && <p className="text-xs text-slate-500">{fmtDateTime(reached.get(status)!, lang)}</p>}
          </div>
        </li>
      )}
    </ol>
  );
}
