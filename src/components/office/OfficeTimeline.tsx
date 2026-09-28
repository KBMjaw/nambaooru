import type { ComplaintDetail } from '@/lib/complaint-detail';
import { makeT, type Lang, type MessageKey } from '@/i18n';
import { fmtDateTime } from '@/lib/format';

type Ev = { at: Date; icon: string; title: string; actor: string; note?: string | null; visibility: 'PUBLIC' | 'INTERNAL'; photos?: { id: number; video: boolean }[] };

const ICON: Record<string, string> = {
  SUBMITTED: '📝', AI_CLASSIFIED: '🤖', INITIAL_REVIEW: '🧐', SITE_INSPECTION: '🔍', VERIFIED: '✔️', ASSIGNED: '👷', IN_PROGRESS: '🛠️', ON_HOLD: '⏸️',
  WORK_COMPLETED: '✅', VERIFICATION_PENDING: '🔎', REWORK_REQUIRED: '↩️', COMPLETION_VERIFIED: '🏁', CLOSED: '🔒', REJECTED: '⛔', DUPLICATE: '🔁', REOPENED: '🔓',
};
const CITIZEN_KINDS = ['CITIZEN', 'COMPLETION', 'PROGRESS', 'BEFORE_WORK', 'APPEAL'];

/**
 * Officer view of everything that happened, oldest first: every status change and note from the status history
 * (with actor, role and whether the citizen can see it) and every evidence upload with its photos.
 */
export function OfficeTimeline({ d, lang }: { d: ComplaintDetail; lang: Lang }) {
  const t = makeT(lang);
  const st = (s: unknown) => (s ? t(`status.${s}` as MessageKey) : '—');
  const events: Ev[] = d.history.map((h) => {
    const change = h.from_status !== h.to_status;
    return {
      at: new Date(h.created_at as string), icon: change ? ICON[h.to_status as string] ?? '•' : '💬',
      title: change ? `${st(h.from_status)} → ${st(h.to_status)}` : t('wf.noteEvent'),
      actor: (h.actor_label as string) ?? t('wf.system'), note: h.note as string | null,
      visibility: h.public_note ? 'PUBLIC' : 'INTERNAL',
    };
  });
  // Group evidence uploaded together (same kind, same person, same minute) into one event
  const groups = new Map<string, Ev>();
  for (const e of d.evidence) {
    const at = new Date(e.created_at as string);
    const key = `${e.kind}|${e.uploaded_by_name}|${Math.floor(at.getTime() / 60000)}`;
    const g = groups.get(key);
    const ph = { id: e.id as number, video: e.media_type === 'VIDEO' };
    if (g) { g.photos!.push(ph); continue; }
    groups.set(key, { at, icon: '📷', title: t(`evk.${e.kind}` as MessageKey), actor: e.uploaded_by_name as string, visibility: CITIZEN_KINDS.includes(e.kind as string) ? 'PUBLIC' : 'INTERNAL', photos: [ph] });
  }
  const all = [...events, ...groups.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  return (
    <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4">
      {all.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[1.6rem] top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm ring-2 ring-slate-200" aria-hidden>{e.icon}</span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-slate-800">{e.title}</span>
            <span className={`badge ${e.visibility === 'PUBLIC' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-700'}`}>{t(e.visibility === 'PUBLIC' ? 'wf.visPublic' : 'wf.visInternal')}</span>
          </div>
          <div className="text-xs text-slate-500">{fmtDateTime(e.at, lang)} · {e.actor}</div>
          {e.note && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{e.note}</p>}
          {e.photos && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {e.photos.map((p) => (
                <a key={p.id} href={`/api/evidence/${p.id}`} target="_blank" rel="noopener noreferrer">
                  {p.video ? <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-2xl ring-1 ring-slate-200">🎬</span>
                    : <img src={`/api/evidence/${p.id}`} alt="" loading="lazy" className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" />}
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
