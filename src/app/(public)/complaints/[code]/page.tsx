import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { getComplaintDetail } from '@/lib/complaint-detail';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { StatusBadge, PriorityBadge } from '@/components/badges';
import { Timeline } from '@/components/Timeline';
import { BeforeAfter } from '@/components/Evidence';
import { Section } from '@/components/ui';
import type { MessageKey } from '@/i18n';
import { AppealForm } from './AppealForm';

export default async function CitizenComplaint({ params }: { params: Promise<{ code: string }> }) {
  const user = await requirePageUser('PUBLIC', 'complaint.view.own');
  const { code } = await params;
  const { t, lang } = await getT();
  const d = await getComplaintDetail({ code: decodeURIComponent(code) });
  if (!d) notFound();
  const { c } = d;
  const owner = c.citizen_id === user.id;
  if (!owner) {
    const s = await sql`SELECT 1 FROM complaint_supporters WHERE complaint_id = ${c.id} AND user_id = ${user.id}`;
    if (!s.length) notFound(); // never reveal other citizens' complaints
  }
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const location = [L(c.street_en ?? c.street_text, c.street_ta ?? c.street_text), c.ward_number != null ? `${t('complaint.ward')} ${c.ward_number}` : null, L(c.lb_en, c.lb_ta)].filter(Boolean).join(', ');
  const lastInspection = d.inspections[0];
  const rejected = c.status === 'REJECTED' || c.status === 'DUPLICATE';
  const reasonKey = c.rejection_reason ? (`reason.${c.rejection_reason}` as MessageKey) : null;
  const pendingAppeal = d.appeals.find((a) => a.status === 'PENDING');
  const canAppeal = owner && ['REJECTED', 'DUPLICATE', 'CLOSED'].includes(c.status as string) && !pendingAppeal;
  const overdue = c.sla_due_at && new Date(c.sla_due_at as string) < new Date() && !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(c.status as string);
  const publicHistory = d.history.filter((h) => h.public_note && h.note);
  const evidence = d.evidence.filter((e) => owner || ['CITIZEN', 'COMPLETION'].includes(e.kind as string));

  const rows: [string, React.ReactNode][] = [
    [t('complaint.id'), <span key="id" className="font-mono font-bold">{c.code as string}</span>],
    [t('complaint.category'), `${c.icon ?? ''} ${L(c.category_en, c.category_ta)}`],
    [t('complaint.location'), `📍 ${location || '—'}`],
    [t('complaint.submitted'), fmtDateTime(c.submitted_at as string, lang)],
    [t('complaint.status'), <StatusBadge key="st" status={c.status as string} />],
    [t('complaint.department'), L(c.dept_en, c.dept_ta) || '—'],
    [t('complaint.assignedOfficer'), c.assigned_name ? `${c.assigned_name} (${L(c.assigned_role_en, c.assigned_role_ta)})` : '—'],
    [t('complaint.inspection'), lastInspection ? `${t(`outcome.${lastInspection.outcome}` as MessageKey)} · ${fmtDate(lastInspection.inspected_at as string, lang)}` : c.status === 'SITE_INSPECTION' ? t('complaint.pending') : '—'],
    [t('complaint.progress'), d.progress != null ? (
      <span key="p" className="flex items-center gap-2"><span className="h-2 w-24 overflow-hidden rounded-full bg-slate-200"><span className="block h-full bg-leaf-500" style={{ width: `${d.progress}%` }} /></span>{d.progress}%</span>
    ) : '—'],
    [t('complaint.expected'), <span key="exp" className={overdue ? 'font-bold text-red-600' : ''}>{fmtDate(c.sla_due_at as string, lang)}{overdue ? ` · ${t('complaint.overdue')}` : ''}</span>],
    [t('complaint.closedOn'), c.closed_at ? fmtDateTime(c.closed_at as string, lang) : '—'],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/complaints" className="text-sm font-semibold text-navy-600">← {t('nav.myComplaints')}</Link>
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-3xl" aria-hidden>{c.icon as string}</span>
          <h1 className="text-xl font-extrabold text-navy-800">{L(c.title_en, c.title_ta)}</h1>
          <StatusBadge status={c.status as string} />
          <PriorityBadge priority={c.priority as string} />
        </div>
        <p className="mt-2 text-slate-700">{L(c.summary_en, c.summary_ta)}</p>
        {(c.supporters_count as number) > 0 && <p className="mt-2 text-sm font-semibold text-navy-700">👥 {t('complaint.supporters', { n: c.supporters_count as number })}</p>}
      </div>

      {rejected && (
        <div className="card border-red-200 bg-red-50 p-4">
          <p className="font-bold text-red-800">{t(`status.${c.status}` as MessageKey)} — {t('complaint.rejectedReason')}: {reasonKey ? t(reasonKey) : '—'}</p>
          {c.rejection_notes && <p className="mt-1 text-sm text-red-900">{t('complaint.notes')}: {c.rejection_notes as string}</p>}
          {c.duplicate_of_code && <p className="mt-1 text-sm">{t('complaint.duplicateOf', { code: c.duplicate_of_code as string })}</p>}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-5">
        <Section className="md:col-span-3">
          <dl className="divide-y divide-slate-100 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{k}</dt><dd className="text-right font-semibold text-slate-800">{v}</dd></div>
            ))}
          </dl>
        </Section>
        <Section title={t('complaint.timeline')} className="md:col-span-2">
          <Timeline history={d.history.map((h) => ({ to_status: h.to_status as string, created_at: h.created_at as string }))} status={c.status as string} lang={lang} rejectionLabel={reasonKey ? t(reasonKey) : undefined} />
        </Section>
      </div>

      <Section title={t('complaint.evidence')}>
        <BeforeAfter evidence={evidence as never} lang={lang} />
      </Section>

      {publicHistory.length > 0 && (
        <Section title={t('complaint.notes')}>
          <ul className="space-y-2 text-sm">
            {publicHistory.map((h) => (
              <li key={h.id as number} className="rounded-lg bg-slate-50 p-2.5">
                <span className="text-xs text-slate-500">{fmtDateTime(h.created_at as string, lang)} · {t(`status.${h.to_status}` as MessageKey)}</span>
                <p>{h.note as string}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {owner && (
        <Section title={t('complaint.original')}>
          <p className="italic text-slate-700">“{c.original_text as string}”</p>
          <p className="mt-1 text-xs text-slate-400">{c.input_mode === 'VOICE' ? '🎙️ Voice' : '⌨️ Text'} · {c.detected_language as string}</p>
        </Section>
      )}

      {d.appeals.length > 0 && (
        <Section title={t('appeal.title')}>
          {d.appeals.map((a) => (
            <div key={a.id as number} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{a.status === 'PENDING' ? `⏳ ${t('appeal.pending')}` : a.status === 'ACCEPTED' ? `✅ ${t('appeal.accepted')}` : `❌ ${t('appeal.rejected')}`}</p>
              <p className="mt-1 text-slate-600">“{a.reason_text as string}”</p>
              {a.decision_notes && <p className="mt-1">{t('appeal.decision')}: {a.decision_notes as string}</p>}
            </div>
          ))}
        </Section>
      )}
      {canAppeal && <AppealForm code={c.code as string} />}
    </div>
  );
}
