'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { trMsg } from '@/i18n';
import { api } from '@/lib/client-api';
import { compressImage } from '@/lib/image';
import { useSpeech } from '@/lib/useSpeech';
import { Alert, Spinner } from '@/components/ui';

export function AppealForm({ code }: { code: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const speech = useSpeech(lang === 'en' ? 'en-IN' : 'ta-IN');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!speech.listening && speech.finalText) { setReason((r) => `${r} ${speech.finalText}`.trim()); setMode('VOICE'); speech.reset(); }
  }, [speech.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.set('reason', reason);
    fd.set('inputMode', mode);
    files.forEach((f) => fd.append('evidence', f));
    try {
      await api(`/api/complaints/${code}/appeal`, { form: fd });
      setMsg({ tone: 'success', text: t('appeal.sent') });
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setMsg({ tone: 'error', text: trMsg(t, (e as Error).message) });
    } finally { setBusy(false); }
  }

  if (!open) return <button className="btn btn-navy w-full" onClick={() => setOpen(true)}>🔁 {t('appeal.request')}</button>;
  return (
    <div className="space-y-3 rounded-xl border border-navy-100 bg-navy-50/50 p-3">
      <h3 className="font-bold text-navy-800">{t('appeal.title')}</h3>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <label className="label" htmlFor="appeal-reason">{t('appeal.why')}</label>
      <textarea id="appeal-reason" className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
      <div className="flex flex-wrap gap-2">
        {speech.supported && (
          <button type="button" className={`btn btn-sm ${speech.listening ? 'btn-danger' : 'btn-outline'}`} onClick={() => (speech.listening ? speech.stop() : speech.start())}>
            🎙️ {speech.listening ? t('report.stop') : t('report.speak')}
          </button>
        )}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>📎 {t('report.uploadPhoto')} / {t('report.uploadVideo')}</button>
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple onChange={async (e) => {
          const list = Array.from(e.target.files ?? []).slice(0, 3);
          const out: File[] = [];
          for (const f of list) out.push(f.type.startsWith('image/') ? (await compressImage(f)).file : f);
          setFiles(out);
        }} />
        {files.length > 0 && <span className="self-center text-xs text-slate-600">📎 {files.length}</span>}
      </div>
      {speech.listening && <p className="text-sm text-slate-500">{t('report.listening')} {speech.interim}</p>}
      <div className="flex gap-2">
        <button className="btn btn-outline flex-1" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
        <button className="btn btn-primary flex-1" disabled={busy || reason.trim().length < 5} onClick={submit}>{busy && <Spinner />}{t('appeal.submit')}</button>
      </div>
    </div>
  );
}
