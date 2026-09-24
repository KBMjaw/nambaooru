import { sql } from './db';
import { requestMeta, type AuthUser } from './auth';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  targetUserId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Append-only audit log (UPDATE/DELETE are blocked by a DB trigger). */
export async function audit(actor: Pick<AuthUser, 'id' | 'role'> | null, input: AuditInput) {
  let meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null };
  try {
    meta = await requestMeta();
  } catch {
    /* outside a request (cron / scripts) */
  }
  await sql`
    INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, target_user_id, old_value, new_value, ip_address, user_agent)
    VALUES (${actor?.id ?? null}, ${actor?.role ?? 'SYSTEM'}, ${input.action}, ${input.entityType},
            ${input.entityId != null ? String(input.entityId) : null}, ${input.targetUserId ?? null},
            ${input.oldValue === undefined ? null : sql.json(input.oldValue as never)},
            ${input.newValue === undefined ? null : sql.json(input.newValue as never)},
            ${meta.ip}, ${meta.userAgent})`;
}
