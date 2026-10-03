import type { ComplaintDetail } from '@/lib/complaint-detail';
import { makeT, type Lang } from '@/i18n';
import { fmtDateTime } from '@/lib/format';
import { maskMobile } from '@/lib/crypto';
import { Section } from '@/components/ui';
import { EvidenceGrid } from '@/components/Evidence';

/** What the citizen actually submitted: their words, classification, location, priority / due date and their own photos. */
export function CitizenSubmission({ d, lang, showContact }: { d: ComplaintDetail; lang: Lang; showContact: boolean }) {
  const t = makeT(lang);
  const { c } = d;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const ai = (c.ai_extraction ?? {}) as { translation_en?: string };
  const location = [L(c.street_en ?? c.street_text, c.street_ta ?? c.street_text), c.ward_number != null ? `${t('complaint.ward')} ${c.ward_number}` : null, L(c.lb_en, c.lb_ta)].filter(Boolean).join(', ');
  const photos = d.evidence.filter((e) => e.kind === 'CITIZEN');
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div><dt className="inline text-slate-500">{k}: </dt><dd className="inline font-semibold">{children}</dd></div>;
  return (
    <Section title={`🧑 ${t('wf.citizenSubmission')}`}>
      <p className="whitespace-pre-line text-slate-800">“{c.original_text as string}”</p>
      <p className="mt-1 text-xs text-slate-400">{c.input_mode === 'VOICE' ? '🎙️ Voice' : '⌨️ Text'} · {c.detected_language as string} · {fmtDateTime(c.submitted_at as string, lang)}</p>
      {ai.translation_en && <p className="mt-2 text-sm text-slate-600">EN: {ai.translation_en}</p>}
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <Row k={t('complaint.id')}><span className="font-mono">{c.code as string}</span></Row>
        <Row k={t('wf.category')}>{c.icon as string} {[L(c.category_en, c.category_ta), L(c.sub_en, c.sub_ta), L(c.issue_en, c.issue_ta)].filter(Boolean).join(' › ')}</Row>
        <Row k={t('complaint.location')}>{location || '—'}{c.landmark ? ` · ${c.landmark}` : ''}</Row>
        <Row k={t('complaint.submitted')}>{fmtDateTime(c.submitted_at as string, lang)}</Row>
        <Row k={t('complaint.priority')}>{t(`priority.${c.priority}` as never)}</Row>
        <Row k={t('complaint.dueIn')}>{c.sla_due_at ? fmtDateTime(c.sla_due_at as string, lang) : '—'}</Row>
        <Row k={t('office.citizenContact')}>{c.citizen_name as string} · 📞 {showContact ? <a className="underline" href={`tel:+91${c.citizen_mobile}`}>{c.citizen_mobile as string}</a> : maskMobile(c.citizen_mobile as string)}</Row>
      </dl>
      <p className="mb-2 mt-3 text-sm font-bold text-slate-600">{t('evk.CITIZEN')} ({photos.length})</p>
      {photos.length ? <EvidenceGrid evidence={photos as never} lang={lang} /> : <p className="text-sm text-slate-500">{t('wf.noCitizenPhoto')}</p>}
    </Section>
  );
}
