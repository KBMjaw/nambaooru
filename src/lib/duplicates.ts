import 'server-only';
import { sql } from './db';
import { textSimilarity } from './nlp/engine';
import { getSetting } from './settings';

export interface DupInput {
  categoryId: number;
  localBodyId: number;
  wardId: number | null;
  streetId: number | null;
  latitude: number | null;
  longitude: number | null;
  text: string;
  imageHash?: string | null;
  excludeId?: number;
}

function hamming(a: string, b: string) {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/**
 * Probable-duplicate search using location, category, ward/street, time window, description
 * similarity and perceptual image hash. Never auto-rejects — results are shown to the citizen
 * (and officials) who decide.
 */
export async function findDuplicates(input: DupInput) {
  const radius = Number(await getSetting('duplicate.radius_m', 150));
  const windowDays = Number(await getSetting('duplicate.window_days', 45));
  const hasGeo = input.latitude != null && input.longitude != null;
  const rows = await sql`
    SELECT c.id, c.code, c.status, c.updated_at, c.created_at, c.original_text, c.summary_en, c.summary_ta, c.street_id, c.ward_id,
           c.street_text, s.name_en AS street_en, s.name_ta AS street_ta, w.ward_number, c.supporters_count,
           ${hasGeo ? sql`CASE WHEN c.latitude IS NULL THEN NULL ELSE
             6371000 * 2 * asin(sqrt(power(sin(radians(c.latitude - ${input.latitude}) / 2), 2) +
             cos(radians(${input.latitude})) * cos(radians(c.latitude)) * power(sin(radians(c.longitude - ${input.longitude}) / 2), 2))) END`
             : sql`NULL::float`} AS distance_m,
           (SELECT e.image_hash FROM complaint_evidence e WHERE e.complaint_id = c.id AND e.kind = 'CITIZEN' AND e.image_hash IS NOT NULL
             ORDER BY e.id LIMIT 1) AS image_hash
    FROM complaints c
    LEFT JOIN streets s ON s.id = c.street_id
    LEFT JOIN wards w ON w.id = c.ward_id
    WHERE c.category_id = ${input.categoryId}
      AND c.local_body_id = ${input.localBodyId}
      AND c.status NOT IN ('CLOSED','REJECTED','DUPLICATE','DRAFT')
      AND c.created_at > now() - make_interval(days => ${windowDays})
      AND c.id <> ${input.excludeId ?? 0}
      AND (${input.wardId ?? null}::int IS NULL OR c.ward_id = ${input.wardId ?? null} OR c.ward_id IS NULL
           ${hasGeo ? sql`OR (c.latitude BETWEEN ${input.latitude! - 0.01} AND ${input.latitude! + 0.01}
                          AND c.longitude BETWEEN ${input.longitude! - 0.01} AND ${input.longitude! + 0.01})` : sql``})
    ORDER BY c.created_at DESC
    LIMIT 50`;

  const scored = rows.map((r) => {
    const reasons: string[] = [];
    let score = 0;
    if (input.streetId && r.street_id === input.streetId) { score += 0.35; reasons.push('same_street'); }
    else if (input.wardId && r.ward_id === input.wardId) { score += 0.15; reasons.push('same_ward'); }
    const d = r.distance_m as number | null;
    if (d != null && d <= radius) { score += 0.35 * (1 - d / radius) + 0.1; reasons.push('nearby'); }
    const sim = textSimilarity(input.text, `${r.original_text} ${r.summary_en ?? ''}`);
    if (sim > 0.15) { score += Math.min(0.3, sim); reasons.push('similar_text'); }
    if (input.imageHash && r.image_hash && hamming(input.imageHash, r.image_hash as string) <= 10) { score += 0.25; reasons.push('similar_photo'); }
    return {
      id: r.id as number,
      code: r.code as string,
      status: r.status as string,
      updatedAt: r.updated_at as Date,
      street: (r.street_en as string) ?? (r.street_text as string) ?? null,
      streetTa: (r.street_ta as string) ?? (r.street_text as string) ?? null,
      wardNumber: (r.ward_number as number) ?? null,
      distanceM: d != null ? Math.round(d) : null,
      supporters: r.supporters_count as number,
      summaryEn: r.summary_en as string,
      summaryTa: r.summary_ta as string,
      score: Number(score.toFixed(2)),
      reasons,
    };
  });
  return scored.filter((s) => s.score >= 0.4).sort((a, b) => b.score - a.score).slice(0, 5);
}
