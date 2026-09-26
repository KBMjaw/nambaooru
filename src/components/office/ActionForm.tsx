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
  | 'assignee' | 'inspector' | 'dueAt' | 'priority' | 'closeToggle' | 'supporters' | 'noteRequired' | 'user'
  | 'holdReason' | 'method' | 'submitToggle' | 'supervisor' | 'classify' | 'level';

export interface ClassifyOpts {
  categories: { id: number; name: string }[];
  issueTypes: { id: number; category_id: number; name: string }[];
  departments: { id: number; name: string }[];
  canCategory: boolean;
  canDepartment: boolean;
}

export interface UserOpt { id: string; full_name: string; role: string; role_name?: string | null; designation?: string | null }

const OUTCOMES = ['VERIFIED', 'NOT_FOUND', 'DUPLICATE', 'ALREADY_RESOLVED', 'INVALID', 'REQUIRES_HIGHER_AUTHORITY'];
const REASONS = ['NOT_FOUND', 'INVALID', 'DUPLICATE', 'OUTSIDE_JURISDICTION', 'INSUFFICIENT_EVIDENCE', 'CANNOT_VERIFY', 'ALREADY_RESOLVED', 'OTHER'];
const HOLD = ['MATERIAL_UNAVAILABLE', 'WEATHER', 'PERMISSION_REQUIRED', 'EXTERNAL_AGENCY', 'SAFETY', 'OTHER'];
const MAX_PHOTOS = 5;

export function ActionForm({
  code, action, label, fields = [], users = [], supervisors = [], classify, extra = {}, tone = 'btn-navy', icon = '', defaults = {}, confirmText, startOpen = false, block = false, portal = 'OFFICE', hint,
}: {
  code: string; action: string; label: string; fields?: FieldKind[]; users?: UserOpt[]; supervisors?: UserOpt[]; classify?: ClassifyOpts; extra?: Record<string, unknown>;
  tone?: string; icon?: string; defaults?: Record<string, string>; confirmText?: string; startOpen?: boolean; block?: boolean; portal?: 'OFFICE' | 'ADMIN'; hint?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, string>>({ priority: 'MEDIUM', progress: '50', ...defaults });
  const [close, setClose] = useState(true);
  const [submitNow, setSubmitNow] = useState(true);
  const [support, setSupport] = useState<Set<string>>(new Set());
  const url = `/api/office/complaints/${encodeURIComponent(code)}/action?portal=${portal}`;
  const roleLabel = (u: UserOpt) => u.role_name ?? t(`role.${u.role}` as MessageKey);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const has = (f: FieldKind) => fields.includes(f);
  const needsPhoto = has('photoRequired');
  const fieldVerify = has('method') && v.method === 'FIELD';
  const needsGps = has('gpsRequired') || fieldVerify;
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));

  async function captureGps() {
    setGeoBusy(true);
    try { setGeo(await getLocation()); } catch { setError(t('report.locationDenied')); } finally { setGeoBusy(false); }
  }

  async function submit() {
    setError(null);
    if (needsPhoto && !photos.length) return setError(t('report.photoNeeded'));
    if (has('holdReason') && !v.reason) return setError(t('wf.holdReasonNeeded'));
    if (fieldVerify && (v.notes ?? '').trim().length < 3) return setError(t('wf.fieldNotesNeeded'));
    if (needsGps && !geo) return setError(t('field.needLocation'));
    if (has('noteRequired') && (v.note ?? '').trim().length < 3) return setError(t('err.reasonRequired'));
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const data: Record<string, unknown> = { action, ...extra };
    for (const [k, val] of Object.entries(v)) if (val !== '') data[k] = val;
    if (has('closeToggle')) data.close = close;
    if (has('submitToggle')) data.submit = submitNow;
    if (has('supporters')) data.supportIds = [...support].filter((x) => x !== v.assigneeId);
    if (geo) Object.assign(data, { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy });
    try {
      if (photos.length) {
        const fd = new FormData();
        fd.set('data', JSON.stringify(data));
        for (const p of photos) fd.append('photo', p.file);
        await api(url, { form: fd });
      } else {
        await api(url, { body: data });
      }
      setOpen(false);
      setPhotos([]);
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
      <button type="button" className={`btn ${tone} min-h-11 ${block ? 'w-full' : ''}`} disabled={busy} onClick={() => (simple ? void submit() : setOpen(true))}>
        {busy ? <Spinner className="h-4 w-4" /> : icon} {label}
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="font-bold text-slate-800">{icon} {label}</p>
      {hint && <p className="text-sm text-slate-600">{hint}</p>}
      {error && <Alert tone="error">{error}</Alert>}

      {has('classify') && classify && (
        <>
          {classify.canCategory && (
            <>
              <label className="block"><span className="label">{t('wf.category')}</span>
                <select className="input" value={v.categoryId ?? ''} onChange={(e) => setV((s0) => ({ ...s0, categoryId: e.target.value, issueTypeId: '' }))}>
                  {classify.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="block"><span className="label">{t('wf.issueType')}</span>
                <select className="input" value={v.issueTypeId ?? ''} onChange={(e) => set('issueTypeId', e.target.value)}>
                  <option value="">—</option>
                  {classify.issueTypes.filter((it) => String(it.category_id) === String(v.categoryId)).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
              </label>
            </>
          )}
          {classify.canDepartment && (
            <label className="block"><span className="label">{t('wf.assignedDept')}</span>
              <select className="input" value={v.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value)}>
                {classify.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
        </>
      )}
      {has('method') && (
        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(['EVIDENCE', 'FIELD'] as const).map((m) => (
            <label key={m} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm ${(v.method ?? 'EVIDENCE') === m ? 'border-navy-600 bg-white ring-2 ring-navy-100' : 'border-slate-200 bg-white'}`}>
              <input type="radio" name={`method-${code}-${action}`} checked={(v.method ?? 'EVIDENCE') === m} onChange={() => set('method', m)} className="mt-1" />
              <span><b>{t(m === 'EVIDENCE' ? 'wf.methodEvidence' : 'wf.methodField')}</b><span className="block text-xs text-slate-500">{t(m === 'EVIDENCE' ? 'wf.methodEvidenceHint' : 'wf.methodFieldHint')}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {has('holdReason') && (
        <label className="block"><span className="label">{t('wf.holdReason')} *</span>
          <select className="input" value={v.reason ?? ''} onChange={(e) => set('reason', e.target.value)}>
            <option value="">{t('common.select')}</option>
            {HOLD.map((r) => <option key={r} value={r}>{t(`hold.${r}` as MessageKey)}</option>)}
          </select>
        </label>
      )}
      {has('level') && (
        <label className="block"><span className="label">{t('wf.escalateTo')}</span>
          <select className="input" value={v.level ?? ''} onChange={(e) => set('level', e.target.value)}>
            <option value="">{t('wf.nextLevel')}</option>
            {[1, 2, 3, 4].map((l) => <option key={l} value={l}>{l} — {t(`esc.${l}` as MessageKey)}</option>)}
          </select>
        </label>
      )}
      {has('supervisor') && (
        <label className="block">
          <span className="label">{t('wf.supervisor')} ({t('common.optional')})</span>
          <select className="input" value={v.supervisorId ?? ''} onChange={(e) => set('supervisorId', e.target.value)}>
            <option value="">—</option>
            {supervisors.map((u) => <option key={u.id} value={u.id}>{u.full_name} — {roleLabel(u)}</option>)}
          </select>
        </label>
      )}

      {(has('assignee') || has('inspector')) && (
        <label className="block">
          <span className="label">{has('inspector') ? t('office.inspector') : t('office.assignTo')}</span>
          <select className="input" value={v[has('inspector') ? 'inspectorId' : 'assigneeId'] ?? ''} onChange={(e) => set(has('inspector') ? 'inspectorId' : 'assigneeId', e.target.value)}>
            <option value="">{t('office.selectUser')}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} — {roleLabel(u)}{u.designation ? ` (${u.designation})` : ''}</option>)}
          </select>
        </label>
      )}
      {has('user') && (
        <label className="block">
          <span className="label">{t('office.selectUser')}</span>
          <select className="input" value={v.userId ?? ''} onChange={(e) => set('userId', e.target.value)}>
            <option value="">{t('office.selectUser')}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} — {roleLabel(u)}</option>)}
          </select>
        </label>
      )}
      {has('supporters') && users.length > 1 && (
        <fieldset className="rounded-lg border border-slate-200 bg-white p-2">
          <legend className="px-1 text-xs font-bold text-slate-600">{t('office.supportingAssignees')} ({t('common.optional')})</legend>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {users.filter((u) => u.id !== v.assigneeId).map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={support.has(u.id)}
                onChange={(e) => setSupport((s0) => { const n = new Set(s0); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} />{u.full_name} <span className="text-xs text-slate-500">{roleLabel(u)}</span></label>
            ))}
          </div>
        </fieldset>
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
      {(has('note') || has('noteRequired')) && (
        <label className="block"><span className="label">{has('noteRequired') ? `${t('admin.reason')} *` : `${t('office.note')} (${t('common.optional')})`}</span>
          <textarea className="input min-h-16" value={v.note ?? ''} onChange={(e) => set('note', e.target.value)} maxLength={1000} />
        </label>
      )}
      {(has('photo') || needsPhoto || has('method')) && (
        <div>
          <span className="label">{needsPhoto ? t('office.photoRequired') : `${t('report.uploadPhoto')} (${t('common.optional')})`} · {photos.length}/{MAX_PHOTOS}</span>
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((p, i) => (
              <span key={p.url} className="relative">
                <img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <button type="button" aria-label={t('common.remove')} className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
            {photos.length < MAX_PHOTOS && <button type="button" className="btn btn-outline min-h-12" onClick={() => fileRef.current?.click()}>📷 {t('report.takePhoto')}</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={async (e) => {
            const fs = [...(e.target.files ?? [])].slice(0, MAX_PHOTOS - photos.length);
            e.target.value = '';
            for (const f of fs) {
              try { const c = await compressImage(f); setPhotos((ps) => (ps.length < MAX_PHOTOS ? [...ps, { file: c.file, url: c.url }] : ps)); } catch { setError(t('err.fileType')); }
            }
            if (fs.length && !geo) void captureGps();
          }} />
        </div>
      )}
      {(has('gps') || needsGps) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="btn btn-outline btn-sm" onClick={captureGps} disabled={geoBusy}>{geoBusy ? <Spinner className="h-4 w-4" /> : '📍'} {t('office.captureGps')}</button>
          {geo && <span className="text-leaf-700">✓ {t('office.gpsOk')} ({geo.latitude.toFixed(5)}, {geo.longitude.toFixed(5)} ±{geo.accuracy}m)</span>}
        </div>
      )}
      {has('submitToggle') && (
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} /> {t('wf.submitForVerification')}</label>
      )}
      {has('closeToggle') && (
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} /> {t('office.closeAfterVerify')}</label>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-outline min-h-12 flex-1" onClick={() => setOpen(false)}>{t('office.cancel')}</button>
        <button type="button" className={`btn ${tone} min-h-12 flex-1`} disabled={busy} onClick={submit}>{busy && <Spinner className="h-4 w-4" />}{t('office.confirm')}</button>
      </div>
    </div>
  );
}
