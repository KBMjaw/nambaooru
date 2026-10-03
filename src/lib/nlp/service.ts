import 'server-only';
import { sql } from '../db';
import { analyze, problemPhrase, type Analysis, type CategoryInfo, type NlpContext, type StreetInfo, type LocalBodyInfo } from './engine';
import { refineWithLlm } from './llm';
import { getSetting } from '../settings';

let cache: { at: number; ctx: NlpContext } | null = null;

/** Master data used by the NLP engine, cached briefly per serverless instance. */
export async function nlpContext(): Promise<NlpContext> {
  if (cache && Date.now() - cache.at < 60_000) return cache.ctx;
  const [categories, streets, localBodies] = await Promise.all([
    sql<CategoryInfo[]>`SELECT code, name_en, name_ta, default_department, evidence_required, evidence_types, default_priority, keywords
                        FROM complaint_categories WHERE status = 'ACTIVE' ORDER BY sort_order`,
    sql<StreetInfo[]>`SELECT s.id, s.ward_id, w.ward_number, w.local_body_id, s.name_en, s.name_ta
                      FROM streets s JOIN wards w ON w.id = s.ward_id WHERE s.status = 'ACTIVE' AND w.status = 'ACTIVE'`,
    sql<LocalBodyInfo[]>`SELECT id, name_en, name_ta FROM local_bodies WHERE status = 'ACTIVE'`,
  ]);
  const ctx = { categories: [...categories], streets: [...streets], localBodies: [...localBodies] };
  cache = { at: Date.now(), ctx };
  return ctx;
}

export async function analyzeComplaint(text: string, hints?: { localBodyId?: number | null }): Promise<Analysis> {
  const ctx = await nlpContext();
  const rules = analyze(text, ctx, hints);
  const engine = await getSetting<string>('ai.engine', 'auto');
  if (engine === 'rules' || !process.env.ANTHROPIC_API_KEY) return rules;
  const model = await getSetting<string>('ai.llm_model', 'claude-opus-5');
  return refineWithLlm(text, rules, ctx, model);
}

export { problemPhrase };
