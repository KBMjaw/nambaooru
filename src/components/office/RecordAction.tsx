'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg, type MessageKey } from '@/i18n';
import { api } from '@/lib/client-api';
import { compressImage, getLocation, type Geo } from '@/lib/image';
import { Alert, Spinner } from '@/components/ui';
import type { CompletionPolicy } from '@/lib/completion-policy';
import { completionError, distanceTo, photoMeta, policyLines, type PickedPhoto } from './completion-ui';

export type RecordType = 'ACKNOWLEDGE' | 'ACCEPT' | 'INSPECT' | 'ACTION_TAKEN' | 'WORK_STARTED' | 'WORK_COMPLETED' | 'ON_HOLD' | 'REWORK_REQUIRED' | 'OTHER';

const PHOTO_REQUIRED: RecordType[] = ['ACTION_TAKEN', 'WORK_COMPLETED', 'INSPECT'];
const HOLD = ['MATERIAL_UNAVAILABLE', 'WEATHER', 'PERMISSION_REQUIRED', 'EXTERNAL_AGENCY', 'SAFETY', 'OTHER'];
const OUTCOMES = ['VERIFIED', 'NOT_FOUND', 'DUPLICATE', 'ALREADY_RESOLVED', 'INVALID', 'REQUIRES_HIGHER_AUTHORITY'];
const MAX_PHOTOS = 5;

/**
 * "Record an action": action type + required description (+ photo evidence where the type needs it).
 * Only the types this user may record at this stage are offered; the API re-checks everything.
 */
export function RecordAction({ code, types, photoTypes, portal = 'OFFICE', completion }: { code: string; types: RecordType[]; photoTypes: RecordType[]; portal?: 'OFFICE' | 'ADMIN'; completion?: CompletionPolicy }) {
  const { t } = useI18n();
  const router = useRouter();
  const [type, setType] = useState<RecordType | ''>(types.length === 1 ? types[0] : '');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'INTERNAL'>('PUBLIC');
  const [holdReason, setHoldReason] = useState('OTHER');
  const [outcome, setOutcome] = useState('VERIFIED');
  const [publicReason, setPublicReason] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const completing = type === 'WORK_COMPLETED';
  // Gallery / file upload is offered except to lower-grade staff completing work from a phone (live photo only)
  const allowGallery = completing && !completion?.liveOnly;
  const dist = completing ? distanceTo(completion, geo) : null;
  const needsPhoto = !!type && PHOTO_REQUIRED.includes(type);
  const canPhoto = !!type && (needsPhoto || photoTypes.includes(type));
  const showVisibility = type === 'ACTION_TAKEN' || type === 'WORK_STARTED' || type === 'OTHER';

  function pick(v: RecordType | '') {
    setType(v);
    setError(null);
    setSaved(null);
    setVisibility(v === 'OTHER' ? 'INTERNAL' : 'PUBLIC');
  }

  async function captureGps() {
    setGeoBusy(true);
    try { setGeo(await getLocation()); } catch { setError(t('report.locationDenied')); } finally { setGeoBusy(false); }
  }

  async function submit() {
    setError(null);
    setSaved(null);
    if (!type) return setError(t('ra.pickType'));
    if (description.trim().length < 5) return setError(t('ra.descNeeded'));
    if (needsPhoto && !photos.length) return setError(t('ra.photoNeeded'));
    if (type === 'INSPECT' && !geo) return setError(t('field.needLocation'));
    if (completing) { const err = completionError(t, completion, geo, photos); if (err) return setError(err); }
    const data: Record<string, unknown> = { action: 'record', actionType: type, description: description.trim() };
    if (showVisibility) data.visibility = visibility;
    if (type === 'ON_HOLD') data.holdReason = holdReason;
    if (type === 'INSPECT') data.outcome = outcome;
    if (type === 'REWORK_REQUIRED' && publicReason.trim()) data.publicReason = publicReason.trim();
    if (geo) Object.assign(data, { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy });
    if (photos.length && canPhoto) data.photoMeta = photoMeta(photos);
    setBusy(true);
    try {
      const url = `/api/office/complaints/${encodeURIComponent(code)}/action?portal=${portal}`;
      let res: { actionCode?: string };
      if (photos.length && canPhoto) {
        const fd = new FormData();
        fd.set('data', JSON.stringify(data));
        for (const p of photos) fd.append('photo', p.file);
        res = await api(url, { form: fd });
      } else {
        res = await api(url, { body: data });
      }
      setSaved(t('ra.saved', { code: res?.actionCode ?? '' }));
      setDescription('');
      setPhotos([]);
      setPublicReason('');
      setType('');
      router.refresh();
    } catch (e) {
      setError(trMsg(t, (e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="record-action" className="w-full space-y-3 rounded-xl border-2 border-navy-200 bg-white p-3 md:col-span-2">
      <p className="text-base font-extrabold text-navy-800">📝 {t('ra.title')}</p>
      {saved && <Alert tone="success">✅ {saved}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <label className="block"><span className="label">{t('ra.type')} *</span>
        <select name="actionType" className="input min-h-12 text-base" value={type} onChange={(e) => pick(e.target.value as RecordType | '')}>
          <option value="">{t('ra.pickType')}</option>
          {types.map((x) => <option key={x} value={x}>{t(`ra.t.${x}` as MessageKey)}</option>)}
        </select>
      </label>
      {type && ['ACTION_TAKEN', 'WORK_COMPLETED', 'REWORK_REQUIRED', 'INSPECT', 'ACCEPT'].includes(type) && (
        <p className="rounded-lg bg-navy-50 p-2 text-sm text-navy-800">{t(`ra.hint.${type}` as MessageKey)}</p>
      )}
      {completing && completion && (
        <ul data-testid="completion-policy" className="space-y-0.5 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          {policyLines(t, completion).map((l) => <li key={l}>{l}</li>)}
          <li>✅ {t('complete.finalApproval')}</li>
        </ul>
      )}
      {type === 'ON_HOLD' && (
        <label className="block"><span className="label">{t('wf.holdReason')} *</span>
          <select className="input" value={holdReason} onChange={(e) => setHoldReason(e.target.value)}>
            {HOLD.map((r) => <option key={r} value={r}>{t(`hold.${r}` as MessageKey)}</option>)}
          </select>
        </label>
      )}
      {type === 'INSPECT' && (
        <label className="block"><span className="label">{t('office.outcome')}</span>
          <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {OUTCOMES.map((o) => <option key={o} value={o}>{t(`outcome.${o}` as MessageKey)}</option>)}
          </select>
        </label>
      )}
      <label className="block"><span className="label">{type === 'REWORK_REQUIRED' ? t('rv.reworkReason') : t('ra.description')} *</span>
        <textarea name="description" className="input min-h-24" value={description} maxLength={2000} placeholder={t('ra.descriptionPh')} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {type === 'REWORK_REQUIRED' && (
        <label className="block"><span className="label">{t('wf.publicReason')} ({t('common.optional')})</span>
          <textarea className="input min-h-16" value={publicReason} maxLength={500} placeholder={t('wf.publicReasonPh')} onChange={(e) => setPublicReason(e.target.value)} />
        </label>
      )}
      {showVisibility && (
        <fieldset className="grid grid-cols-2 gap-2">
          {(['PUBLIC', 'INTERNAL'] as const).map((m) => (
            <label key={m} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm ${visibility === m ? 'border-navy-600 bg-white ring-2 ring-navy-100' : 'border-slate-200 bg-white'}`}>
              <input type="radio" name={`ra-vis-${code}`} checked={visibility === m} onChange={() => setVisibility(m)} className="mt-1" />
              <span><b>{t(m === 'INTERNAL' ? 'wf.noteInternal' : 'wf.notePublic')}</b><span className="block text-xs text-slate-500">{t(m === 'INTERNAL' ? 'wf.noteInternalHint' : 'wf.notePublicHint')}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {canPhoto && (
        <div>
          <span className="label">{needsPhoto ? t('ra.photoRequired') : `${t('report.uploadPhoto')} (${t('common.optional')})`} · {photos.length}/{MAX_PHOTOS}</span>
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((p, i) => (
              <span key={p.url} className="relative">
                <img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <button type="button" aria-label={t('common.remove')} className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
            {photos.length < MAX_PHOTOS && <button type="button" className="btn btn-outline min-h-12" onClick={() => fileRef.current?.click()}>📷 {t('report.takePhoto')}</button>}
            {photos.length < MAX_PHOTOS && allowGallery && <button type="button" className="btn btn-ghost min-h-12" onClick={() => galleryRef.current?.click()}>🖼️ {t('complete.gallery')}</button>}
          </div>
          {(allowGallery ? (['CAMERA', 'FILE'] as const) : (['CAMERA'] as const)).map((source) => (
            <input key={source} ref={source === 'CAMERA' ? fileRef : galleryRef} data-testid={source === 'CAMERA' ? 'record-photo' : 'record-gallery'} type="file" accept="image/*"
              capture={source === 'CAMERA' ? 'environment' : undefined} multiple hidden onChange={async (e) => {
                const fs = [...(e.target.files ?? [])].slice(0, MAX_PHOTOS - photos.length);
                e.target.value = '';
                for (const f of fs) {
                  try {
                    const c = await compressImage(f);
                    setPhotos((ps) => (ps.length < MAX_PHOTOS ? [...ps, { file: c.file, url: c.url, source, lastModified: f.lastModified || Date.now() }] : ps));
                  } catch { setError(t('err.fileType')); }
                }
                if (fs.length && !geo) void captureGps();
              }} />
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <button type="button" className="btn btn-outline btn-sm" onClick={captureGps} disabled={geoBusy}>{geoBusy ? <Spinner className="h-4 w-4" /> : '📍'} {t('office.captureGps')}</button>
            {geo && <span className="text-leaf-700">✓ {t('office.gpsOk')} ({geo.latitude.toFixed(5)}, {geo.longitude.toFixed(5)} ±{geo.accuracy}m)</span>}
            {dist != null && <span data-testid="completion-distance" className={completion?.maxDistanceM != null && dist > completion.maxDistanceM ? 'font-bold text-red-700' : 'text-slate-600'}>· {t('complete.distance', { d: dist })}</span>}
          </div>
        </div>
      )}
      <button type="button" className="btn btn-primary min-h-12 w-full text-base font-bold" disabled={busy} onClick={submit}>
        {busy && <Spinner className="h-4 w-4" />}💾 {t('ra.save')}
      </button>
    </div>
  );
}
