import 'server-only';
import { sql } from './db';
import type { AuthUser } from './auth';

/**
 * Row-level visibility of complaints for an official — enforced in every query.
 * Mirrors the jurisdiction model: EO → local body, Supervisor/Dept officer → department
 * within local body, Ward member → ward, Field staff → own assignments.
 * Use with table alias `c`.
 */
export function complaintScope(u: AuthUser) {
  const p = u.permissions;
  if (p.has('complaint.view.all')) return sql`TRUE`;
  const parts = [];
  if (p.has('complaint.view.localbody') && u.localBodyId) parts.push(sql`c.local_body_id = ${u.localBodyId}`);
  if (p.has('complaint.view.department') && u.localBodyId) {
    parts.push(u.departmentId ? sql`(c.local_body_id = ${u.localBodyId} AND c.department_id = ${u.departmentId})` : sql`c.local_body_id = ${u.localBodyId}`);
  }
  if (p.has('complaint.view.ward') && u.wardId) parts.push(sql`c.ward_id = ${u.wardId}`);
  if (p.has('complaint.view.assigned')) {
    parts.push(sql`(c.assigned_to = ${u.id} OR c.inspector_id = ${u.id} OR EXISTS (SELECT 1 FROM assignments a WHERE a.complaint_id = c.id AND a.assigned_to = ${u.id}))`);
  }
  if (!parts.length) return sql`FALSE`;
  return parts.reduce((acc, cur) => sql`${acc} OR ${cur}`, sql`FALSE`);
}

/** Users an official may assign work to (active, same local body, operational roles below them). */
export function assignableScope(u: AuthUser) {
  if (!u.localBodyId) return sql`FALSE`;
  const base = sql`o.local_body_id = ${u.localBodyId} AND usr.status = 'ACTIVE' AND r.rank < ${u.roleRank} AND r.code IN ('FIELD_STAFF','SUPERVISOR','DEPT_OFFICER')`;
  if (u.role === 'EO') return base;
  return u.departmentId ? sql`${base} AND (o.department_id = ${u.departmentId} OR o.supervisor_id = ${u.id})` : base;
}
