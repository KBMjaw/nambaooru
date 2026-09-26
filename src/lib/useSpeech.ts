'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal typings for the Web Speech API (not in TS DOM lib everywhere) */
interface SRAlt { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlt; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
}

/**
 * Browser speech-to-text (Chrome/Edge/Android/Safari). Tamil via 'ta-IN' handles natural spoken
 * Tamil and code-mixed English words. The transcript is then understood by our NLP engine.
 */
export function useSpeech(lang: string) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SR | null>(null);
  const finalRef = useRef('');

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const start = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { setError('unsupported'); return; }
    setError(null);
    finalRef.current = '';
    setFinalText('');
    setInterim('');
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current = `${finalRef.current} ${res[0].transcript}`.trim();
        else inter += res[0].transcript;
      }
      setFinalText(finalRef.current);
      setInterim(inter);
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error);
    r.onend = () => { setListening(false); setInterim(''); };
    rec.current = r;
    r.start();
    setListening(true);
  }, [lang]);

  const stop = useCallback(() => { rec.current?.stop(); }, []);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported, listening, interim, finalText, error, start, stop, reset: () => { finalRef.current = ''; setFinalText(''); setInterim(''); } };
}
