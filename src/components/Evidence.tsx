import { makeT, type Lang } from '@/i18n';
import { fmtDateTime } from '@/lib/format';

export interface EvidenceItem {
  id: number; kind: string; media_type: string; latitude: number | null; longitude: number | null; gps_accuracy_m: number | null;
  captured_at: string | Date | null; created_at: string | Date; uploaded_by_name?: string; capture_source?: string | null;
}

function Media({ e, lang }: { e: EvidenceItem; lang: Lang }) {
  const src = `/api/evidence/${e.id}`;
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      {e.media_type === 'VIDEO' ? (
        <video src={src} controls preload="metadata" className="aspect-[4/3] w-full bg-black object-contain" />
      ) : (
        <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" /></a>
      )}
      <figcaption className="space-y-0.5 p-2 text-[11px] text-slate-500">
        <div>🕒 {fmtDateTime(e.captured_at ?? e.created_at, lang)} {e.capture_source === 'CAMERA' ? '· 📷' : ''}</div>
        {e.latitude != null && <div>📍 {e.latitude.toFixed(5)}, {e.longitude?.toFixed(5)}{e.gps_accuracy_m ? ` ±${Math.round(e.gps_accuracy_m)}m` : ''}</div>}
        {e.uploaded_by_name && <div>👤 {e.uploaded_by_name}</div>}
      </figcaption>
    </figure>
  );
}

/** Before (citizen) vs After (official completion) evidence, side by side. */
export function BeforeAfter({ evidence, lang }: { evidence: EvidenceItem[]; lang: Lang }) {
  const t = makeT(lang);
  const before = evidence.filter((e) => e.kind === 'CITIZEN');
  const after = evidence.filter((e) => e.kind === 'COMPLETION');
  if (!before.length && !after.length) return <p className="text-sm text-slate-500">{t('complaint.noEvidence')}</p>;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="mb-1.5 text-center text-xs font-bold uppercase tracking-wide text-red-700">⬅ {t('complaint.before')}</p>
        <div className="space-y-2">{before.length ? before.map((e) => <Media key={e.id} e={e} lang={lang} />) : <p className="text-center text-xs text-slate-400">—</p>}</div>
      </div>
      <div>
        <p className="mb-1.5 text-center text-xs font-bold uppercase tracking-wide text-leaf-700">{t('complaint.after')} ➡</p>
        <div className="space-y-2">{after.length ? after.map((e) => <Media key={e.id} e={e} lang={lang} />) : <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">{t('complaint.pending')}</p>}</div>
      </div>
    </div>
  );
}

export function EvidenceGrid({ evidence, lang }: { evidence: EvidenceItem[]; lang: Lang }) {
  if (!evidence.length) return null;
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{evidence.map((e) => <Media key={e.id} e={e} lang={lang} />)}</div>;
}
