'use client';
import { createContext, useContext, useMemo } from 'react';
import { makeT, type Lang, type TFn } from './index';

const Ctx = createContext<{ lang: Lang; t: TFn }>({ lang: 'ta', t: makeT('ta') });

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
