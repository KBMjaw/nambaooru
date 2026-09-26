import 'server-only';
import { sql } from './db';
import type { AuthUser } from './auth';
import { complaintScope } from './scope';
import { has } from './auth';

export const BUCKETS: Record<string, string[]> = {
  new: ['SUBMITTED', 'AI_CLASSIFIED', 'REOPENED'],
  review: ['INITIAL_REVIEW'],
  inspection: ['SITE_INSPECTION'],
  verified: ['VERIFIED'],
  assigned: ['ASSIGNED'],
  progress: ['IN_PROGRESS'],
  hold: ['ON_HOLD'],
  verification: ['WORK_COMPLETED', 'VERIFICATION_PENDING'],
  rework: ['REWORK_REQUIRED'],
  completed: ['COMPLETION_VERIFIED', 'CLOSED'],
  closed: ['CLOSED'],
  rejected: ['REJECTED'],
  duplicate: ['DUPLICATE'],
};

export interface Filters {
  bucket?: string; ward?: string; street?: string; category?: string; status?: string; priority?: string;
  from?: string; to?: string; staff?: string; q?: string; dept?: string; page?: string; escalated?: string; conflict?: string; lb?: string;
}

/** Complaints still waiting for someone to be put on the work (before assignment). */
const UNASSIGNED = sql`c.status IN ('SUBMITTED','AI_CLASSIFIED','REOPENED','INITIAL_REVIEW','SITE_INSPECTION','VERIFIED')
  AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.complaint_id = c.id AND a.purpose = 'WORK' AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS') AND a.assignee_role <> 'SUPERVISOR')`;

/**
 * "My action required": complaints where the next step is this user's — work assigned to them, complaints they
 * supervise that await verification, an inspection they must do, or a stage their permissions let them decide.
 * Always combined with complaintScope(u), so it never reaches outside the user's jurisdiction.
 */
export function myActionSql(u: AuthUser) {
  const byPerm: string[] = [];
  if (has(u, 'complaint.review')) byPerm.push('SUBMITTED', 'AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW');
  if (has(u, 'complaint.assign')) byPerm.push('VERIFIED');
  if (has(u, 'complaint.verify')) byPerm.push('WORK_COMPLETED', 'VERIFICATION_PENDING');
  if (has(u, 'complaint.close')) byPerm.push('COMPLETION_VERIFIED');
  const perm = byPerm.length && u.scope !== 'ASSIGNED' ? sql`c.status IN ${sql(byPerm)}` : sql`FALSE`;
  return sql`(${perm} OR EXISTS (SELECT 1 FROM assignments a WHERE a.complaint_id = c.id AND a.assigned_to = ${u.id} AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS')
      AND ((a.purpose = 'WORK' AND a.assignee_role IN ('PRIMARY','SUPPORT') AND c.status IN ('ASSIGNED','IN_PROGRESS','ON_HOLD','REWORK_REQUIRED'))
        OR (a.purpose = 'WORK' AND a.assignee_role = 'SUPERVISOR' AND c.status IN ('WORK_COMPLETED','VERIFICATION_PENDING'))
        OR (a.purpose = 'INSPECTION' AND c.status = 'SITE_INSPECTION'))))`;
}

export function filterSql(f: Filters, u?: AuthUser) {
  const parts = [sql`TRUE`];
  if (f.bucket === 'overdue') parts.push(sql`c.sla_due_at < now() AND c.status NOT IN ('CLOSED','REJECTED','DUPLICATE')`);
  else if (f.bucket === 'unassigned') parts.push(UNASSIGNED);
  else if (f.bucket === 'mine') parts.push(u ? myActionSql(u) : sql`FALSE`);
  else if (f.bucket === 'noissue') parts.push(sql`c.resolution_type = 'NO_ISSUE_FOUND'`);
  else if (f.bucket === 'escalated') parts.push(sql`c.escalation_level > 0 AND c.status NOT IN ('CLOSED','REJECTED','DUPLICATE')`);
  else if (f.bucket === 'open') parts.push(sql`c.status NOT IN ('CLOSED','REJECTED','DUPLICATE')`);
  else if (f.bucket === 'high') parts.push(sql`c.priority IN ('HIGH','CRITICAL') AND c.status NOT IN ('CLOSED','REJECTED','DUPLICATE')`);
  else if (f.bucket === 'active') parts.push(sql`c.status IN ('ASSIGNED','IN_PROGRESS','ON_HOLD','REWORK_REQUIRED')`);
  else if (f.bucket && BUCKETS[f.bucket]) parts.push(sql`c.status IN ${sql(BUCKETS[f.bucket])}`);
  if (f.status) parts.push(sql`c.status = ${f.status}`);
  if (f.ward) parts.push(sql`c.ward_id = ${Number(f.ward)}`);
  if (f.street) parts.push(sql`c.street_id = ${Number(f.street)}`);
  if (f.category) parts.push(sql`cat.code = ${f.category}`);
  if (f.priority) parts.push(sql`c.priority = ${f.priority}`);
  if (f.dept) parts.push(sql`c.department_id = ${Number(f.dept)}`);
  if (f.staff && /^[0-9a-f-]{36}$/i.test(f.staff)) parts.push(sql`(c.assigned_to = ${f.staff} OR EXISTS (SELECT 1 FROM assignments a WHERE a.complaint_id = c.id AND a.assigned_to = ${f.staff})
    OR EXISTS (SELECT 1 FROM complaint_actions ca JOIN complaint_action_assignees x ON x.action_id = ca.id WHERE ca.complaint_id = c.id AND x.user_id = ${f.staff} AND x.removed_at IS NULL))`);
  if (f.lb && Number(f.lb)) parts.push(sql`c.local_body_id = ${Number(f.lb)}`);
  if (f.escalated) parts.push(sql`c.escalated`);
  if (f.conflict) parts.push(sql`c.location_conflict`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) parts.push(sql`c.created_at >= ${f.from}::date`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) parts.push(sql`c.created_at < ${f.to}::date + 1`);
  if (f.q) {
    const q = `%${f.q.trim().slice(0, 80)}%`;
    parts.push(sql`(c.code ILIKE ${q} OR c.original_text ILIKE ${q} OR c.summary_en ILIKE ${q} OR s.name_en ILIKE ${q} OR c.street_text ILIKE ${q})`);
  }
  return parts.reduce((a, b) => sql`${a} AND ${b}`);
}

export async function bucketCounts(u: AuthUser) {
  const [r] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('SUBMITTED','AI_CLASSIFIED','REOPENED'))::int AS new,
      count(*) FILTER (WHERE status = 'INITIAL_REVIEW')::int AS review,
      count(*) FILTER (WHERE status = 'SITE_INSPECTION')::int AS inspection,
      count(*) FILTER (WHERE status = 'VERIFIED')::int AS verified,
      count(*) FILTER (WHERE status = 'ASSIGNED')::int AS assigned,
      count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS progress,
      count(*) FILTER (WHERE status = 'ON_HOLD')::int AS hold,
      count(*) FILTER (WHERE status IN ('WORK_COMPLETED','VERIFICATION_PENDING'))::int AS verification,
      count(*) FILTER (WHERE status = 'REWORK_REQUIRED')::int AS rework,
      count(*) FILTER (WHERE status IN ('COMPLETION_VERIFIED','CLOSED'))::int AS completed,
      count(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
      count(*) FILTER (WHERE ${UNASSIGNED})::int AS unassigned,
      count(*) FILTER (WHERE ${myActionSql(u)})::int AS mine,
      count(*) FILTER (WHERE resolution_type = 'NO_ISSUE_FOUND')::int AS noissue,
      count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
      count(*) FILTER (WHERE status = 'DUPLICATE')::int AS duplicate,
      count(*) FILTER (WHERE status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS pending,
      count(*) FILTER (WHERE sla_due_at < now() AND status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS overdue,
      count(*) FILTER (WHERE escalation_level > 0 AND status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS escalated,
      count(*) FILTER (WHERE location_conflict AND status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS conflict
    FROM complaints c WHERE (${complaintScope(u)})`;
  return r as Record<string, number>;
}

export async function listComplaints(u: AuthUser, f: Filters, limit = 50) {
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const rows = await sql`
    SELECT c.id, c.code, c.status, c.priority, c.created_at, c.updated_at, c.sla_due_at, c.escalated, c.escalation_level, c.resolution_type, c.location_conflict, c.safety_risk,
           c.title_en, c.title_ta, c.latitude, c.longitude, c.supporters_count,
           cat.icon, cat.code AS category_code, cat.name_en AS category_en, cat.name_ta AS category_ta,
           w.ward_number, COALESCE(s.name_en, c.street_text) AS street, COALESCE(s.name_ta, c.street_text) AS street_ta,
           au.full_name AS assigned_name, count(*) OVER()::int AS total_count
    FROM complaints c
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    LEFT JOIN wards w ON w.id = c.ward_id
    LEFT JOIN streets s ON s.id = c.street_id
    LEFT JOIN users au ON au.id = c.assigned_to
    WHERE (${complaintScope(u)}) AND ${filterSql(f, u)}
    ORDER BY (c.status IN ('CLOSED','REJECTED','DUPLICATE')), CASE c.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, c.created_at DESC
    LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
  return { rows: [...rows], total: (rows[0]?.total_count as number) ?? 0, page, limit };
}

export async function filterOptions(u: AuthUser) {
  const lb = u.localBodyId;
  const [wards, categories, staff, depts] = await Promise.all([
    lb ? sql`SELECT id, ward_number FROM wards WHERE local_body_id = ${lb} ORDER BY ward_number` : sql`SELECT id, ward_number FROM wards WHERE false`,
    sql`SELECT code, name_en, name_ta, icon FROM complaint_categories WHERE status = 'ACTIVE' ORDER BY sort_order`,
    lb ? sql`SELECT u.id, u.full_name, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id JOIN officials o ON o.user_id = u.id
             WHERE o.local_body_id = ${lb} AND r.default_scope IN ('ASSIGNED','DEPARTMENT') ORDER BY u.full_name` : sql`SELECT NULL WHERE false`,
    lb ? sql`SELECT id, name_en, name_ta FROM departments WHERE local_body_id = ${lb} ORDER BY name_en` : sql`SELECT NULL WHERE false`,
  ]);
  return { wards: [...wards], categories: [...categories], staff: [...staff], depts: [...depts] };
}
