import en, { type MessageKey, type Messages } from './en';
import ta from './ta';

/** Registered UI languages. Add a new Indian language by adding a message file here + a row in `languages`. */
export const DICTS: Record<string, Messages> = { ta, en };
export const LANGS = [
  { code: 'en', short: 'E', native: 'English', speech: 'en-IN' },
  { code: 'ta', short: 'த', native: 'தமிழ்', speech: 'ta-IN' },
] as const;
export type Lang = 'ta' | 'en';
export const DEFAULT_LANG: Lang = 'ta';
export const LANG_COOKIE = 'nu_lang';

export function isLang(x: unknown): x is Lang {
  return typeof x === 'string' && x in DICTS;
}

export type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function makeT(lang: Lang): TFn {
  const d = DICTS[lang] ?? DICTS[DEFAULT_LANG];
  return (key, vars) => {
    let s: string = d[key] ?? DICTS.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] != null ? String(vars[k]) : ''));
    return s;
  };
}

/** Pick the language-specific column from a bilingual DB row: pick(row, 'name', lang) → row.name_ta ?? row.name_en */
export function pick(row: Record<string, unknown> | null | undefined, base: string, lang: Lang): string {
  if (!row) return '';
  return String((row[`${base}_${lang}`] as string) || (row[`${base}_en`] as string) || '');
}

export type { MessageKey };

/** Translate a server message if it is a known message key, else return it as-is. */
export function trMsg(t: TFn, message: string | undefined | null): string {
  if (!message) return t('common.error');
  return message in DICTS.en ? t(message as MessageKey) : message;
}
