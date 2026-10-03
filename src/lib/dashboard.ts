import 'server-only';
import { sql } from './db';
import type { AuthUser } from './auth';
import { complaintScope, localBodyScope } from './scope';
import { userVisibility } from './users';
import { citizenVisibility } from './citizens';

const OPEN = sql`c.status NOT IN ('CLOSED','REJECTED','DUPLICATE')`;

/** Counters and breakdowns for dashboards — every number is computed inside the viewer's jurisdiction. */
export async function dashboardData(u: AuthUser) {
  const cs = complaintScope(u);
  const [[counts], [people], byWard, byDept, byLb, recentCitizens, recentUsers, [work]] = await Promise.all([
    sql`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE ${OPEN})::int AS pending,
               count(*) FILTER (WHERE c.status IN ('ASSIGNED','IN_PROGRESS','ON_HOLD','REWORK_REQUIRED'))::int AS in_progress,
               count(*) FILTER (WHERE c.status IN ('WORK_COMPLETED','VERIFICATION_PENDING','COMPLETION_VERIFIED','CLOSED'))::int AS completed,
               count(*) FILTER (WHERE c.sla_due_at < now() AND ${OPEN})::int AS overdue,
               count(*) FILTER (WHERE c.priority IN ('HIGH','CRITICAL') AND ${OPEN})::int AS high,
               count(*) FILTER (WHERE c.status = 'SITE_INSPECTION')::int AS inspection,
               count(*) FILTER (WHERE c.status IN ('WORK_COMPLETED','VERIFICATION_PENDING'))::int AS awaiting_verification,
               count(*) FILTER (WHERE c.status = 'REWORK_REQUIRED')::int AS rework,
               count(*) FILTER (WHERE c.status = 'ON_HOLD')::int AS on_hold,
               count(*) FILTER (WHERE c.escalation_level > 0 AND ${OPEN})::int AS escalated,
               count(*) FILTER (WHERE c.resolution_type = 'NO_ISSUE_FOUND')::int AS no_issue,
               count(*) FILTER (WHERE c.status = 'CLOSED')::int AS closed,
               count(*) FILTER (WHERE c.status IN ('SUBMITTED','AI_CLASSIFIED','REOPENED','INITIAL_REVIEW'))::int AS new
        FROM complaints c WHERE ${cs}`,
    sql`SELECT (SELECT count(*) FROM users usr JOIN roles r ON r.id = usr.role_id JOIN citizens ct ON ct.user_id = usr.id WHERE ${citizenVisibility(u)})::int AS citizens,
               (SELECT count(*) FROM users usr JOIN roles r ON r.id = usr.role_id LEFT JOIN officials o ON o.user_id = usr.id WHERE ${userVisibility(u)})::int AS officers,
               (SELECT count(*) FROM users usr JOIN roles r ON r.id = usr.role_id LEFT JOIN officials o ON o.user_id = usr.id WHERE ${userVisibility(u)} AND usr.status = 'ACTIVE')::int AS active,
               (SELECT count(*) FROM users usr JOIN roles r ON r.id = usr.role_id LEFT JOIN officials o ON o.user_id = usr.id WHERE ${userVisibility(u)} AND usr.status <> 'ACTIVE')::int AS inactive`,
    sql`SELECT w.id, w.ward_number, lb.name_en AS lb_en, lb.name_ta AS lb_ta, count(*)::int AS n, count(*) FILTER (WHERE ${OPEN})::int AS open
        FROM complaints c JOIN wards w ON w.id = c.ward_id JOIN local_bodies lb ON lb.id = w.local_body_id WHERE ${cs}
        GROUP BY w.id, w.ward_number, lb.name_en, lb.name_ta ORDER BY n DESC, w.ward_number LIMIT 12`,
    sql`SELECT d.id, d.name_en, d.name_ta, lb.name_en AS lb_en, count(*)::int AS n, count(*) FILTER (WHERE ${OPEN})::int AS open,
               count(*) FILTER (WHERE c.status IN ('WORK_COMPLETED','VERIFICATION_PENDING','COMPLETION_VERIFIED','CLOSED'))::int AS done,
               count(*) FILTER (WHERE c.sla_due_at < now() AND ${OPEN})::int AS overdue,
               round(avg(EXTRACT(EPOCH FROM (c.closed_at - c.submitted_at)) / 3600) FILTER (WHERE c.status = 'CLOSED'))::int AS avg_hours
        FROM complaints c JOIN departments d ON d.id = c.department_id JOIN local_bodies lb ON lb.id = d.local_body_id WHERE ${cs}
        GROUP BY d.id, d.name_en, d.name_ta, lb.name_en ORDER BY n DESC LIMIT 15`,
    sql`SELECT lb.id, lb.name_en, lb.name_ta, count(*)::int AS n, count(*) FILTER (WHERE ${OPEN})::int AS open,
               count(*) FILTER (WHERE c.sla_due_at < now() AND ${OPEN})::int AS overdue
        FROM complaints c JOIN local_bodies lb ON lb.id = c.local_body_id WHERE ${cs} GROUP BY lb.id, lb.name_en, lb.name_ta ORDER BY n DESC LIMIT 12`,
    sql`SELECT usr.id, usr.full_name, usr.created_at, lb.name_en AS lb_en, w.ward_number FROM users usr JOIN roles r ON r.id = usr.role_id JOIN citizens ct ON ct.user_id = usr.id
        LEFT JOIN local_bodies lb ON lb.id = ct.local_body_id LEFT JOIN wards w ON w.id = ct.ward_id WHERE ${citizenVisibility(u)} ORDER BY usr.created_at DESC LIMIT 6`,
    sql`SELECT usr.id, usr.full_name, usr.created_at, r.name_en AS role_en, lb.name_en AS lb_en FROM users usr JOIN roles r ON r.id = usr.role_id LEFT JOIN officials o ON o.user_id = usr.id
        LEFT JOIN local_bodies lb ON lb.id = o.local_body_id WHERE ${userVisibility(u)} ORDER BY usr.created_at DESC LIMIT 6`,
    sql`SELECT (SELECT count(*) FROM assignments a JOIN complaints c ON c.id = a.complaint_id WHERE a.purpose = 'WORK' AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS') AND ${cs})::int AS assigned_work,
               (SELECT count(*) FROM complaint_actions ca JOIN complaints c ON c.id = ca.complaint_id WHERE ca.status IN ('PENDING','ASSIGNED','IN_PROGRESS') AND ${cs})::int AS open_actions,
               (SELECT count(*) FROM complaint_actions ca JOIN complaints c ON c.id = ca.complaint_id WHERE ca.status = 'PENDING' AND ${cs})::int AS unassigned_actions,
               (SELECT count(*) FROM local_bodies lb WHERE ${localBodyScope(u)})::int AS local_bodies`,
  ]);
  return { counts, people, byWard: [...byWard], byDept: [...byDept], byLb: [...byLb], recentCitizens: [...recentCitizens], recentUsers: [...recentUsers], work };
}
