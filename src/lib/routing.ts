import 'server-only';
import { sql } from './db';

/** Location-aware routing: (local body, category[, ward]) → department (+ default officer). Configurable by admins. */
export async function routeComplaint(localBodyId: number, categoryId: number, wardId: number | null) {
  const rows = await sql`
    SELECT department_id, default_officer_id FROM routing_rules
    WHERE local_body_id = ${localBodyId} AND category_id = ${categoryId} AND status = 'ACTIVE'
      AND (ward_id = ${wardId} OR ward_id IS NULL)
    ORDER BY ward_id NULLS LAST LIMIT 1`;
  if (rows.length) return { departmentId: rows[0].department_id as number, defaultOfficerId: rows[0].default_officer_id as string | null };
  const dept = await sql`
    SELECT d.id FROM departments d JOIN complaint_categories c ON c.default_department = d.code
    WHERE c.id = ${categoryId} AND d.local_body_id = ${localBodyId} AND d.status = 'ACTIVE' LIMIT 1`;
  return { departmentId: (dept[0]?.id as number) ?? null, defaultOfficerId: null };
}
