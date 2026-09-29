import type { ReactNode } from 'react';
import type { ActionLogRow, ComplaintDetail } from '@/lib/complaint-detail';
import { makeT, type Lang, type MessageKey } from '@/i18n';
import { fmtDateTime } from '@/lib/format';
import { BeforeAfter, EvidenceGrid } from '@/components/Evidence';

const RECORD = ['ACKNOWLEDGE', 'ACCEPT', 'INSPECT', 'ACTION_TAKEN', 'WORK_STARTED', 'WORK_COMPLETED', 'ON_HOLD', 'REWORK_REQUIRED', 'OTHER'];
const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** Every recorded official action: action code, type, description, actor, time, status change and linked evidence. */
export function ActionHistory({ rows, lang }: { rows: ActionLogRow[]; lang: Lang }) {
  const t = makeT(lang);
  if (!rows.length) return <p className="text-sm text-slate-500">{t('ra.noHistory')}</p>;
  const st = (s: string) => t(`status.${s}` as MessageKey);
  return (
    <ol data-testid="action-history" className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs font-bold text-navy-700">{r.code}</span>
            <span className="font-bold text-slate-800">{RECORD.includes(r.action_type) ? t(`ra.t.${r.action_type}` as MessageKey) : humanize(r.action_type)}</span>
            <span className={`badge ${r.visibility === 'PUBLIC' ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-200 text-slate-700'}`}>{t(r.visibility === 'PUBLIC' ? 'wf.visPublic' : 'wf.visInternal')}</span>
          </div>
          <div className="text-xs text-slate-500">
            {fmtDateTime(r.created_at, lang)} · {r.actor_name}{r.actor_role_en ? ` (${lang === 'ta' ? r.actor_role_ta ?? r.actor_role_en : r.actor_role_en})` : ''}
            {' · '}{t('ra.statusChange')}: {r.from_status === r.to_status ? st(r.to_status) : `${st(r.from_status)} → ${st(r.to_status)}`}
          </div>
          {r.description && <p className="mt-1 whitespace-pre-line text-slate-700">{r.description}</p>}
          {r.evidence.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.evidence.map((e) => (
                <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" rel="noopener noreferrer" title={t(`evk.${e.kind}` as MessageKey)}>
                  {e.video ? <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-2xl ring-1 ring-slate-200">🎬</span>
                    : <img src={`/api/evidence/${e.id}`} alt={t(`evk.${e.kind}` as MessageKey)} loading="lazy" className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" />}
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Review of completed work, in the order a reviewer needs it: the citizen's complaint, the BEFORE evidence,
 * the action history, the staff's work description, the AFTER / action evidence, the completion details,
 * then APPROVE & CLOSE / REJECT / REWORK.
 */
export function ReviewPanel({ d, lang, buttons }: { d: ComplaintDetail; lang: Lang; buttons: ReactNode[] }) {
  const t = makeT(lang);
  const { c } = d;
  const pending = d.completions.find((x) => x.verification_status === 'PENDING');
  if (!pending) return null;
  const citizen = d.evidence.filter((e) => e.kind === 'CITIZEN');
  const after = d.evidence.filter((e) => ['AFTER', 'COMPLETION', 'ACTION_REFERENCE'].includes(e.kind as string));
  const earlier = d.completions.filter((x) => x.verification_status === 'SENT_BACK');
  const H = ({ children }: { children: ReactNode }) => <p className="mb-1.5 mt-4 text-sm font-extrabold uppercase tracking-wide text-slate-600">{children}</p>;
  return (
    <section data-testid="review-panel" className="card border-2 border-amber-400 p-4">
      <h2 className="text-lg font-extrabold text-amber-900">🔎 {t('rv.title')}</h2>
      <H>{t('rv.citizen')}</H>
      <blockquote className="rounded-lg bg-slate-50 p-3 text-slate-800">“{c.original_text as string}”</blockquote>
      <H>{t('rv.before')}</H>
      {citizen.length ? <EvidenceGrid evidence={citizen as never} lang={lang} /> : <p className="text-sm text-slate-500">{t('wf.noCitizenPhoto')}</p>}
      <H>{t('rv.actions')}</H>
      <ActionHistory rows={d.actionLog} lang={lang} />
      <H>{t('rv.work')}</H>
      <p className="whitespace-pre-line rounded-lg bg-leaf-50 p-3 font-semibold text-leaf-900">{pending.notes as string}</p>
      <H>{t('rv.after')}</H>
      {after.length ? <BeforeAfter evidence={d.evidence as never} lang={lang} /> : <p className="text-sm text-red-700">{t('rv.noAfter')}</p>}
      <H>{t('rv.details')}</H>
      <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-slate-500">{t('rv.completedBy')}: </dt><dd className="inline font-semibold">{pending.completed_by_name as string}</dd></div>
        <div><dt className="inline text-slate-500">🗓️ </dt><dd className="inline font-semibold">{fmtDateTime(pending.completed_at as string, lang)}</dd></div>
        {pending.latitude != null && <div><dt className="inline text-slate-500">📍 </dt><dd className="inline">{(pending.latitude as number).toFixed(5)}, {(pending.longitude as number).toFixed(5)}</dd></div>}
      </dl>
      {earlier.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-slate-600">{t('rv.previous')} ({earlier.length})</summary>
          <ul className="mt-1 space-y-1">{earlier.map((x) => (
            <li key={x.id as number} className="rounded-lg bg-rose-50 p-2">{x.notes as string}<br /><span className="text-xs text-rose-800">↩️ {x.verification_notes as string} · {x.verified_by_name as string} · {fmtDateTime(x.verified_at as string, lang)}</span></li>
          ))}</ul>
        </details>
      )}
      {buttons.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{buttons}</div>}
    </section>
  );
}
