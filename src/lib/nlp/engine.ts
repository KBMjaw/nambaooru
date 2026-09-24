/**
 * Namma Ooru complaint-understanding engine.
 *
 * Deterministic, dependency-free NLP for Tamil, colloquial/spoken Tamil, Tanglish
 * (Tamil typed in English letters), English and mixed sentences. It:
 *   1. normalises the text,
 *   2. extracts location (local body, ward, street) using the location master data,
 *   3. classifies the civic issue category with fuzzy, suffix-tolerant keyword matching,
 *   4. extracts duration, safety/urgency cues and severity,
 *   5. produces a bilingual (Tamil + English) structured interpretation.
 *
 * The result is a *suggestion*: the citizen confirms it, and officials make every decision.
 * An optional LLM pass (see llm.ts) can refine it when configured.
 */
import {
  LEXICON, NUMBER_WORDS, SAFETY_CUES, STOPWORDS, STREET_TYPES_EN, STREET_TYPES_TA, TANGLISH_MARKERS,
  type CategoryCode,
} from './lexicon.ts';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
const LEVELS: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export interface CategoryInfo {
  code: string;
  name_en: string;
  name_ta: string;
  default_department: string;
  evidence_required: boolean;
  evidence_types: string[];
  default_priority: Priority;
  keywords?: string[];
}
export interface StreetInfo { id: number; ward_id: number; ward_number: number; local_body_id: number; name_en: string; name_ta: string | null }
export interface LocalBodyInfo { id: number; name_en: string; name_ta: string | null }

export interface NlpContext {
  categories: CategoryInfo[];
  streets: StreetInfo[];
  localBodies: LocalBodyInfo[];
}

export interface Analysis {
  language: 'ta' | 'en' | 'tanglish' | 'mixed';
  category: string;
  confidence: number;
  alternatives: { code: string; score: number }[];
  matchedTerms: string[];
  title_en: string;
  title_ta: string;
  summary_en: string;
  summary_ta: string;
  confirm_en: string;
  confirm_ta: string;
  location: {
    localBodyId: number | null;
    localBodyName: string | null;
    wardNumber: number | null;
    wardId: number | null;
    streetId: number | null;
    streetName: string | null;
    streetNameTa: string | null;
    streetText: string | null;
    ownStreet: boolean;
  };
  duration: { days: number; en: string; ta: string } | null;
  safety: { risk: boolean; score: number; cues_en: string[]; cues_ta: string[]; critical: boolean };
  severity: Priority;
  evidence: { required: boolean; types: string[] };
  department: string;
  missing: ('category' | 'location')[];
  engine: 'rules' | 'llm+rules';
}

// ---------------------------------------------------------------------------
// Normalisation & matching primitives
// ---------------------------------------------------------------------------

const TAMIL_RE = /[஀-௿]/;
const TAMIL_RE_G = /[஀-௿]/g;

export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1$2 ')
    .replace(/[“”"'`’‘!?;:,()[\]{}<>|/\\_*#~^=+]/g, ' ')
    .replace(/(?<!\d)\.(?!\d)/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(norm: string): string[] {
  return norm.split(' ').filter(Boolean);
}

export function levenshtein(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** Token-level fuzzy match tolerant of Tanglish suffixes ("streetla", "lightu") and small typos. */
export function tokenMatches(token: string, term: string): boolean {
  if (token === term) return true;
  if (term.length >= 4 && token.startsWith(term) && token.length - term.length <= 4) return true;
  if (term.length >= 5 && token[0] === term[0]) {
    const tol = term.length >= 8 ? 2 : 1;
    // compare against the token trimmed to roughly the term's length (handles suffixes + typos)
    if (levenshtein(token, term, tol) <= tol) return true;
    if (token.length > term.length && levenshtein(token.slice(0, term.length), term, tol) <= tol && token.length - term.length <= 3) return true;
  }
  return false;
}

export function termMatches(norm: string, tokens: string[], term: string): boolean {
  const t = term.toLowerCase();
  if (TAMIL_RE.test(t)) {
    return norm.includes(t) || (t.includes(' ') && norm.replace(/ /g, '').includes(t.replace(/ /g, '')));
  }
  if (t.includes(' ')) {
    const parts = t.split(' ');
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      let ok = true;
      for (let k = 0; k < parts.length; k++) {
        const last = k === parts.length - 1;
        const tok = tokens[i + k];
        if (!(tok === parts[k] || (last ? tokenMatches(tok, parts[k]) : parts[k].length >= 5 && tokenMatches(tok, parts[k])))) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    // joined form, e.g. "streetlight"
    return tokens.some((tok) => tokenMatches(tok, t.replace(/ /g, '')));
  }
  return tokens.some((tok) => tokenMatches(tok, t));
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

export function detectLanguage(text: string): Analysis['language'] {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters.length) return 'en';
  const tamil = (text.match(TAMIL_RE_G) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (tamil && latin) return tamil / (tamil + latin) > 0.85 ? 'ta' : 'mixed';
  if (tamil) return 'ta';
  const toks = tokenize(normalize(text));
  const hits = toks.filter((t) => TANGLISH_MARKERS.includes(t)).length;
  return hits >= 1 && hits / Math.max(toks.length, 1) >= 0.08 ? 'tanglish' : 'en';
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function parseNumberToken(tok: string): number | null {
  const m = tok.match(/^(\d{1,3})(st|nd|rd|th|வது|ஆவது|aavathu|avathu|vathu|vadhu|am|aam)?$/);
  if (m) return parseInt(m[1], 10);
  if (NUMBER_WORDS[tok] != null) return NUMBER_WORDS[tok];
  // ordinal stems: "pathavadhu", "பத்தாவது", "rendavathu"
  const stripped = tok.replace(/(aavathu|aavadhu|avathu|avadhu|vathu|vadhu|ஆவது|வது|வதாக)$/, '');
  if (stripped !== tok) {
    if (NUMBER_WORDS[stripped] != null) return NUMBER_WORDS[stripped];
    for (const [w, n] of Object.entries(NUMBER_WORDS)) if (w.length >= 3 && stripped.startsWith(w.slice(0, -1)) && stripped.length <= w.length + 1) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Location extraction
// ---------------------------------------------------------------------------

const WARD_WORDS = ['ward', 'wardu', 'vard', 'vaardu', 'வார்டு', 'வார்ட்', 'வார்டில்', 'வார்டுல', 'வார்டு'];

export function extractWard(tokens: string[]): number | null {
  for (let i = 0; i < tokens.length; i++) {
    const isWard = WARD_WORDS.some((w) => tokens[i] === w || tokens[i].startsWith(w) || (w.length >= 4 && tokens[i].startsWith('வார்ட')));
    if (!isWard) continue;
    // "ward 10", "ward no 10", "வார்டு எண் 10"
    for (let k = i + 1; k <= Math.min(i + 3, tokens.length - 1); k++) {
      if (['no', 'number', 'num', 'எண்', 'en', 'nos'].includes(tokens[k])) continue;
      const n = parseNumberToken(tokens[k]);
      if (n != null && n > 0 && n < 400) return n;
      break;
    }
    // "10th ward", "pathavadhu ward", "10வது வார்டு"
    if (i > 0) {
      const n = parseNumberToken(tokens[i - 1]);
      if (n != null && n > 0 && n < 400) return n;
    }
  }
  // "10வார்டு" glued
  for (const t of tokens) {
    const m = t.match(/^(\d{1,3})(?:வது)?வார்டு/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

const GENERIC_STREET_TOKENS = new Set([...STREET_TYPES_EN, 'main', '1st', '2nd', '3rd', 'new', 'old', 'east', 'west', 'north', 'south', 'extn']);
const TAMIL_OWN = ['எங்க', 'எங்கள்', 'எங்களோட', 'நம்ம', 'என்', 'என்னோட', 'இந்த', 'அந்த', 'எங்கள'];

function streetNumber(name: string): number | null {
  for (const t of tokenize(normalize(name))) {
    const n = parseNumberToken(t);
    if (n != null && /\d|வது/.test(t)) return n;
  }
  return null;
}

function textNumbers(tokens: string[]): Set<number> {
  const out = new Set<number>();
  for (const t of tokens) {
    const n = parseNumberToken(t);
    if (n != null) out.add(n);
    const g = t.match(/^(\d{1,2})(?:வது|ஆவது)?(?:தெரு|வீதி)/);
    if (g) out.add(parseInt(g[1], 10));
  }
  return out;
}

export function matchKnownStreet(norm: string, tokens: string[], streets: StreetInfo[], wardHint: number | null) {
  const nums = textNumbers(tokens);
  let best: { s: StreetInfo; score: number } | null = null;
  for (const s of streets) {
    let score = 0;
    let ok = false;
    // English / Tanglish name
    const enToks = tokenize(normalize(s.name_en));
    const distinctive = enToks.filter((t) => !GENERIC_STREET_TOKENS.has(t) && parseNumberToken(t) == null);
    if (distinctive.length && distinctive.every((d) => tokens.some((tok) => tokenMatches(tok, d)))) {
      ok = true;
      score += distinctive.length * 2;
      const needsMain = enToks.includes('main');
      if (needsMain) score += tokens.includes('main') ? 1 : -1.5;
    }
    // Tamil name
    if (!ok && s.name_ta) {
      const taToks = tokenize(normalize(s.name_ta)).filter((t) => !STREET_TYPES_TA.some((x) => t.startsWith(x)) && !/^\d/.test(t) && !/^(மெயின்|முதல்)$/.test(t));
      if (taToks.length && taToks.every((d) => norm.includes(d.slice(0, Math.max(3, d.length - 1))))) {
        ok = true;
        score += taToks.length * 2;
      }
    }
    if (!ok) continue;
    const n = streetNumber(s.name_en);
    if (n != null) {
      if (nums.has(n)) score += 2;
      else if ([...nums].some((x) => x <= 12)) continue; // a different street number was mentioned
      else score -= 0.5;
    }
    if (wardHint != null) score += s.ward_number === wardHint ? 1 : -1;
    if (!best || score > best.score) best = { s, score };
  }
  return best && best.score > 0 ? best.s : null;
}

function titleCase(s: string) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_m, d, o) => d + o.toLowerCase());
}

/** Free-text street phrase when the street is not in the master data. */
export function extractStreetText(tokens: string[]): { text: string | null; own: boolean } {
  // Latin: up to 3 words before a street-type word
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const type = STREET_TYPES_EN.find((ty) => !ty.includes(' ') && (tok === ty || (ty.length >= 4 && tok.startsWith(ty) && tok.length - ty.length <= 3)));
    if (!type || ['st', 'rd'].includes(type) && tok !== type) continue;
    if (['light', 'lights'].includes(tokens[i + 1] ?? '') || ['dog', 'dogs', 'lamp'].includes(tokens[i + 1] ?? '')) continue; // "street light", "street dog"
    const before: string[] = [];
    for (let k = i - 1; k >= 0 && before.length < 3; k--) {
      const w = tokens[k];
      if (STOPWORDS.has(w) || TAMIL_RE.test(w) || /^(ward|vaardu)/.test(w)) break;
      before.unshift(w);
    }
    const distinct = before.filter((w) => parseNumberToken(w) == null);
    if (!distinct.length) return { text: null, own: before.length === 0 };
    return { text: titleCase([...before, type === 'st' ? 'street' : type].join(' ')), own: false };
  }
  // Tamil: words before தெரு / வீதி / சாலை / நகர் ...
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const type = STREET_TYPES_TA.find((ty) => tok.startsWith(ty) || tok.includes(ty));
    if (!type) continue;
    const before: string[] = [];
    // glued number "2வது" before the type
    for (let k = i - 1; k >= 0 && before.length < 3; k--) {
      const w = tokens[k];
      if (TAMIL_OWN.includes(w) || !TAMIL_RE.test(w) && parseNumberToken(w) == null) break;
      before.unshift(w);
    }
    const distinct = before.filter((w) => parseNumberToken(w) == null);
    if (!distinct.length) return { text: null, own: true };
    return { text: [...before, type].join(' '), own: false };
  }
  return { text: null, own: false };
}

export function matchLocalBody(norm: string, tokens: string[], bodies: LocalBodyInfo[]) {
  for (const b of bodies) {
    const en = normalize(b.name_en);
    if (en && (en.includes(' ') ? termMatches(norm, tokens, en) : tokens.some((t) => tokenMatches(t, en)))) return b;
    if (b.name_ta && norm.includes(normalize(b.name_ta))) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

const UNIT_STEMS: Array<{ stems: string[]; days: number; en: string; ta: string }> = [
  { stems: ['naal', 'nal', 'day', 'நாள', 'நாட்க', 'naatkal'], days: 1, en: 'day', ta: 'நாட்களாக' },
  { stems: ['vaaram', 'varam', 'week', 'வார'], days: 7, en: 'week', ta: 'வாரங்களாக' },
  { stems: ['maasam', 'masam', 'maadham', 'month', 'மாச', 'மாத'], days: 30, en: 'month', ta: 'மாதங்களாக' },
  { stems: ['varusham', 'varudam', 'year', 'வருஷ', 'வருட'], days: 365, en: 'year', ta: 'ஆண்டுகளாக' },
];

export function extractDuration(norm: string, tokens: string[]): Analysis['duration'] {
  for (let i = 0; i < tokens.length - 1; i++) {
    const n = parseNumberToken(tokens[i]);
    if (n == null || n > 400) continue;
    const next = tokens[i + 1];
    const unit = UNIT_STEMS.find((u) => u.stems.some((s) => next.startsWith(s)));
    if (!unit || /^(naalu|nalu)$/.test(next)) continue;
    const days = n * unit.days;
    const en = `${n} ${unit.en}${n > 1 ? 's' : ''}`;
    const ta = `${n} ${unit.ta}`;
    return { days, en, ta };
  }
  const m = norm.match(/(\d+)\s*(days?|weeks?|months?)/);
  if (m) {
    const n = parseInt(m[1], 10);
    const mul = m[2].startsWith('week') ? 7 : m[2].startsWith('month') ? 30 : 1;
    return { days: n * mul, en: `${n} ${m[2]}`, ta: `${n} ${mul === 7 ? 'வாரங்களாக' : mul === 30 ? 'மாதங்களாக' : 'நாட்களாக'}` };
  }
  if (/(romba|rombha|neenda|pala|many|several|long)\s*(naal|nal|days|time|naala)|ரொம்ப நாள|நீண்ட நாள|பல நாள|ரொம்ப நாளா|since long|for long|for a long time/.test(norm)) {
    return { days: 30, en: 'a long time', ta: 'நீண்ட நாட்களாக' };
  }
  if (/\b(nethu|netru|nethiku|yesterday)\b|நேத்து|நேற்று/.test(norm)) return { days: 1, en: 'since yesterday', ta: 'நேற்று முதல்' };
  if (/\b(inniku|innaiku|today|indru)\b|இன்னைக்கு|இன்று/.test(norm)) return { days: 0, en: 'since today', ta: 'இன்று முதல்' };
  return null;
}

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

export function scoreCategories(norm: string, tokens: string[], ctx: NlpContext) {
  const scores: Record<string, number> = {};
  const matched: string[] = [];
  for (const [code, lex] of Object.entries(LEXICON)) {
    let s = 0;
    for (const term of lex.strong) if (termMatches(norm, tokens, term)) { s += 3; matched.push(term); }
    for (const term of lex.weak) if (termMatches(norm, tokens, term)) { s += 1; matched.push(term); }
    scores[code] = s;
  }
  // Admin-configured keywords from the database
  for (const c of ctx.categories) {
    for (const kw of c.keywords ?? []) {
      if (kw && termMatches(norm, tokens, kw.toLowerCase())) { scores[c.code] = (scores[c.code] ?? 0) + 3; matched.push(kw); }
    }
  }
  // Combination rules
  const lightish = ['light', 'lights', 'lite', 'bulb', 'lamp', 'லைட்', 'பல்பு', 'விளக்கு'].some((t) => termMatches(norm, tokens, t));
  const notBurning = ['eriyala', 'eriyalai', 'eriyavillai', 'eriyale', 'எரியல', 'எரியவில்லை', 'not working', 'not burning', 'work aagala', 'velai seiyala', 'வேலை செய்யல', 'வேலை செய்யவில்லை', 'dark', 'iruttu', 'இருட்டு'].some((t) => termMatches(norm, tokens, t));
  const streetish = ['street', 'theru', 'தெரு', 'pole', 'post', 'கம்பம்'].some((t) => termMatches(norm, tokens, t));
  if (lightish && (notBurning || streetish)) scores.STREET_LIGHT += 4;
  const waterish = ['water', 'thanni', 'tanni', 'தண்ணி', 'தண்ணீர்', 'neer', 'நீர்'].some((t) => termMatches(norm, tokens, t));
  const notComing = ['varala', 'varalai', 'varavillai', 'not coming', 'no water', 'வரல', 'வரவில்லை', 'illa', 'இல்ல'].some((t) => termMatches(norm, tokens, t));
  if (waterish && notComing) scores.WATER_SUPPLY += 3;
  if (waterish && ['leak', 'leaking', 'burst', 'veena', 'வீணா', 'கசிவு', 'உடைஞ்சு', 'udainju'].some((t) => termMatches(norm, tokens, t))) scores.WATER_LEAK += 3;
  if (scores.DRAINAGE >= 3) { scores.WATER_SUPPLY -= 2; scores.WATER_LEAK -= 1; }
  if (scores.STREET_LIGHT >= 6) scores.ROAD_DAMAGE -= 2; // "road la light eriyala"
  if (scores.MOSQUITO >= 3 && scores.DRAINAGE > 0) scores.DRAINAGE -= 1;

  const ranked = Object.entries(scores).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  return { ranked, matched: [...new Set(matched)] };
}

// ---------------------------------------------------------------------------
// Bilingual phrasing
// ---------------------------------------------------------------------------

const PROBLEM_PHRASE: Record<string, { en: string; ta: string }> = {
  STREET_LIGHT: { en: 'Street light not working', ta: 'தெரு விளக்கு எரியவில்லை' },
  WATER_SUPPLY: { en: 'Drinking water not supplied properly', ta: 'குடிநீர் சரியாக வரவில்லை' },
  WATER_LEAK: { en: 'Water pipeline leaking', ta: 'குடிநீர் குழாயில் கசிவு' },
  DRAINAGE: { en: 'Drainage blocked / overflowing', ta: 'கழிவுநீர் வடிகால் அடைப்பு / வழிதல்' },
  ROAD_DAMAGE: { en: 'Road damaged / potholes', ta: 'சாலை சேதம் / குழிகள்' },
  GARBAGE: { en: 'Garbage not cleared', ta: 'குப்பை அகற்றப்படவில்லை' },
  MOSQUITO: { en: 'Mosquito menace – fogging needed', ta: 'கொசுத் தொல்லை – புகை மருந்து தேவை' },
  STRAY_ANIMALS: { en: 'Stray animal menace', ta: 'தெருநாய் / கால்நடைத் தொல்லை' },
  TREE_FALL: { en: 'Fallen tree / branches', ta: 'மரம் / கிளை விழுந்துள்ளது' },
  PUBLIC_TOILET: { en: 'Public toilet needs attention', ta: 'பொதுக் கழிப்பறை சீரமைப்பு தேவை' },
  ENCROACHMENT: { en: 'Encroachment on public space', ta: 'பொது இடத்தில் ஆக்கிரமிப்பு' },
  OTHER: { en: 'Civic issue reported', ta: 'குடிமைப் பிரச்சினை' },
};

export function problemPhrase(code: string) {
  return PROBLEM_PHRASE[code] ?? PROBLEM_PHRASE.OTHER;
}

function bump(p: Priority, by: number): Priority {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, LEVELS.indexOf(p) + by))];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyze(text: string, ctx: NlpContext, hints?: { localBodyId?: number | null; wardNumber?: number | null }): Analysis {
  const norm = normalize(text);
  const tokens = tokenize(norm);
  const language = detectLanguage(text);

  // 1. Location first (so street names like "Main Road" don't bias the category)
  const lb = matchLocalBody(norm, tokens, ctx.localBodies) ?? (hints?.localBodyId ? ctx.localBodies.find((b) => b.id === hints.localBodyId) ?? null : null);
  const wardNumber = extractWard(tokens);
  const candidateStreets = ctx.streets.filter((s) => !lb || s.local_body_id === lb.id);
  const known = matchKnownStreet(norm, tokens, candidateStreets, wardNumber);
  const free = known ? { text: null, own: false } : extractStreetText(tokens);

  let classifyNorm = norm;
  if (known) {
    for (const piece of tokenize(normalize(known.name_en))) {
      if (!['street', 'theru'].includes(piece)) classifyNorm = classifyNorm.replace(new RegExp(`\\b${piece}\\w{0,4}\\b`, 'g'), ' ');
    }
  }
  if (lb) classifyNorm = classifyNorm.replace(normalize(lb.name_en), ' ');
  const classifyTokens = tokenize(classifyNorm);

  // 2. Category
  const { ranked, matched } = scoreCategories(classifyNorm, classifyTokens, ctx);
  const top = ranked[0];
  const second = ranked[1];
  let category = top && top[1] >= 2 ? top[0] : 'OTHER';
  const confidence = top ? Math.min(0.99, top[1] / (top[1] + (second?.[1] ?? 0) + 2)) : 0;
  const cat = ctx.categories.find((c) => c.code === category) ?? ctx.categories.find((c) => c.code === 'OTHER');
  if (!cat) category = 'OTHER';

  // 3. Duration, safety, severity
  const duration = extractDuration(norm, tokens);
  let safetyScore = 0;
  let critical = false;
  const cues_en: string[] = [];
  const cues_ta: string[] = [];
  for (const cue of SAFETY_CUES) {
    if (cue.terms.some((t) => termMatches(norm, tokens, t))) {
      if (cue.en === 'unsafe darkness at night' && category !== 'STREET_LIGHT') continue;
      safetyScore += cue.weight;
      cues_en.push(cue.en);
      cues_ta.push(cue.ta);
      if (cue.critical) critical = true;
    }
  }
  let severity: Priority = (cat?.default_priority as Priority) ?? 'MEDIUM';
  if (critical) severity = 'CRITICAL';
  else {
    if (safetyScore >= 6) severity = bump(severity, 2);
    else if (safetyScore >= 3) severity = bump(severity, 1);
    if (duration && duration.days >= 7) severity = bump(severity, 1);
    if (severity === 'CRITICAL') severity = 'HIGH'; // CRITICAL only on explicit critical hazards
  }

  // 4. Bilingual interpretation
  const phrase = problemPhrase(category);
  const streetName = known?.name_en ?? free.text ?? null;
  const streetNameTa = known?.name_ta ?? (free.text && TAMIL_RE.test(free.text) ? free.text : null) ?? streetName;
  const wardNo = known?.ward_number ?? wardNumber ?? null;
  const placeEn = [streetName, wardNo != null ? `Ward ${wardNo}` : null, lb?.name_en].filter(Boolean).join(', ');
  const placeTa = [streetNameTa, wardNo != null ? `வார்டு ${wardNo}` : null, lb?.name_ta ?? lb?.name_en].filter(Boolean).join(', ');

  const summary_en = [
    `${phrase.en}${placeEn ? ` at ${placeEn}` : ''}.`,
    duration ? `Problem exists for ${duration.en}.` : '',
    cues_en.length ? `Safety concern: ${cues_en.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  const summary_ta = [
    `${placeTa ? `${placeTa} – ` : ''}${phrase.ta}.`,
    duration ? `${duration.ta} இந்தப் பிரச்சினை உள்ளது.` : '',
    cues_ta.length ? `பாதுகாப்பு அபாயம்: ${cues_ta.join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  const missing: Analysis['missing'] = [];
  if (category === 'OTHER' || confidence < 0.4) missing.push('category');
  if (!streetName && wardNo == null) missing.push('location');

  return {
    language,
    category,
    confidence: Number(confidence.toFixed(2)),
    alternatives: ranked.slice(0, 4).map(([code, score]) => ({ code, score })),
    matchedTerms: matched.slice(0, 20),
    title_en: phrase.en,
    title_ta: phrase.ta,
    summary_en,
    summary_ta,
    confirm_en: `${phrase.en}${placeEn ? ` in ${placeEn}` : ''}.`,
    confirm_ta: `${placeTa ? `${placeTa} பகுதியில் ` : ''}${phrase.ta}.`,
    location: {
      localBodyId: lb?.id ?? null,
      localBodyName: lb?.name_en ?? null,
      wardNumber: wardNo,
      wardId: known?.ward_id ?? null,
      streetId: known?.id ?? null,
      streetName,
      streetNameTa,
      streetText: known ? null : free.text,
      ownStreet: free.own,
    },
    duration,
    safety: { risk: safetyScore >= 2 || critical, score: safetyScore, cues_en, cues_ta, critical },
    severity,
    evidence: { required: cat?.evidence_required ?? false, types: cat?.evidence_types ?? ['photo'] },
    department: cat?.default_department ?? 'GENERAL_ADMIN',
    missing,
    engine: 'rules',
  };
}

/** Jaccard similarity of content tokens — used by duplicate detection. */
export function textSimilarity(a: string, b: string): number {
  const bag = (s: string) => new Set(tokenize(normalize(s)).filter((t) => t.length > 2 && !STOPWORDS.has(t)));
  const A = bag(a);
  const B = bag(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if ([...B].some((y) => tokenMatches(x, y) || tokenMatches(y, x))) inter++;
  return inter / (A.size + B.size - inter);
}

export type { CategoryCode };
