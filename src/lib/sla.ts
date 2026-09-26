import 'server-only';
import { sql } from './db';
import { notify } from './notify';

export async function slaHours(categoryId: number | null, priority: string, localBodyId: number | null) {
  const rows = await sql`
    SELECT resolution_hours, inspection_hours FROM sla_rules
    WHERE status = 'ACTIVE' AND priority = ${priority}
      AND (category_id = ${categoryId} OR category_id IS NULL)
      AND (local_body_id = ${localBodyId} OR local_body_id IS NULL)
    ORDER BY category_id NULLS LAST, local_body_id NULLS LAST LIMIT 1`;
  return { resolution: (rows[0]?.resolution_hours as number) ?? 168, inspection: (rows[0]?.inspection_hours as number) ?? 48 };
}

const OPEN = sql`status NOT IN ('CLOSED','REJECTED','DUPLICATE','DRAFT')`;

/** Sends "SLA approaching" and "SLA breached" notifications once per complaint. Run by Vercel Cron and opportunistically. */
export async function slaSweep() {
  const approaching = await sql`
    UPDATE complaints c SET sla_warned_at = now()
    FROM sla_rules r
    WHERE ${OPEN} AND c.sla_warned_at IS NULL AND c.sla_due_at IS NOT NULL AND c.sla_due_at > now()
      AND r.priority = c.priority AND r.category_id IS NULL AND r.local_body_id IS NULL
      AND c.sla_due_at < now() + make_interval(hours => r.warn_before_hours)
    RETURNING c.id, c.code, c.assigned_to, c.local_body_id, c.department_id`;
  const breached = await sql`
    UPDATE complaints c SET sla_breached_at = now()
    WHERE ${OPEN} AND c.sla_breached_at IS NULL AND c.sla_due_at IS NOT NULL AND c.sla_due_at < now()
    RETURNING c.id, c.code, c.assigned_to, c.local_body_id, c.department_id`;
  for (const [rows, tpl] of [[approaching, 'SLA_APPROACHING'], [breached, 'SLA_BREACHED']] as const) {
    for (const c of rows) {
      const recipients = await sql`
        SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id = u.role_id JOIN officials o ON o.user_id = u.id
        WHERE u.status = 'ACTIVE' AND o.local_body_id = ${c.local_body_id}
          AND (r.default_scope = 'LOCAL_BODY' OR (r.default_scope = 'DEPARTMENT' AND (o.department_id = ${c.department_id} OR o.department_id IS NULL))
               OR u.id = ${c.assigned_to})`;
      for (const r of recipients) await notify(r.id as string, tpl, { code: c.code as string }, c.id as number);
    }
  }
  return { approaching: approaching.length, breached: breached.length };
}
