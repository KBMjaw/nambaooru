import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth';
import { getT } from '@/i18n/server';
import { getComplaintDetail } from '@/lib/complaint-detail';
import { fmtDateTime } from '@/lib/format';
import { StatusBadge, PriorityBadge } from '@/components/badges';
import { Section } from '@/components/ui';
import { BeforeAfter } from '@/components/Evidence';
import { Timeline } from '@/components/Timeline';

export default async function AdminComplaint({ params }: { params: Promise<{ code: string }> }) {
  await requirePageUser('ADMIN', 'complaint.view.all');
  const { t, lang } = await getT();
  const d = await getComplaintDetail({ code: decodeURIComponent((await params).code) });
  if (!d) notFound();
  const { c } = d;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  return (
    <div className="space-y-4">
      <Link href="/admin/complaints" className="text-sm font-semibold text-navy-600">← {t('nav.complaints')}</Link>
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-lg font-extrabold">{c.code as string}</span><StatusBadge status={c.status as string} /><PriorityBadge priority={c.priority as string} /><span className="badge bg-slate-100">read-only</span></div>
        <p className="mt-2 font-bold">{c.icon as string} {L(c.title_en, c.title_ta)}</p>
        <p className="text-slate-700">{L(c.summary_en, c.summary_ta)}</p>
        <p className="mt-1 text-sm text-slate-500">{L(c.lb_en, c.lb_ta)} · {t('complaint.ward')} {(c.ward_number as number) ?? '—'} · {L(c.dept_en, c.dept_ta)} · {fmtDateTime(c.submitted_at as string, lang)}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Section title={t('complaint.evidence')} className="md:col-span-2"><BeforeAfter evidence={d.evidence as never} lang={lang} /></Section>
        <Section title={t('complaint.timeline')}><Timeline history={d.history.map((h) => ({ to_status: h.to_status as string, created_at: h.created_at as string }))} status={c.status as string} lang={lang} /></Section>
      </div>
      <Section title={t('office.history')}>
        <ol className="space-y-1 text-xs">{d.history.map((h) => <li key={h.id as number}>{fmtDateTime(h.created_at as string, lang)} · {(h.actor_label as string) ?? 'System'} · {h.from_status as string} → {h.to_status as string} {h.note ? `· ${h.note}` : ''}</li>)}</ol>
      </Section>
    </div>
  );
}
