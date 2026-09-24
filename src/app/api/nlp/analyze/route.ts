import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { analyzeComplaint } from '@/lib/nlp/service';

/** AI understanding of the citizen's natural-language / voice complaint. Assistive only. */
export const POST = route(async (req) => {
  const u = await requireApiUser('PUBLIC', 'complaint.create');
  await rateLimit(`nlp:${u.id}`, 40, 600);
  const { text } = await body(req, z.object({ text: z.string().trim().min(3).max(4000) }));
  const a = await analyzeComplaint(text, { localBodyId: u.localBodyId });
  const lbId = a.location.localBodyId ?? u.localBodyId;
  const [cat] = await sql`SELECT id, code, name_en, name_ta, icon FROM complaint_categories WHERE code = ${a.category}`;
  const [dept] = lbId
    ? await sql`SELECT d.id, d.name_en, d.name_ta FROM routing_rules r JOIN departments d ON d.id = r.department_id
                WHERE r.local_body_id = ${lbId} AND r.category_id = ${cat?.id ?? 0} AND r.status = 'ACTIVE' ORDER BY r.ward_id NULLS LAST LIMIT 1`
    : [];
  // Resolve ward id from number within the local body
  let wardId = a.location.wardId;
  if (!wardId && a.location.wardNumber != null && lbId) {
    const [w] = await sql`SELECT id FROM wards WHERE local_body_id = ${lbId} AND ward_number = ${a.location.wardNumber} AND status = 'ACTIVE'`;
    wardId = (w?.id as number) ?? null;
  }
  return { analysis: { ...a, location: { ...a.location, localBodyId: lbId, wardId } }, category: cat ?? null, department: dept ?? null };
});
