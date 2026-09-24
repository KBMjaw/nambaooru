'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useI18n } from '@/i18n/client';
import { LANGS } from '@/i18n';

/** Persistent language switcher: [ E | த ] */
export function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  async function choose(code: string) {
    if (code === lang) return;
    await fetch('/api/lang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: code }) });
    start(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={t('lang.switch')}
      className={`inline-flex shrink-0 items-center rounded-full border p-0.5 text-sm font-bold ${dark ? 'border-white/30 bg-white/10' : 'border-slate-300 bg-white'} ${pending ? 'opacity-60' : ''}`}
    >
      {LANGS.map((l, i) => (
        <span key={l.code} className="flex items-center">
          {i > 0 && <span className={`px-0.5 ${dark ? 'text-white/40' : 'text-slate-300'}`}>|</span>}
          <button
            type="button"
            onClick={() => choose(l.code)}
            aria-pressed={lang === l.code}
            title={l.native}
            lang={l.code}
            className={`min-w-9 rounded-full px-2.5 py-1 transition ${
              lang === l.code
                ? dark ? 'bg-white text-navy-800' : 'bg-navy-700 text-white'
                : dark ? 'text-white hover:bg-white/15' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {l.short}
          </button>
        </span>
      ))}
    </div>
  );
}
