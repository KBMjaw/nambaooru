import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageUser, has } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getT } from '@/i18n/server';
import { complaintScope } from '@/lib/scope';
import { getComplaintDetail, complaintWorkData } from '@/lib/complaint-detail';
import { findDuplicates } from '@/lib/duplicates';
import { maskMobile } from '@/lib/crypto';
import { fmtDateTime, mapsLink, navigateLink } from '@/lib/format';
import { StatusBadge, PriorityBadge } from '@/components/badges';
import { Section, Alert } from '@/components/ui';
import { BeforeAfter, EvidenceGrid } from '@/components/Evidence';
import { Timeline } from '@/components/Timeline';
import { ActionForm } from '@/components/office/ActionForm';
import { TakeAction } from '@/components/office/TakeAction';
import { complaintActions } from '@/components/office/complaintActions';
import { WorkflowSections } from '@/components/office/WorkflowSections';
import { ComplaintMiniMap } from '@/components/office/ComplaintMiniMap';
import { ActionsPanel, type ActionRow } from '@/components/office/ActionsPanel';
import type { MessageKey } from '@/i18n';

export default async function OfficeComplaintDetail({ params }: { params: Promise<{ code: string }> }) {
  const u = await requirePageUser('OFFICE');
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  const { t, lang } = await getT();
  // Jurisdiction check first — a complaint outside scope is simply "not found"
  const visible = await sql`SELECT c.id FROM complaints c WHERE c.code = ${code} AND (${complaintScope(u)})`;
  if (!visible.length) notFound();
  const d = (await getComplaintDetail({ code }))!;
  const { c } = d;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');
  const status = c.status as string;
  const open = !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(status);
  const ai = (c.ai_extraction ?? {}) as { category?: string; confidence?: number; severity?: string; matchedTerms?: string[]; engine?: string; language?: string; safety?: { cues_en?: string[] }; duration?: { en?: string }; citizenChoseCategory?: string; translation_en?: string };

  const work = await complaintWorkData(u, c);
  const dups = open && has(u, 'complaint.reject') ? await findDuplicates({
    categoryId: c.category_id as number, localBodyId: c.local_body_id as number, wardId: c.ward_id as number | null, streetId: c.street_id as number | null,
    latitude: c.latitude as number | null, longitude: c.longitude as number | null, text: c.original_text as string, excludeId: c.id as number,
  }) : [];
  const audits = has(u, 'audit.view') || u.scope !== 'ASSIGNED'
    ? await sql`SELECT a.action, a.created_at, a.actor_role, u.full_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
                WHERE a.entity_type = 'complaint' AND a.entity_id = ${code} ORDER BY a.created_at DESC LIMIT 50`
    : [];
  const pendingAppeals = d.appeals.filter((a) => a.status === 'PENDING');

  // ---- Actions permitted for THIS user at THIS stage (the API re-checks everything) ----
  const { nodes: actions, nextStep } = await complaintActions(u, d, work, t, lang, 'OFFICE');
  const appealNodes = pendingAppeals.length > 0 && has(u, 'appeal.review') ? pendingAppeals.map((ap) => (
    <div key={`ap${ap.id}`} className="space-y-2 rounded-xl border border-navy-100 bg-navy-50 p-3 text-sm md:col-span-2">
      <p className="font-bold">🔁 {t('appeal.pending')}</p>
      <p className="italic">“{ap.reason_text as string}”</p>
      <ActionForm code={code} action="appeal_decide" label={t('appeal.accept')} icon="✅" tone="btn-primary" fields={['notes']} extra={{ appealId: ap.id, decision: 'ACCEPTED' }} block />
      <ActionForm code={code} action="appeal_decide" label={t('appeal.reject')} icon="❌" tone="btn-outline" fields={['notes']} extra={{ appealId: ap.id, decision: 'REJECTED' }} block />
    </div>
  )) : [];

  const location = [L(c.street_en ?? c.street_text, c.street_ta ?? c.street_text), c.ward_number != null ? `${t('complaint.ward')} ${c.ward_number}` : null, L(c.lb_en, c.lb_ta)].filter(Boolean).join(', ');
  const lat = (c.latitude as number | null) ?? null;
  const lng = (c.longitude as number | null) ?? null;
  const overdue = open && c.sla_due_at && new Date(c.sla_due_at as string) < new Date();
  const evidencePoints = d.evidence.filter((e) => e.latitude != null).map((e) => ({ lat: e.latitude as number, lng: e.longitude as number, kind: e.kind as string }));

  return (
    <div className="space-y-4">
      <Link href="/office/complaints" className="text-sm font-semibold text-navy-600">← {t('nav.complaints')}</Link>
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-extrabold text-navy-800">{code}</span>
          <StatusBadge status={status} />
          <PriorityBadge priority={c.priority as string} />
          {(c.escalation_level as number) > 0 && <span className="badge bg-amber-100 text-amber-900">⬆️ {t('wf.escLevel', { n: c.escalation_level as number })}: {t(`esc.${c.escalation_level}` as MessageKey)}</span>}
          {c.safety_risk && <span className="badge bg-red-100 text-red-700">⚠️ {t('complaint.safety')}</span>}
          {(c.supporters_count as number) > 0 && <span className="badge bg-navy-50 text-navy-700">👥 +{c.supporters_count as number}</span>}
          {overdue && <span className="badge bg-red-600 text-white">⏰ {t('complaint.overdue')}</span>}
        </div>
        <h1 className="mt-2 text-xl font-extrabold text-slate-800">{c.icon as string} {L(c.title_en, c.title_ta)}</h1>
        <p className="mt-1 text-slate-700">{L(c.summary_en, c.summary_ta)}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>📍 {location}{c.landmark ? ` · ${c.landmark}` : ''}</span>
          <span>🏛️ {L(c.dept_en, c.dept_ta) || '—'}</span>
          <span>🗓️ {fmtDateTime(c.submitted_at as string, lang)}</span>
          <span>⏳ {t('complaint.dueIn')}: {fmtDateTime(c.sla_due_at as string, lang)}</span>
          {c.assigned_name && <span>👷 {c.assigned_name as string}</span>}
        </div>
        {c.location_conflict && <div className="mt-2"><Alert tone="warn">📍 {t('complaint.locationFlag')}: {c.location_conflict_note as string}</Alert></div>}
        {(c.escalation_level as number) > 0 && c.escalation_note && <div className="mt-2"><Alert tone="warn">⬆️ {c.escalation_note as string}</Alert></div>}
        {status === 'ON_HOLD' && <div className="mt-2"><Alert tone="warn">⏸️ {t('status.ON_HOLD')}: <b>{t(`hold.${c.on_hold_reason}` as MessageKey)}</b>{c.on_hold_note ? ` — ${c.on_hold_note}` : ''}{c.on_hold_since ? ` · ${fmtDateTime(c.on_hold_since as string, lang)}` : ''}</Alert></div>}
        {status === 'REWORK_REQUIRED' && d.completions[0]?.verification_notes && <div className="mt-2"><Alert tone="error">↩️ {t('status.REWORK_REQUIRED')}: {d.completions[0].verification_notes as string}</Alert></div>}
        {status === 'SITE_INSPECTION' && c.inspection_outcome && <div className="mt-2"><Alert tone="info">🔍 {t('office.inspectionOutcomeWaiting')}: <b>{t(`outcome.${c.inspection_outcome}` as MessageKey)}</b></Alert></div>}
        {(status === 'REJECTED' || status === 'DUPLICATE') && (
          <div className="mt-2"><Alert tone="error">{t(`reason.${c.rejection_reason}` as MessageKey)} — {c.rejection_notes as string}{c.duplicate_of_code ? ` (${c.duplicate_of_code})` : ''}</Alert></div>
        )}
      </div>

      <TakeAction nextStep={nextStep} count={actions.length + appealNodes.length} startOpen={appealNodes.length > 0}>{[...appealNodes, ...actions]}</TakeAction>

      <WorkflowSections d={d} lang={lang} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={t('complaint.evidence')}>
            <BeforeAfter evidence={d.evidence as never} lang={lang} />
            {(['BEFORE_WORK', 'PROGRESS', 'COMPLETION', 'INSPECTION', 'VERIFICATION', 'APPEAL'] as const).filter((kind) => d.evidence.some((e) => e.kind === kind)).map((kind) => (
              <div key={kind} className="mt-4">
                <p className="mb-2 text-sm font-bold text-slate-600">{t(`evk.${kind}` as MessageKey)} ({d.evidence.filter((e) => e.kind === kind).length})</p>
                <EvidenceGrid evidence={d.evidence.filter((e) => e.kind === kind) as never} lang={lang} />
              </div>
            ))}
          </Section>

          <Section title={`📍 ${t('complaint.location')}`} action={lat != null && lng != null ? (
            <span className="flex gap-2"><a className="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer" href={mapsLink(lat, lng)}>{t('complaint.openMap')}</a><a className="btn btn-navy btn-sm" target="_blank" rel="noopener noreferrer" href={navigateLink(lat, lng)}>🧭 {t('complaint.navigate')}</a></span>
          ) : undefined}>
            <ComplaintMiniMap lat={lat ?? (c.lb_lat as number)} lng={lng ?? (c.lb_lng as number)} accuracy={c.gps_accuracy_m as number | null} approx={lat == null} points={evidencePoints} />
            <p className="mt-2 text-xs text-slate-500">{lat != null ? `GPS ${lat.toFixed(5)}, ${lng!.toFixed(5)} ±${Math.round((c.gps_accuracy_m as number) ?? 0)}m · ${fmtDateTime(c.gps_captured_at as string, lang)}` : 'No GPS — local body centre shown'}</p>
          </Section>

          <Section title={t('complaint.original')}>
            <p className="italic text-slate-700">“{c.original_text as string}”</p>
            <p className="mt-1 text-xs text-slate-400">{c.input_mode === 'VOICE' ? '🎙️ Voice' : '⌨️ Text'} · {c.detected_language as string}</p>
            {ai.translation_en && <p className="mt-2 text-sm text-slate-600">EN: {ai.translation_en}</p>}
          </Section>

          <Section title={`🛠️ ${t('actions.title')} (${work.actions.length})`}>
            <ActionsPanel code={code} portal="OFFICE" actions={work.actions as ActionRow[]} staff={work.staffWithSelf} departments={work.departments} perms={work.perms} meId={u.id} open={open} />
          </Section>

          {(d.inspections.length > 0 || d.updates.length > 0) && (
            <Section title={`${t('complaint.inspection')} · ${t('office.workUpdates')}`}>
              <ul className="space-y-2 text-sm">
                {d.inspections.map((i) => (
                  <li key={`i${i.id}`} className="rounded-lg bg-violet-50 p-2.5">🔍 <b>{t(`outcome.${i.outcome}` as MessageKey)}</b> — {i.notes as string}<br />
                    <span className="text-xs text-slate-500">{t('complaint.inspectionBy', { name: i.inspector_name as string })} · {fmtDateTime(i.inspected_at as string, lang)}{i.latitude != null ? ` · 📍 ${(i.latitude as number).toFixed(5)}, ${(i.longitude as number).toFixed(5)}` : ''}</span></li>
                ))}
                {d.updates.map((w) => (
                  <li key={`w${w.id}`} className="rounded-lg bg-amber-50 p-2.5">🛠️ <b>{t(`wu.${w.update_type}` as MessageKey)}</b>{w.progress_pct != null ? ` ${w.progress_pct}%` : ''} — {(w.notes as string) ?? ''}
                    <br /><span className="text-xs text-slate-500">{w.user_name as string} · {fmtDateTime(w.created_at as string, lang)}</span></li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <Section title={`🤖 ${t('office.aiSuggest')}`}>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">{t('office.aiCategory')}</dt><dd className="font-semibold">{ai.category ?? '—'}{ai.citizenChoseCategory ? ` → ${ai.citizenChoseCategory} (citizen)` : ''}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">{t('office.aiConfidence')}</dt><dd className="font-semibold">{ai.confidence != null ? `${Math.round(ai.confidence * 100)}%` : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">{t('office.aiSeverity')}</dt><dd>{ai.severity ? <PriorityBadge priority={ai.severity} /> : '—'}</dd></div>
              {ai.duration?.en && <div className="flex justify-between"><dt className="text-slate-500">{t('report.duration')}</dt><dd className="font-semibold">{ai.duration.en}</dd></div>}
              {!!ai.safety?.cues_en?.length && <div className="flex justify-between gap-2"><dt className="text-slate-500">{t('complaint.safety')}</dt><dd className="text-right font-semibold text-red-700">{ai.safety.cues_en.join(', ')}</dd></div>}
              {!!ai.matchedTerms?.length && <div className="pt-1 text-xs text-slate-500">🔑 {ai.matchedTerms.slice(0, 10).join(' · ')}</div>}
              <div className="text-xs text-slate-400">engine: {ai.engine ?? c.ai_engine as string} · lang: {ai.language ?? '—'}</div>
            </dl>
            {open && has(u, 'complaint.reject') && (
              <div className="mt-3 border-t border-slate-100 pt-2">
                <p className="text-sm font-bold text-slate-700">{t('office.aiDuplicates')}</p>
                {dups.length ? dups.map((x) => (
                  <Link key={x.code} href={`/office/complaints/${x.code}`} className="mt-1 block rounded-lg bg-orange-50 p-2 text-xs hover:bg-orange-100">
                    <b className="font-mono">{x.code}</b> · {t(`status.${x.status}` as MessageKey)} · score {x.score} · {x.reasons.join(', ')}{x.distanceM != null ? ` · ${x.distanceM}m` : ''}
                  </Link>
                )) : <p className="text-xs text-slate-500">{t('office.aiNoDuplicates')}</p>}
                {c.possible_duplicate_code && <p className="mt-1 text-xs text-amber-700">Citizen overrode suggested duplicate: {c.possible_duplicate_code as string}</p>}
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-400">{t('office.aiDisclaimer')}</p>
          </Section>

          <Section title={`👤 ${t('office.citizenContact')}`}>
            <p className="text-sm font-semibold">{c.citizen_name as string}</p>
            <p className="text-sm text-slate-600">📞 {has(u, 'citizen.pii.view') ? <a className="underline" href={`tel:+91${c.citizen_mobile}`}>{c.citizen_mobile as string}</a> : maskMobile(c.citizen_mobile as string)}</p>
          </Section>

          <Section title={t('complaint.timeline')}>
            <Timeline history={d.history.map((h) => ({ to_status: h.to_status as string, created_at: h.created_at as string }))} status={status} lang={lang} />
          </Section>

          <Section title={`🧾 ${t('office.history')}`}>
            <ol className="space-y-2 text-xs">
              {[...d.history].reverse().map((h) => (
                <li key={h.id as number} className="border-l-2 border-slate-200 pl-2">
                  <span className="font-semibold text-slate-700">{h.from_status === h.to_status ? '📝' : `${h.from_status ? t(`status.${h.from_status}` as MessageKey) : '—'} → ${t(`status.${h.to_status}` as MessageKey)}`}</span>
                  {!h.public_note && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">internal</span>}
                  <div className="text-slate-500">{(h.actor_label as string) ?? 'System'} · {fmtDateTime(h.created_at as string, lang)}</div>
                  {h.note && <div className="text-slate-700">{h.note as string}</div>}
                </li>
              ))}
            </ol>
            {audits.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-slate-500">Audit log ({audits.length})</summary>
                <ul className="mt-1 space-y-1">{audits.map((a, i) => <li key={i}>{fmtDateTime(a.created_at as string, lang)} · {(a.full_name as string) ?? a.actor_role as string} · <code>{a.action as string}</code></li>)}</ul>
              </details>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
