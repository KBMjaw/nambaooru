import type { ComplaintDetail } from '@/lib/complaint-detail';
import { makeT, type Lang, type MessageKey } from '@/i18n';
import { fmtDateTime } from '@/lib/format';
import { Section } from '@/components/ui';

const ACTIVE = ['PENDING', 'ACCEPTED', 'IN_PROGRESS'];

/** Classification & routing, the work team, and verification / resolution — the workflow at a glance. */
export function WorkflowSections({ d, lang }: { d: ComplaintDetail; lang: Lang }) {
  const t = makeT(lang);
  const { c } = d;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0"><dt className="text-slate-500">{k}</dt><dd className="text-right font-semibold text-slate-800">{v || '—'}</dd></div>
  );
  const work = d.assignments.filter((a) => a.purpose === 'WORK');
  const activeTeam = work.filter((a) => ACTIVE.includes(a.status as string));
  const roleOrder: Record<string, number> = { SUPERVISOR: 0, PRIMARY: 1, SUPPORT: 2 };
  const roleIcon: Record<string, string> = { SUPERVISOR: '🧑‍💼', PRIMARY: '👷', SUPPORT: '🤝' };
  const deptOverridden = c.suggested_department_id && c.department_id && c.suggested_department_id !== c.department_id;
  const finished = ['CLOSED', 'REJECTED', 'DUPLICATE'].includes(c.status as string);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title={`🏷️ ${t('wf.classification')}`}>
        <dl className="text-sm">
          <Row k={t('wf.category')} v={`${c.icon ?? ''} ${L(c.category_en, c.category_ta)}`} />
          <Row k={t('wf.issueType')} v={L(c.issue_en, c.issue_ta)} />
          <Row k={t('wf.suggestedDept')} v={L(c.sdept_en, c.sdept_ta)} />
          <Row k={t('wf.assignedDept')} v={<>{L(c.dept_en, c.dept_ta)}{deptOverridden ? <span className="ml-1 badge bg-amber-100 text-amber-800">{t('wf.changedByOfficer')}</span> : null}</>} />
          <Row k={t('wf.assignedBy')} v={(c.dept_assigned_by_name as string) ?? t('wf.system')} />
          <Row k={t('wf.assignedAt')} v={c.department_assigned_at ? fmtDateTime(c.department_assigned_at as string, lang) : ''} />
          <Row k={t('wf.escalation')} v={(c.escalation_level as number) > 0 ? `${c.escalation_level} — ${t(`esc.${c.escalation_level}` as MessageKey)}` : t('wf.notEscalated')} />
          <Row k={t('complaint.dueIn')} v={c.sla_due_at ? fmtDateTime(c.sla_due_at as string, lang) : ''} />
        </dl>
      </Section>

      <Section title={`👥 ${t('wf.team')} (${activeTeam.length})`}>
        {work.length === 0 ? <p className="text-sm text-slate-500">{t('wf.noTeam')}</p> : (
          <ul className="space-y-2 text-sm">
            {[...work].sort((a, b) => Number(!ACTIVE.includes(a.status as string)) - Number(!ACTIVE.includes(b.status as string)) || roleOrder[a.assignee_role as string] - roleOrder[b.assignee_role as string]).map((a) => (
              <li key={a.id as number} className={`rounded-lg p-2.5 ${ACTIVE.includes(a.status as string) ? 'bg-slate-50' : 'bg-white text-slate-400 line-through decoration-slate-300'}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{roleIcon[a.assignee_role as string]}</span><b className="no-underline">{a.assignee_name as string}</b>
                  <span className="badge bg-slate-200 text-slate-700">{t(`wf.role.${a.assignee_role}` as MessageKey)}</span>
                  <span className="text-xs">{L(a.assignee_role_en, a.assignee_role_ta)}</span>
                  <span className="ml-auto text-xs font-semibold">{t(`asg.${a.status}` as MessageKey)}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{t('field.assignedBy')}: {a.assigned_by_name as string} · {fmtDateTime(a.created_at as string, lang)}{a.due_at ? ` · ${t('office.dueDate')}: ${fmtDateTime(a.due_at as string, lang)}` : ''}</div>
                {a.note && <div className="text-xs text-slate-600">📝 {a.note as string}</div>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`🔎 ${t('wf.verification')}`}>
        {finished && (
          <div className={`mb-3 rounded-lg p-2.5 text-sm ${c.resolution_type === 'RESOLVED' ? 'bg-leaf-50 text-leaf-800' : 'bg-slate-100 text-slate-800'}`}>
            <p className="font-bold">{t('wf.resolution')}: {c.resolution_type ? t(`res.${c.resolution_type}` as MessageKey) : '—'}</p>
            {c.resolution_notes && <p>{c.resolution_notes as string}</p>}
            <p className="text-xs text-slate-500">{(c.resolved_by_name as string) ?? t('wf.system')}{c.resolved_at ? ` · ${fmtDateTime(c.resolved_at as string, lang)}` : ''}</p>
          </div>
        )}
        {d.completions.length === 0 ? <p className="text-sm text-slate-500">{t('wf.noCompletion')}</p> : (
          <ul className="space-y-2 text-sm">
            {d.completions.map((x) => (
              <li key={x.id as number} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <b>{x.proposed_resolution === 'NO_ISSUE_FOUND' ? `🚫 ${t('wf.noIssueReport')}` : `✅ ${t('wf.completionReport')}`}</b>
                  <span className={`badge ${x.verification_status === 'APPROVED' ? 'bg-leaf-100 text-leaf-800' : x.verification_status === 'SENT_BACK' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{t(`ver.${x.verification_status}` as MessageKey)}</span>
                </div>
                <p className="text-slate-700">{x.notes as string}</p>
                <p className="text-xs text-slate-500">{x.completed_by_name as string} · {fmtDateTime(x.completed_at as string, lang)} · 📍 {(x.latitude as number).toFixed(5)}, {(x.longitude as number).toFixed(5)}</p>
                {x.verified_at && (
                  <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-xs text-slate-600">
                    <b>{x.verification_method ? t(x.verification_method === 'FIELD' ? 'wf.methodField' : 'wf.methodEvidence') : t('wf.verified')}</b> · {x.verified_by_name as string} · {fmtDateTime(x.verified_at as string, lang)}
                    {x.verification_latitude != null && <> · 📍 {(x.verification_latitude as number).toFixed(5)}, {(x.verification_longitude as number).toFixed(5)}</>}
                    {x.verification_notes && <div className="text-slate-700">{x.verification_notes as string}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
