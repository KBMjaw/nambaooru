import 'server-only';
import { sql } from './db';
import { notify, type Vars } from './notify';
import { problemPhrase } from './nlp/engine';
import type { Analysis } from './nlp/engine';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function nextComplaintCode() {
  const [r] = await sql`SELECT nextval('complaint_code_seq') AS n`;
  const year = new Date().toLocaleString('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' });
  return `NU-${year}-${String(r.n).padStart(6, '0')}`;
}

/** Final bilingual summary built from the confirmed structured data (category chosen/confirmed by the citizen). */
export function buildSummary(a: Analysis, categoryCode: string, loc: { street?: string | null; streetTa?: string | null; ward?: number | null; lbEn?: string | null; lbTa?: string | null }) {
  const phrase = problemPhrase(categoryCode);
  const placeEn = [loc.street, loc.ward != null ? `Ward ${loc.ward}` : null, loc.lbEn].filter(Boolean).join(', ');
  const placeTa = [loc.streetTa ?? loc.street, loc.ward != null ? `வார்டு ${loc.ward}` : null, loc.lbTa ?? loc.lbEn].filter(Boolean).join(', ');
  const keepLlm = a.engine === 'llm+rules' && a.category === categoryCode;
  const summary_en = keepLlm ? a.summary_en : [
    `${phrase.en}${placeEn ? ` at ${placeEn}` : ''}.`,
    a.duration ? `Problem exists for ${a.duration.en}.` : '',
    a.safety.cues_en.length ? `Safety concern: ${a.safety.cues_en.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  const summary_ta = keepLlm ? a.summary_ta : [
    `${placeTa ? `${placeTa} – ` : ''}${phrase.ta}.`,
    a.duration ? `${a.duration.ta} இந்தப் பிரச்சினை உள்ளது.` : '',
    a.safety.cues_ta.length ? `பாதுகாப்பு அபாயம்: ${a.safety.cues_ta.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return { title_en: phrase.en, title_ta: phrase.ta, summary_en, summary_ta };
}

/** Notify officials responsible for a complaint (EO of local body, department supervisors/officers, ward member). */
export async function notifyOfficials(complaintId: number, template: string, extra: Vars = {}, opts: { includeWardMember?: boolean } = {}) {
  const [c] = await sql`
    SELECT c.id, c.code, c.local_body_id, c.department_id, c.ward_id, cat.name_en, cat.name_ta
    FROM complaints c LEFT JOIN complaint_categories cat ON cat.id = c.category_id WHERE c.id = ${complaintId}`;
  if (!c) return;
  const users = await sql`
    SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id = u.role_id JOIN officials o ON o.user_id = u.id
    WHERE u.status = 'ACTIVE' AND o.local_body_id = ${c.local_body_id}
      AND (r.default_scope = 'LOCAL_BODY'
           OR (r.default_scope = 'DEPARTMENT' AND (o.department_id = ${c.department_id} OR o.department_id IS NULL))
           OR (${opts.includeWardMember ?? true} AND r.default_scope = 'WARD' AND o.ward_id = ${c.ward_id}))`;
  for (const u of users) {
    await notify(u.id as string, template, { code: c.code as string, category_en: c.name_en as string, category_ta: c.name_ta as string, ...extra }, c.id as number);
  }
}

export async function evidenceList(complaintId: number, kinds?: string[]) {
  return sql`
    SELECT e.id, e.kind, e.media_type, e.mime_type, e.latitude, e.longitude, e.gps_accuracy_m, e.captured_at, e.capture_source, e.created_at,
           u.full_name AS uploaded_by_name
    FROM complaint_evidence e JOIN users u ON u.id = e.uploaded_by
    WHERE e.complaint_id = ${complaintId} ${kinds ? sql`AND e.kind IN ${sql(kinds)}` : sql``}
    ORDER BY e.created_at`;
}
