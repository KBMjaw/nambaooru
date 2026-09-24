'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg, type MessageKey } from '@/i18n';
import { api } from '@/lib/client-api';
import { compressImage, getLocation, type Geo } from '@/lib/image';
import { Alert, Spinner } from '@/components/ui';

export type FieldKind =
  | 'note' | 'notes' | 'photo' | 'photoRequired' | 'gps' | 'gpsRequired' | 'progress' | 'outcome' | 'reason'
  | 'assignee' | 'inspector' | 'dueAt' | 'priority' | 'closeToggle';

export interface UserOpt { id: string; full_name: string; role: string; designation?: string | null }

const OUTCOMES = ['VERIFIED', 'NOT_FOUND', 'DUPLICATE', 'ALREADY_RESOLVED', 'INVALID', 'REQUIRES_HIGHER_AUTHORITY'];
const REASONS = ['DUPLICATE', 'NOT_FOUND', 'OUTSIDE_JURISDICTION', 'INSUFFICIENT_EVIDENCE', 'ALREADY_RESOLVED', 'INVALID', 'OTHER'];

export function ActionForm({
  code, action, label, fields = [], users = [], extra = {}, tone = 'btn-navy', icon = '', defaults = {}, confirmText, startOpen = false, block = false,
}: {
  code: string; action: string; label: string; fields?: FieldKind[]; users?: UserOpt[]; extra?: Record<string, unknown>;
  tone?: string; icon?: string; defaults?: Record<string, string>; confirmText?: string; startOpen?: boolean; block?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, string>>({ priority: 'MEDIUM', progress: '50', ...defaults });
  const [close, setClose] = useState(true);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const has = (f: FieldKind) => fields.includes(f);
  const needsPhoto = has('photoRequired');
  const needsGps = has('gpsRequired');
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));

  async function captureGps() {
    setGeoBusy(true);
    try { setGeo(await getLocation()); } catch { setError(t('report.locationDenied')); } finally { setGeoBusy(false); }
  }

  async function submit() {
    setError(null);
    if (needsPhoto && !photo) return setError(t('report.photoNeeded'));
    if (needsGps && !geo) return setError(t('field.needLocation'));
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const data: Record<string, unknown> = { action, ...extra };
    for (const [k, val] of Object.entries(v)) if (val !== '') data[k] = val;
    if (has('closeToggle')) data.close = close;
    if (geo) Object.assign(data, { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy });
    try {
      if (photo) {
        const fd = new FormData();
        fd.set('data', JSON.stringify(data));
        fd.set('photo', photo.file);
        await api(`/api/office/complaints/${code}/action`, { form: fd });
      } else {
        await api(`/api/office/complaints/${code}/action`, { body: data });
      }
      setOpen(false);
      setPhoto(null);
      router.refresh();
    } catch (e) {
      setError(trMsg(t, (e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const simple = fields.length === 0;
  if (!open) {
    return (
      <button type="button" className={`btn ${tone} ${block ? 'w-full' : ''}`} disabled={busy} onClick={() => (simple ? void submit() : setOpen(true))}>
        {busy ? <Spinner className="h-4 w-4" /> : icon} {label}
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="font-bold text-slate-800">{icon} {label}</p>
      {error && <Alert tone="error">{error}</Alert>}

      {(has('assignee') || has('inspector')) && (
        <label className="block">
          <span className="label">{has('inspector') ? t('office.inspector') : t('office.assignTo')}</span>
          <select className="input" value={v[has('inspector') ? 'inspectorId' : 'assigneeId'] ?? ''} onChange={(e) => set(has('inspector') ? 'inspectorId' : 'assigneeId', e.target.value)}>
            <option value="">{t('office.selectUser')}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} — {t(`role.${u.role}` as MessageKey)}{u.designation ? ` (${u.designation})` : ''}</option>)}
          </select>
        </label>
      )}
      {has('outcome') && (
        <label className="block">
          <span className="label">{t('office.outcome')}</span>
          <select className="input" value={v.outcome ?? ''} onChange={(e) => set('outcome', e.target.value)}>
            <option value="">{t('common.select')}</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{t(`outcome.${o}` as MessageKey)}</option>)}
          </select>
        </label>
      )}
      {has('reason') && (
        <>
          <label className="block">
            <span className="label">{t('office.reason')}</span>
            <select className="input" value={v.reason ?? ''} onChange={(e) => set('reason', e.target.value)}>
              <option value="">{t('common.select')}</option>
              {REASONS.map((r) => <option key={r} value={r}>{t(`reason.${r}` as MessageKey)}</option>)}
            </select>
          </label>
          {v.reason === 'DUPLICATE' && (
            <label className="block"><span className="label">{t('office.duplicateOfCode')}</span>
              <input className="input font-mono uppercase" value={v.duplicateOf ?? ''} onChange={(e) => set('duplicateOf', e.target.value.toUpperCase())} placeholder="NU-2026-001001" />
            </label>
          )}
        </>
      )}
      {has('priority') && (
        <label className="block"><span className="label">{t('office.priority')}</span>
          <select className="input" value={v.priority} onChange={(e) => set('priority', e.target.value)}>
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => <option key={p} value={p}>{t(`priority.${p}` as MessageKey)}</option>)}
          </select>
        </label>
      )}
      {has('dueAt') && (
        <label className="block"><span className="label">{t('office.dueDate')}</span>
          <input type="date" className="input" min={new Date().toISOString().slice(0, 10)} value={v.dueAt ?? ''} onChange={(e) => set('dueAt', e.target.value)} />
        </label>
      )}
      {has('progress') && (
        <label className="block"><span className="label">{t('field.progressPct')}: {v.progress}%</span>
          <input type="range" min={0} max={100} step={10} className="w-full" value={v.progress} onChange={(e) => set('progress', e.target.value)} />
        </label>
      )}
      {has('notes') && (
        <label className="block"><span className="label">{t('complaint.notes')}</span>
          <textarea className="input min-h-20" value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
        </label>
      )}
      {has('note') && (
        <label className="block"><span className="label">{t('office.note')} ({t('common.optional')})</span>
          <textarea className="input min-h-16" value={v.note ?? ''} onChange={(e) => set('note', e.target.value)} maxLength={1000} />
        </label>
      )}
      {(has('photo') || needsPhoto) && (
        <div>
          <span className="label">{needsPhoto ? t('office.photoRequired') : `${t('report.uploadPhoto')} (${t('common.optional')})`}</span>
          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>📷 {t('report.takePhoto')}</button>
            {photo && <img src={photo.url} alt="" className="h-16 w-16 rounded-lg object-cover" />}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { const c = await compressImage(f); setPhoto({ file: c.file, url: c.url }); if (!geo) void captureGps(); } catch { setError(t('err.fileType')); }
            e.target.value = '';
          }} />
        </div>
      )}
      {(has('gps') || needsGps) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="btn btn-outline btn-sm" onClick={captureGps} disabled={geoBusy}>{geoBusy ? <Spinner className="h-4 w-4" /> : '📍'} {t('office.captureGps')}</button>
          {geo && <span className="text-leaf-700">✓ {t('office.gpsOk')} ({geo.latitude.toFixed(5)}, {geo.longitude.toFixed(5)} ±{geo.accuracy}m)</span>}
        </div>
      )}
      {has('closeToggle') && (
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} /> {t('office.closeAfterVerify')}</label>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-outline flex-1" onClick={() => setOpen(false)}>{t('office.cancel')}</button>
        <button type="button" className={`btn ${tone} flex-1`} disabled={busy} onClick={submit}>{busy && <Spinner className="h-4 w-4" />}{t('office.confirm')}</button>
      </div>
    </div>
  );
}
