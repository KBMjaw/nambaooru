import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { Analysis, NlpContext, Priority } from './engine';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'ward_number', 'street', 'duration_days', 'safety_risk', 'safety_reasons_en', 'severity', 'summary_en', 'summary_ta', 'translation_en'],
  properties: {
    category: { type: 'string' },
    ward_number: { type: ['integer', 'null'] },
    street: { type: ['string', 'null'] },
    duration_days: { type: ['integer', 'null'] },
    safety_risk: { type: 'boolean' },
    safety_reasons_en: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    summary_en: { type: 'string' },
    summary_ta: { type: 'string' },
    translation_en: { type: 'string' },
  },
} as const;

interface LlmOut {
  category: string;
  ward_number: number | null;
  street: string | null;
  duration_days: number | null;
  safety_risk: boolean;
  safety_reasons_en: string[];
  severity: Priority;
  summary_en: string;
  summary_ta: string;
  translation_en: string;
}

/**
 * Optional refinement with Claude. Runs only when ANTHROPIC_API_KEY is set and the
 * admin AI setting allows it. The rules result stays the fallback; the LLM can only
 * choose among configured categories, and humans still confirm/decide everything.
 */
export async function refineWithLlm(text: string, rules: Analysis, ctx: NlpContext, model: string): Promise<Analysis> {
  if (!process.env.ANTHROPIC_API_KEY) return rules;
  const client = new Anthropic({ timeout: 12_000, maxRetries: 1 });
  const categories = ctx.categories.map((c) => `${c.code}: ${c.name_en} / ${c.name_ta}`).join('\n');
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system:
        'You interpret civic complaints from citizens of Tamil Nadu, India, for a local-body grievance portal. ' +
        'Input may be formal Tamil, colloquial/spoken Tamil, Tanglish (Tamil in English letters), English, or a mix, with spelling mistakes. ' +
        'Choose exactly one category code from the list. Extract ward number and street name only if the citizen said them. ' +
        'summary_en and summary_ta are one or two plain sentences an official can act on; summary_ta must be natural Tamil. ' +
        'translation_en is a faithful English translation of the citizen\'s words. Do not invent facts.\n\nCategories:\n' + categories,
      messages: [{ role: 'user', content: `Citizen statement:\n${text.slice(0, 4000)}\n\nRule-based pre-analysis (may be wrong): category=${rules.category}, ward=${rules.location.wardNumber ?? 'unknown'}, street=${rules.location.streetName ?? 'unknown'}` }],
    });
    if (res.stop_reason === 'refusal') return rules;
    const block = res.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return rules;
    const out = JSON.parse(block.text) as LlmOut;
    const valid = ctx.categories.some((c) => c.code === out.category);
    const category = valid ? out.category : rules.category;
    const cat = ctx.categories.find((c) => c.code === category);
    return {
      ...rules,
      category,
      confidence: valid ? Math.max(rules.confidence, 0.85) : rules.confidence,
      summary_en: out.summary_en || rules.summary_en,
      summary_ta: out.summary_ta || rules.summary_ta,
      location: {
        ...rules.location,
        wardNumber: rules.location.wardNumber ?? out.ward_number,
        streetName: rules.location.streetName ?? out.street,
        streetText: rules.location.streetText ?? (rules.location.streetId ? null : out.street),
      },
      safety: {
        ...rules.safety,
        risk: rules.safety.risk || out.safety_risk,
        cues_en: rules.safety.cues_en.length ? rules.safety.cues_en : out.safety_reasons_en,
      },
      severity: rules.safety.critical ? 'CRITICAL' : out.severity,
      evidence: cat ? { required: cat.evidence_required, types: cat.evidence_types } : rules.evidence,
      department: cat?.default_department ?? rules.department,
      missing: rules.missing.filter((m) => !(m === 'category' && valid && category !== 'OTHER')),
      engine: 'llm+rules',
      translation_en: out.translation_en,
    } as Analysis;
  } catch (e) {
    console.warn('[nlp] LLM refinement failed, using rules result', (e as Error).message);
    return rules;
  }
}
