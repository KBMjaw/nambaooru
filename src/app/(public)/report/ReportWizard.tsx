'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useI18n } from '@/i18n/client';
import { pick, trMsg, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/client-api';
import { compressImage, getLocation, type Geo } from '@/lib/image';
import { useSpeech } from '@/lib/useSpeech';
import { Alert, Spinner } from '@/components/ui';
import { StatusBadge, PriorityBadge } from '@/components/badges';
import { fmtDateTime } from '@/lib/format';

const MapView = dynamic(() => import('@/components/MapView').then((m) => m.MapView), { ssr: false, loading: () => <div className="h-56 animate-pulse rounded-xl bg-slate-100" /> });

export interface Category { code: string; name_en: string; name_ta: string; icon: string; evidence_required: boolean; evidence_types: string[] }
export interface Me {
  localBodyId: number | null; wardId: number | null; wardNumber: number | null; streetId: number | null;
  street_en: string | null; street_ta: string | null; streetText: string | null; lb_en: string | null; lb_ta: string | null;
}
interface Opt { id: number; name_en: string; name_ta: string | null; ward_number?: number }
interface Analysis {
  language: string; category: string; confidence: number; alternatives: { code: string; score: number }[];
  confirm_en: string; confirm_ta: string; title_en: string; title_ta: string; summary_en: string; summary_ta: string;
  location: { localBodyId: number | null; wardNumber: number | null; wardId: number | null; streetId: number | null; streetName: string | null; streetNameTa: string | null; streetText: string | null; ownStreet: boolean };
  duration: { days: number; en: string; ta: string } | null;
  safety: { risk: boolean; cues_en: string[]; cues_ta: string[]; critical: boolean };
  severity: string; missing: string[]; engine: string;
}
interface Dup { id: number; code: string; status: string; updatedAt: string; street: string | null; streetTa: string | null; wardNumber: number | null; distanceM: number | null; supporters: number; summaryEn: string; summaryTa: string }
interface Evidence { file: File; url: string; hash: string | null; media: 'PHOTO' | 'VIDEO'; source: 'CAMERA' | 'UPLOAD'; capturedAt: string }
type Phase = 'describe' | 'analyzing' | 'confirm' | 'evidence' | 'checking' | 'duplicates' | 'submitting' | 'done';
interface Msg { from: 'bot' | 'user'; text: string }

export function ReportWizard({ me, categories, localBodies }: { me: Me; categories: Category[]; localBodies: Opt[] }) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>('describe');
  const [chat, setChat] = useState<Msg[]>([{ from: 'bot', text: t('report.greeting') }]);
  const [text, setText] = useState('');
  const [inputMode, setInputMode] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [speechLang, setSpeechLang] = useState(lang === 'en' ? 'en-IN' : 'ta-IN');
  const speech = useSpeech(speechLang);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [dept, setDept] = useState<{ name_en: string; name_ta: string } | null>(null);
  const [categoryCode, setCategoryCode] = useState<string>('');
  const [lbId, setLbId] = useState<number | null>(me.localBodyId);
  const [wardId, setWardId] = useState<number | null>(null);
  const [streetId, setStreetId] = useState<number | null>(null);
  const [streetText, setStreetText] = useState('');
  const [landmark, setLandmark] = useState('');
  const [showLoc, setShowLoc] = useState(false);
  const [showCat, setShowCat] = useState(false);
  const [wards, setWards] = useState<Opt[]>([]);
  const [streets, setStreets] = useState<Opt[]>([]);

  const [geo, setGeo] = useState<Geo | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'asking' | 'ok' | 'denied'>('idle');
  const [locConfirmed, setLocConfirmed] = useState(false);
  const [files, setFiles] = useState<Evidence[]>([]);
  const [dups, setDups] = useState<Dup[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const upRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const cat = categories.find((c) => c.code === categoryCode);
  const L = (en: string | null | undefined, ta: string | null | undefined) => (lang === 'ta' ? ta || en : en || ta) ?? '';

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat, phase]);

  // Load wards/streets for location selection
  useEffect(() => {
    setWards([]);
    if (!lbId) return;
    api<{ items: Opt[] }>(`/api/locations?type=wards&parent=${lbId}`).then((r) => setWards(r.items)).catch(() => {});
  }, [lbId]);
  useEffect(() => {
    setStreets([]);
    if (!wardId) return;
    api<{ items: Opt[] }>(`/api/locations?type=streets&parent=${wardId}`).then((r) => setStreets(r.items)).catch(() => {});
  }, [wardId]);

  // Voice: when recognition ends with text, send it for understanding
  const wasListening = useRef(false);
  useEffect(() => {
    if (speech.listening) { wasListening.current = true; return; }
    if (wasListening.current) {
      wasListening.current = false;
      const said = speech.finalText.trim();
      if (said.length >= 3) { setText(said); setInputMode('VOICE'); void analyzeText(said, 'VOICE'); }
    }
  }, [speech.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  async function analyzeText(input: string, mode: 'TEXT' | 'VOICE') {
    const value = input.trim();
    if (value.length < 3) { setError(t('err.textShort')); return; }
    setError(null);
    setChat((c) => [...c, { from: 'user', text: (mode === 'VOICE' ? '🎙️ ' : '') + value }]);
    setPhase('analyzing');
    try {
      const r = await api<{ analysis: Analysis; category: { code: string } | null; department: { name_en: string; name_ta: string } | null }>('/api/nlp/analyze', { body: { text: value } });
      const a = r.analysis;
      setAnalysis(a);
      setDept(r.department);
      setCategoryCode(a.category);
      setShowCat(a.missing.includes('category'));
      // Location: prefer what the citizen said; fall back to registered address when they said "my street"
      const said = a.location;
      const lb = said.localBodyId ?? me.localBodyId;
      setLbId(lb);
      if (said.wardId || said.streetId) {
        setWardId(said.wardId);
        setStreetId(said.streetId);
        setStreetText(said.streetId ? '' : said.streetText ?? '');
      } else if (lb === me.localBodyId && (said.ownStreet || !said.streetText)) {
        setWardId(me.wardId);
        setStreetId(me.streetId);
        setStreetText(me.streetId ? '' : me.streetText ?? '');
      } else {
        setWardId(null); setStreetId(null); setStreetText(said.streetText ?? '');
      }
      setShowLoc(!lb || a.missing.includes('location') && !me.wardId);
      setChat((c) => [...c, { from: 'bot', text: `${t('report.understood')}\n${lang === 'ta' ? a.title_ta : a.title_en}${a.duration ? ` (${lang === 'ta' ? a.duration.ta : a.duration.en})` : ''}\n${t('report.isCorrect')} ⬇️` }]);
      setPhase('confirm');
    } catch (e) {
      setError(trMsg(t, (e as Error).message));
      setPhase('describe');
    }
  }

  const wardNo = wards.find((w) => w.id === wardId)?.ward_number ?? analysis?.location.wardNumber ?? null;
  const street = streets.find((s) => s.id === streetId);
  const lb = localBodies.find((b) => b.id === lbId);
  const placeLabel = [street ? L(street.name_en, street.name_ta) : streetText || null, wardNo != null ? `${t('complaint.ward')} ${wardNo}` : null, lb ? L(lb.name_en, lb.name_ta) : null].filter(Boolean).join(', ');

  const confirmSentence = useMemo(() => {
    if (!analysis) return '';
    const c = categories.find((x) => x.code === categoryCode);
    const changed = c && c.code !== analysis.category;
    const what = changed ? L(c.name_en, c.name_ta) : lang === 'ta' ? analysis.title_ta : analysis.title_en;
    if (!placeLabel) return `${what}.`;
    return lang === 'ta' ? `${placeLabel} பகுதியில் ${what}.` : `${what} in ${placeLabel}.`;
  }, [analysis, categoryCode, lang, placeLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  function useRegistered() {
    setLbId(me.localBodyId); setWardId(me.wardId); setStreetId(me.streetId); setStreetText(me.streetId ? '' : me.streetText ?? '');
  }

  async function askLocation() {
    setGeoState('asking');
    try {
      const g = await getLocation();
      setGeo(g); setGeoState('ok');
    } catch {
      setGeoState('denied');
    }
  }

  async function addFiles(list: FileList | null, source: 'CAMERA' | 'UPLOAD', media: 'PHOTO' | 'VIDEO') {
    if (!list) return;
    setError(null);
    for (const f of Array.from(list).slice(0, 4 - files.length)) {
      if (media === 'PHOTO') {
        if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) { setError(t('err.fileType')); continue; }
        try {
          const c = await compressImage(f);
          setFiles((x) => [...x, { file: c.file, url: c.url, hash: c.hash, media, source, capturedAt: source === 'CAMERA' ? new Date().toISOString() : new Date(f.lastModified || Date.now()).toISOString() }]);
        } catch { setError(t('err.fileType')); }
      } else {
        if (!/^video\/(mp4|webm|quicktime)$/.test(f.type)) { setError(t('err.fileType')); continue; }
        if (f.size > 4 * 1024 * 1024) { setError(`${t('err.fileSize')} (max 4 MB)`); continue; }
        setFiles((x) => [...x, { file: f, url: URL.createObjectURL(f), hash: null, media, source, capturedAt: new Date(f.lastModified || Date.now()).toISOString() }]);
      }
    }
    if (source === 'CAMERA' && geoState === 'idle') void askLocation();
  }

  async function toDuplicates() {
    setError(null);
    if (cat?.evidence_required && files.length === 0) { setError(t('report.photoNeeded')); return; }
    if (!lbId) { setShowLoc(true); setPhase('confirm'); setError(t('report.whereQuestion')); return; }
    setPhase('checking');
    try {
      const r = await api<{ candidates: Dup[] }>('/api/complaints/duplicates', {
        body: {
          categoryCode, localBodyId: lbId, wardId, streetId, latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null,
          text, imageHash: files.find((f) => f.hash)?.hash ?? null,
        },
      });
      if (r.candidates.length) { setDups(r.candidates); setPhase('duplicates'); }
      else await submit(false, null);
    } catch (e) {
      setError(trMsg(t, (e as Error).message));
      setPhase('evidence');
    }
  }

  async function support(code: string) {
    setPhase('submitting');
    try {
      const r = await api<{ redirect: string }>(`/api/complaints/${code}/support`, { method: 'POST', body: {} });
      window.location.href = r.redirect;
    } catch (e) { setError(trMsg(t, (e as Error).message)); setPhase('duplicates'); }
  }

  async function submit(override: boolean, dupOf: number | null) {
    setPhase('submitting');
    setError(null);
    const fd = new FormData();
    fd.set('payload', JSON.stringify({
      text, inputMode, categoryCode, localBodyId: lbId, wardId, streetId, streetText: streetId ? null : streetText || null,
      landmark: landmark || null, latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null, accuracy: geo?.accuracy ?? null,
      gpsAt: geo?.at ?? null, duplicateOverride: override, possibleDuplicateOf: dupOf,
    }));
    fd.set('evidenceMeta', JSON.stringify(files.map((f) => ({
      latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null, accuracy: geo?.accuracy ?? null, capturedAt: f.capturedAt, source: f.source, imageHash: f.hash,
    }))));
    for (const f of files) fd.append('evidence', f.file);
    try {
      const r = await api<{ code: string }>('/api/complaints', { form: fd });
      setResult(r.code);
      setPhase('done');
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 429 ? t('err.rateLimited') : trMsg(t, err.message));
      setPhase('evidence');
    }
  }

  function restartVoice() {
    setAnalysis(null); setText(''); speech.reset(); setPhase('describe');
    setChat((c) => [...c, { from: 'bot', text: t('report.greeting') }]);
    speech.start();
  }

  const steps: [Phase[], MessageKey][] = [
    [['describe', 'analyzing'], 'report.step.describe'],
    [['confirm'], 'report.step.confirm'],
    [['evidence', 'checking', 'duplicates'], 'report.step.evidence'],
    [['submitting', 'done'], 'report.step.submit'],
  ];
  const stepIdx = steps.findIndex(([ps]) => ps.includes(phase));

  if (phase === 'done' && result) {
    return (
      <div className="card mx-auto max-w-lg p-6 text-center">
        <div className="text-6xl">✅</div>
        <h2 className="mt-3 text-xl font-extrabold text-leaf-700">{t('report.success')}</h2>
        <p className="mt-2 text-slate-600">{t('report.successId')}</p>
        <p className="mt-1 font-mono text-2xl font-extrabold text-navy-800">{result}</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href={`/complaints/${result}`} className="btn btn-primary btn-lg">{t('report.viewComplaint')}</Link>
          <button className="btn btn-outline" onClick={() => window.location.reload()}>{t('report.newComplaint')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ol className="grid grid-cols-4 gap-1.5" aria-label="progress">
        {steps.map(([, k], i) => (
          <li key={k} className={`rounded-full py-1 text-center text-[11px] font-bold sm:text-xs ${i === stepIdx ? 'bg-navy-700 text-white' : i < stepIdx ? 'bg-leaf-100 text-leaf-800' : 'bg-slate-100 text-slate-400'}`}>{t(k)}</li>
        ))}
      </ol>

      {/* Conversation */}
      <div className="card space-y-3 p-4" aria-live="polite">
        {chat.map((m, i) => (
          <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-[15px] ${m.from === 'user' ? 'rounded-br-md bg-navy-700 text-white' : 'rounded-bl-md bg-leaf-50 text-slate-800'}`}>
              {m.from === 'bot' && <span className="mr-1" aria-hidden>🤖</span>}{m.text}
            </div>
          </div>
        ))}
        {phase === 'analyzing' && <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> {t('report.understanding')}</div>}
        <div ref={chatEnd} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {/* Step 1 — describe (voice-first) */}
      {(phase === 'describe' || phase === 'analyzing') && (
        <div className="card space-y-4 p-4">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              disabled={!speech.supported || phase === 'analyzing'}
              className={`relative flex h-24 w-24 items-center justify-center rounded-full text-4xl text-white shadow-lg transition ${speech.listening ? 'mic-pulse bg-pin-600' : 'bg-pin-500 hover:bg-pin-600'} disabled:opacity-40`}
              aria-label={speech.listening ? t('report.stop') : t('report.speak')}
            >
              <span className="relative">{speech.listening ? '⏹' : '🎙️'}</span>
            </button>
            <span className="text-sm font-bold text-slate-700">{speech.listening ? t('report.listening') : t('report.speak')}</span>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {t('report.langHint')}:
              {[['ta-IN', 'தமிழ்'], ['en-IN', 'English']].map(([code, label]) => (
                <button key={code} type="button" onClick={() => setSpeechLang(code)} className={`rounded-full px-2 py-0.5 font-bold ${speechLang === code ? 'bg-navy-700 text-white' : 'bg-slate-100'}`}>{label}</button>
              ))}
            </div>
            {(speech.interim || (speech.listening && speech.finalText)) && (
              <p className="w-full rounded-xl bg-slate-50 p-3 text-slate-700">{speech.finalText} <span className="text-slate-400">{speech.interim}</span></p>
            )}
            {!speech.supported && <p className="text-center text-xs text-slate-500">{t('report.voiceUnsupported')}</p>}
            {speech.error === 'denied' && <p className="text-center text-xs text-red-600">{t('report.voiceDenied')}</p>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); setInputMode('TEXT'); void analyzeText(text, 'TEXT'); }} className="flex items-end gap-2">
            <textarea
              className="input min-h-14 flex-1 resize-y"
              rows={2}
              value={text}
              maxLength={4000}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('report.placeholder')}
              aria-label={t('report.intro')}
            />
            <button className="btn btn-navy h-14" disabled={phase === 'analyzing' || text.trim().length < 3}>{t('report.send')}</button>
          </form>
        </div>
      )}

      {/* Step 2 — confirm the interpretation */}
      {phase === 'confirm' && analysis && (
        <div className="card space-y-4 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-500">{t('report.understood')}</p>
            <p className="mt-1 text-lg font-extrabold text-navy-800">{confirmSentence}</p>
          </div>
          <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            <div className="flex items-center justify-between gap-3 p-3">
              <dt className="text-slate-500">{t('report.category')}</dt>
              <dd className="flex items-center gap-2 text-right font-semibold">
                {cat ? <>{cat.icon} {L(cat.name_en, cat.name_ta)}</> : '—'}
                <button type="button" className="text-xs text-navy-600 underline" onClick={() => setShowCat((s) => !s)}>{t('common.edit')}</button>
              </dd>
            </div>
            {showCat && (
              <div className="p-3">
                {analysis.missing.includes('category') && <p className="mb-2 text-sm text-amber-700">{t('report.pickCategory')}</p>}
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <button key={c.code} type="button" onClick={() => { setCategoryCode(c.code); setShowCat(false); }}
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${categoryCode === c.code ? 'border-leaf-600 bg-leaf-50 text-leaf-800' : 'border-slate-300 bg-white'}`}>
                      {c.icon} {L(c.name_en, c.name_ta)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 p-3">
              <dt className="text-slate-500">{t('report.location')}</dt>
              <dd className="flex items-center gap-2 text-right font-semibold">
                <span>📍 {placeLabel || '—'}</span>
                <button type="button" className="text-xs text-navy-600 underline" onClick={() => setShowLoc((s) => !s)}>{t('common.edit')}</button>
              </dd>
            </div>
            {showLoc && (
              <div className="space-y-2 p-3">
                <p className="text-sm font-semibold">{t('report.whereQuestion')}</p>
                {me.localBodyId && <button type="button" className="btn btn-outline btn-sm" onClick={useRegistered}>🏠 {t('report.useRegistered')}</button>}
                <select className="input" value={lbId ?? ''} onChange={(e) => { setLbId(Number(e.target.value) || null); setWardId(null); setStreetId(null); }}>
                  <option value="">{t('reg.localBody')}</option>
                  {localBodies.map((b) => <option key={b.id} value={b.id}>{pick(b as never, 'name', lang)}</option>)}
                </select>
                {wards.length > 0 && (
                  <select className="input" value={wardId ?? ''} onChange={(e) => { setWardId(Number(e.target.value) || null); setStreetId(null); }}>
                    <option value="">{t('report.chooseWard')}</option>
                    {wards.map((w) => <option key={w.id} value={w.id}>{t('complaint.ward')} {w.ward_number}</option>)}
                  </select>
                )}
                {streets.length > 0 && (
                  <select className="input" value={streetId ?? ''} onChange={(e) => setStreetId(Number(e.target.value) || null)}>
                    <option value="">{t('report.chooseStreet')}</option>
                    {streets.map((s) => <option key={s.id} value={s.id}>{pick(s as never, 'name', lang)}</option>)}
                  </select>
                )}
                {!streetId && <input className="input" placeholder={t('reg.streetText')} value={streetText} onChange={(e) => setStreetText(e.target.value)} />}
                <input className="input" placeholder={t('report.landmark')} value={landmark} onChange={(e) => setLandmark(e.target.value)} />
              </div>
            )}
            {analysis.duration && (
              <div className="flex justify-between gap-3 p-3"><dt className="text-slate-500">{t('report.duration')}</dt><dd className="font-semibold">{L(analysis.duration.en, analysis.duration.ta)}</dd></div>
            )}
            <div className="flex justify-between gap-3 p-3"><dt className="text-slate-500">{t('report.severity')}</dt><dd><PriorityBadge priority={analysis.severity} /></dd></div>
            {analysis.safety.risk && (
              <div className="flex justify-between gap-3 p-3"><dt className="text-slate-500">{t('report.safety')}</dt><dd className="text-right font-semibold text-red-700">⚠️ {(lang === 'ta' ? analysis.safety.cues_ta : analysis.safety.cues_en).join(', ')}</dd></div>
            )}
            {dept && categoryCode === analysis.category && (
              <div className="flex justify-between gap-3 p-3"><dt className="text-slate-500">{t('report.department')}</dt><dd className="text-right font-semibold">🏛️ {L(dept.name_en, dept.name_ta)}</dd></div>
            )}
          </dl>
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="text-xs font-semibold text-slate-500">{t('report.yourWords')}</p>
            <p className="mt-1 italic text-slate-700">“{text}”</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" className="btn btn-primary btn-lg sm:col-span-3" disabled={!categoryCode || !lbId}
              onClick={() => { setChat((c) => [...c, { from: 'user', text: `✅ ${t('common.yes')}` }]); setPhase('evidence'); }}>
              ✅ {t('report.yes')}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => { setPhase('describe'); }}>✏️ {t('report.edit')}</button>
            {speech.supported && <button type="button" className="btn btn-outline" onClick={restartVoice}>🎙️ {t('report.speakAgain')}</button>}
          </div>
        </div>
      )}

      {/* Step 3 — evidence + GPS */}
      {(phase === 'evidence' || phase === 'checking' || phase === 'submitting') && (
        <div className="card space-y-4 p-4">
          <h2 className="text-lg font-extrabold text-navy-800">📸 {t('report.evidenceTitle')}</h2>
          <p className={`text-sm ${cat?.evidence_required ? 'font-semibold text-amber-800' : 'text-slate-600'}`}>
            {cat?.evidence_required ? t('report.evidenceRequired') : t('report.evidenceOptional')}
          </p>

          {geoState !== 'ok' && (
            <div className="rounded-xl border border-navy-100 bg-navy-50 p-3 text-sm text-navy-800">
              <p>📍 {t('report.gpsWhy')}</p>
              {geoState === 'denied' ? (
                <p className="mt-2 font-semibold text-amber-800">{t('report.locationDenied')}</p>
              ) : (
                <button type="button" className="btn btn-navy btn-sm mt-2" onClick={askLocation} disabled={geoState === 'asking'}>
                  {geoState === 'asking' ? <><Spinner className="h-4 w-4" /> {t('report.locating')}</> : t('report.allowLocation')}
                </button>
              )}
            </div>
          )}
          {geo && (
            <div className="space-y-2">
              <MapView markers={[{ lat: geo.latitude, lng: geo.longitude, icon: '📍', color: '#e53935', radius: geo.accuracy }]} zoom={17} height={220} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-semibold">📍 {placeLabel || '—'}</span>
                  <span className="ml-2 text-xs text-slate-500">{t('report.accuracy', { m: geo.accuracy })} · {geo.latitude.toFixed(5)}, {geo.longitude.toFixed(5)}</span>
                </span>
                <label className="flex items-center gap-2 font-semibold text-leaf-700">
                  <input type="checkbox" checked={locConfirmed} onChange={(e) => setLocConfirmed(e.target.checked)} /> {t('report.locationConfirmed')}
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button type="button" className="btn btn-primary" onClick={() => camRef.current?.click()} disabled={files.length >= 4}>📷 {t('report.takePhoto')}</button>
            <button type="button" className="btn btn-outline" onClick={() => upRef.current?.click()} disabled={files.length >= 4}>🖼️ {t('report.uploadPhoto')}</button>
            {cat?.evidence_types.includes('video') && (
              <button type="button" className="btn btn-outline col-span-2 sm:col-span-1" onClick={() => vidRef.current?.click()} disabled={files.length >= 4}>🎬 {t('report.uploadVideo')}</button>
            )}
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files, 'CAMERA', 'PHOTO'); e.target.value = ''; }} />
          <input ref={upRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void addFiles(e.target.files, 'UPLOAD', 'PHOTO'); e.target.value = ''; }} />
          <input ref={vidRef} type="file" accept="video/mp4,video/webm" hidden onChange={(e) => { void addFiles(e.target.files, 'UPLOAD', 'VIDEO'); e.target.value = ''; }} />

          {files.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {files.map((f, i) => (
                <div key={f.url} className="relative overflow-hidden rounded-xl border border-slate-200">
                  {f.media === 'PHOTO' ? <img src={f.url} alt="" className="h-28 w-full object-cover" /> : <video src={f.url} className="h-28 w-full object-cover" muted />}
                  <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs font-bold text-white">✕ {t('report.remove')}</button>
                  <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 text-[10px] text-white">{f.source === 'CAMERA' ? '📷' : '🖼️'} {geo ? '📍' : ''}</span>
                </div>
              ))}
            </div>
          )}

          <button type="button" className="btn btn-primary btn-lg w-full" disabled={phase !== 'evidence' || (!!geo && !locConfirmed)} onClick={toDuplicates}>
            {phase === 'checking' ? <><Spinner /> {t('report.checkingDuplicates')}</> : phase === 'submitting' ? <><Spinner /> {t('report.submitting')}</> : `📨 ${t('report.submit')}`}
          </button>
          {geo && !locConfirmed && <p className="text-center text-xs text-slate-500">{t('report.confirmLocation')}</p>}
        </div>
      )}

      {/* Step 3b — possible duplicates */}
      {phase === 'duplicates' && (
        <div className="card space-y-3 border-amber-300 p-4">
          <h2 className="text-lg font-extrabold text-amber-800">⚠️ {t('report.dupTitle')}</h2>
          <p className="text-sm text-slate-600">{t('report.dupText')}</p>
          {dups.map((d) => (
            <div key={d.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold text-navy-700">{d.code}</span>
                <StatusBadge status={d.status} />
              </div>
              <p className="mt-1 text-sm">{lang === 'ta' ? d.summaryTa : d.summaryEn}</p>
              <p className="mt-1 text-xs text-slate-500">
                📍 {[L(d.street, d.streetTa), d.wardNumber != null ? `${t('complaint.ward')} ${d.wardNumber}` : null].filter(Boolean).join(', ')}
                {d.distanceM != null && ` · ${d.distanceM} ${t('common.m')}`} · 🕒 {fmtDateTime(d.updatedAt, lang)}
              </p>
              <button type="button" className="btn btn-navy btn-sm mt-2" onClick={() => support(d.code)}>{t('report.trackExisting')}</button>
            </div>
          ))}
          <button type="button" className="btn btn-outline w-full" onClick={() => submit(true, dups[0]?.id ?? null)}>{t('report.differentIssue')}</button>
        </div>
      )}
      {phase === 'submitting' && dups.length > 0 && <div className="flex justify-center"><Spinner className="h-8 w-8 text-leaf-600" /></div>}
    </div>
  );
}
