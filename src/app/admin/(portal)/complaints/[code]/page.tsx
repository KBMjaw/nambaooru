import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { getComplaintDetail, complaintWorkData } from '@/lib/complaint-detail';
import { auditLabel } from '@/lib/audit-labels';
import { fmtDateTime } from '@/lib/format';
import { StatusBadge, PriorityBadge } from '@/components/badges';
import { Section } from '@/components/ui';
import { BeforeAfter } from '@/components/Evidence';
import { Timeline } from '@/components/Timeline';
import { TakeAction } from '@/components/office/TakeAction';
import { complaintActions } from '@/components/office/complaintActions';
import { WorkflowSections } from '@/components/office/WorkflowSections';
import { ActionsPanel, type ActionRow } from '@/components/office/ActionsPanel';

/**
 * Admin view of a complaint. Admins / Super Admin can assign, reassign, build the work team, manage actions,
 * add remarks and reopen — all audited. Field decisions (inspection, rejection, verification, closure) remain
 * with the local body's officials.
 */
export default async function AdminComplaint({ params }: { params: Promise<{ code: string }> }) {
  const u = await requirePageUser('ADMIN', 'complaint.view.all');
  const { t, lang } = await getT();
  const code = decodeURIComponent((await params).code);
  const d = await getComplaintDetail({ code });
  if (!d) notFound();
  const { c } = d;
  const status = c.status as string;
  const open = !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(status);
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const work = await complaintWorkData(u, c);
  const audits = await sql`SELECT a.action, a.created_at, a.actor_role, a.reason, x.full_name FROM audit_logs a LEFT JOIN users x ON x.id = a.actor_id
                           WHERE a.entity_type = 'complaint' AND a.entity_id = ${code} ORDER BY a.created_at DESC LIMIT 100`;
  const { nodes: actions, nextStep } = await complaintActions(u, d, work, t, lang, 'ADMIN');

  return (
    <div className="space-y-4">
      <Link href="/admin/complaints" className="text-sm font-semibold text-navy-600">← {t('nav.complaints')}</Link>
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-lg font-extrabold">{code}</span><StatusBadge status={status} /><PriorityBadge priority={c.priority as string} /></div>
        <p className="mt-2 font-bold">{c.icon as string} {L(c.title_en, c.title_ta)}</p>
        <p className="text-slate-700">{L(c.summary_en, c.summary_ta)}</p>
        <p className="mt-1 text-sm text-slate-500">{L(c.lb_en, c.lb_ta)} · {c.ward_id ? <Link className="underline" href={`/admin/ward-maps/${c.ward_id}`}>{t('complaint.ward')} {c.ward_number as number}</Link> : '—'} · {L(c.dept_en, c.dept_ta)} · {fmtDateTime(c.submitted_at as string, lang)}</p>
        {(c.escalation_level as number) > 0 && <p className="mt-1 text-sm font-semibold text-amber-800">⬆️ {t('wf.escLevel', { n: c.escalation_level as number })}{c.escalation_note ? ` — ${c.escalation_note}` : ''}</p>}
        <p className="mt-1 text-sm">👤 <Link className="font-semibold text-navy-700 underline" href={`/admin/citizens/${c.citizen_id}`}>{c.citizen_name as string}</Link>{c.assigned_name ? <> · 👷 {c.assigned_name as string}</> : null}</p>
      </div>
      <TakeAction nextStep={nextStep} count={actions.length}>{actions}</TakeAction>
      <p className="-mt-2 text-[11px] text-slate-400">{t('admin.adminComplaintNote')}</p>
      <WorkflowSections d={d} lang={lang} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={t('complaint.evidence')}><BeforeAfter evidence={d.evidence as never} lang={lang} /></Section>
          <Section title={`🛠️ ${t('actions.title')} (${work.actions.length})`}>
            <ActionsPanel code={code} portal="ADMIN" actions={work.actions as ActionRow[]} staff={work.staff} departments={work.departments} perms={{ ...work.perms, work: false }} meId={u.id} open={open} />
          </Section>
          <Section title={t('office.history')}>
            <ol className="space-y-1 text-xs">{d.history.map((h) => <li key={h.id as number}>{fmtDateTime(h.created_at as string, lang)} · {(h.actor_label as string) ?? 'System'} · {h.from_status as string} → {h.to_status as string} {h.note ? `· ${h.note}` : ''}</li>)}</ol>
          </Section>
        </div>
        <div className="space-y-4">
          <Section title={t('complaint.timeline')}><Timeline history={d.history.map((h) => ({ to_status: h.to_status as string, created_at: h.created_at as string }))} status={status} lang={lang} /></Section>
          <Section title={`🧾 ${t('nav.audit')}`}>
            <ul className="space-y-1 text-xs">{audits.map((a, i) => { const l = auditLabel(a.action as string); return <li key={i}>{l.icon} {l.label} · {(a.full_name as string) ?? (a.actor_role as string)} · {fmtDateTime(a.created_at as string, lang)}{a.reason ? ` · “${a.reason}”` : ''}</li>; })}</ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
