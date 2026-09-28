'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { compressImage } from '@/lib/image';
import { Alert, Spinner } from '@/components/ui';

/** Reply to "more information needed" (or add details) on the citizen's own open complaint. */
export function AddInfoForm({ code, requested }: { code: string; requested: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(requested);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  async function submit() {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set('text', text);
    files.forEach((f) => fd.append('evidence', f));
    try { await api(`/api/complaints/${code}/info`, { form: fd }); setText(''); setFiles([]); setOpen(false); router.refresh(); }
    catch (e) { setErr(trMsg(t, (e as Error).message)); }
    finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="btn btn-outline w-full" onClick={() => setOpen(true)}>➕ {t('info.add')}</button>;
  return (
    <div className="space-y-2">
      {err && <Alert tone="error">{err}</Alert>}
      <label className="label" htmlFor="info-text">{t('info.yourReply')}</label>
      <textarea id="info-text" className="input min-h-24" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>📷 {t('report.uploadPhoto')}</button>
        {files.length > 0 && <span className="text-xs text-slate-600">📎 {files.length}</span>}
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" multiple onChange={async (e) => {
          const out: File[] = [];
          for (const f of Array.from(e.target.files ?? []).slice(0, 3)) out.push((await compressImage(f)).file);
          setFiles(out);
        }} />
      </div>
      <button type="button" className="btn btn-primary w-full" disabled={busy || text.trim().length < 3} onClick={submit}>{busy && <Spinner className="h-4 w-4" />}{t('info.send')}</button>
    </div>
  );
}

/** Rate how a finished complaint was handled. */
export function FeedbackForm({ code, current }: { code: string; current: { rating: number; comment: string | null } | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [rating, setRating] = useState(current?.rating ?? 0);
  const [comment, setComment] = useState(current?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  async function submit() {
    setBusy(true); setMsg(null);
    try { await api(`/api/complaints/${code}/feedback`, { body: { rating, comment: comment.trim() || undefined } }); setMsg({ tone: 'success', text: t('fb.thanks') }); router.refresh(); }
    catch (e) { setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) }); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex gap-1" role="radiogroup" aria-label={t('fb.rate')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n}/5`} onClick={() => setRating(n)}
            className={`h-12 w-12 rounded-xl text-2xl ${n <= rating ? 'bg-amber-100 text-amber-500' : 'bg-slate-100 text-slate-300'}`}>★</button>
        ))}
      </div>
      <textarea className="input min-h-16" placeholder={t('fb.comment')} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      <button type="button" className="btn btn-primary w-full" disabled={busy || !rating} onClick={submit}>{busy && <Spinner className="h-4 w-4" />}{current ? t('fb.update') : t('fb.submit')}</button>
    </div>
  );
}
