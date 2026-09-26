import 'server-only';
import { sql } from './db';
import type { AuthUser } from './auth';
import { complaintScope } from './scope';

/** Aggregates for dashboards — always computed within the viewer's jurisdiction scope. */
export async function analytics(u: AuthUser, opts: { localBodyId?: number | null } = {}) {
  const scope = sql`(${complaintScope(u)}) ${opts.localBodyId ? sql`AND c.local_body_id = ${opts.localBodyId}` : sql``}`;
  const [summary, byWard, byCategory, byOfficer, monthly, repeat, byLocalBody] = await Promise.all([
    sql`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS pending,
               count(*) FILTER (WHERE status = 'SITE_INSPECTION')::int AS inspection,
               count(*) FILTER (WHERE status IN ('ASSIGNED','IN_PROGRESS'))::int AS in_progress,
               count(*) FILTER (WHERE status IN ('WORK_COMPLETED','VERIFICATION_PENDING','COMPLETION_VERIFIED','CLOSED'))::int AS completed,
               count(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
               count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
               count(*) FILTER (WHERE status = 'DUPLICATE')::int AS duplicate,
               count(*) FILTER (WHERE sla_due_at < now() AND status NOT IN ('CLOSED','REJECTED','DUPLICATE'))::int AS overdue,
               count(*) FILTER (WHERE status = 'CLOSED' AND closed_at > sla_due_at)::int AS closed_late,
               count(*) FILTER (WHERE status = 'CLOSED' AND closed_at <= sla_due_at)::int AS closed_on_time,
               round(avg(EXTRACT(EPOCH FROM (closed_at - submitted_at)) / 3600) FILTER (WHERE status = 'CLOSED'))::int AS avg_hours,
               count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last30,
               sum(supporters_count)::int AS supporters
        FROM complaints c WHERE ${scope}`,
    sql`SELECT w.ward_number, w.id, count(*)::int AS n FROM complaints c JOIN wards w ON w.id = c.ward_id WHERE ${scope}
        GROUP BY w.id, w.ward_number ORDER BY n DESC, w.ward_number LIMIT 15`,
    sql`SELECT cat.code, cat.name_en, cat.name_ta, cat.icon, count(*)::int AS n,
               round(avg(EXTRACT(EPOCH FROM (c.closed_at - c.submitted_at)) / 3600) FILTER (WHERE c.status = 'CLOSED'))::int AS avg_hours
        FROM complaints c JOIN complaint_categories cat ON cat.id = c.category_id WHERE ${scope}
        GROUP BY cat.code, cat.name_en, cat.name_ta, cat.icon ORDER BY n DESC`,
    sql`SELECT u.id, u.full_name, r.code AS role, count(*)::int AS n,
               count(*) FILTER (WHERE c.sla_due_at < now())::int AS overdue
        FROM complaints c JOIN users u ON u.id = c.assigned_to JOIN roles r ON r.id = u.role_id
        WHERE ${scope} AND c.status IN ('ASSIGNED','IN_PROGRESS','ON_HOLD','REWORK_REQUIRED','WORK_COMPLETED','VERIFICATION_PENDING') GROUP BY u.id, u.full_name, r.code ORDER BY n DESC LIMIT 12`,
    // Six-month trend: one grouped pass per series (the scope filter is evaluated twice, not once per month).
    sql`SELECT to_char(m, 'Mon YY') AS month, COALESCE(cr.n, 0)::int AS a, COALESCE(cl.n, 0)::int AS b
        FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m
        LEFT JOIN (SELECT date_trunc('month', c.created_at) AS mm, count(*) AS n FROM complaints c
                   WHERE ${scope} AND c.created_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1) cr ON cr.mm = m
        LEFT JOIN (SELECT date_trunc('month', c.closed_at) AS mm, count(*) AS n FROM complaints c
                   WHERE ${scope} AND c.status = 'CLOSED' AND c.closed_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1) cl ON cl.mm = m
        ORDER BY m`,
    sql`SELECT COALESCE(s.name_en, c.street_text) AS street, w.ward_number, cat.name_en, cat.name_ta, count(*)::int AS n
        FROM complaints c LEFT JOIN streets s ON s.id = c.street_id LEFT JOIN wards w ON w.id = c.ward_id JOIN complaint_categories cat ON cat.id = c.category_id
        WHERE ${scope} AND c.created_at > now() - interval '90 days' AND (c.street_id IS NOT NULL OR c.street_text IS NOT NULL)
        GROUP BY 1, w.ward_number, cat.name_en, cat.name_ta HAVING count(*) >= 2 ORDER BY n DESC LIMIT 8`,
    sql`SELECT lb.name_en, lb.name_ta, count(*)::int AS n FROM complaints c JOIN local_bodies lb ON lb.id = c.local_body_id WHERE ${scope}
        GROUP BY lb.id, lb.name_en, lb.name_ta ORDER BY n DESC LIMIT 10`,
  ]);
  const s = summary[0];
  const closedTotal = (s.closed_on_time as number) + (s.closed_late as number);
  const decided = (s.completed as number) + (s.rejected as number) + (s.duplicate as number);
  return {
    s,
    resolutionRate: s.total ? ((s.completed as number) / Math.max(1, (s.total as number) - (s.rejected as number) - (s.duplicate as number))) * 100 : null,
    slaCompliance: closedTotal ? ((s.closed_on_time as number) / closedTotal) * 100 : null,
    decided,
    byWard: [...byWard], byCategory: [...byCategory], byOfficer: [...byOfficer], monthly: [...monthly], repeat: [...repeat], byLocalBody: [...byLocalBody],
  };
}
