import { sql } from './db';
import { requestMeta, type AuthUser } from './auth';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  targetUserId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

// Keys whose values must never reach the audit log (passwords, hashes, tokens, secrets).
const SECRET_KEY = /pass(word)?|pwd|hash|token|secret|otp/i;

/** Deep-copy a value with every secret-looking key removed. */
export function redact(v: unknown, depth = 0): unknown {
  if (v == null || depth > 6) return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = redact(x, depth + 1);
    }
    return out;
  }
  return v;
}

/** Append-only business audit log (UPDATE/DELETE are blocked by a DB trigger). Login/logout go to security_logs instead. */
export async function audit(actor: Pick<AuthUser, 'id' | 'role'> | null, input: AuditInput) {
  let meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null };
  try {
    meta = await requestMeta();
  } catch {
    /* outside a request (cron / scripts) */
  }
  const oldValue = input.oldValue === undefined ? undefined : redact(input.oldValue);
  const newValue = input.newValue === undefined ? undefined : redact(input.newValue);
  await sql`
    INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, target_user_id, old_value, new_value, ip_address, user_agent, reason)
    VALUES (${actor?.id ?? null}, ${actor?.role ?? 'SYSTEM'}, ${input.action}, ${input.entityType},
            ${input.entityId != null ? String(input.entityId) : null}, ${input.targetUserId ?? null},
            ${oldValue === undefined ? null : sql.json(oldValue as never)},
            ${newValue === undefined ? null : sql.json(newValue as never)},
            ${meta.ip}, ${meta.userAgent}, ${input.reason?.slice(0, 1000) ?? null})`;
}

/** Authentication / session events — kept out of the business audit log. */
export async function securityLog(event: string, opts: { userId?: string | null; identifier?: string | null; portal?: string | null; detail?: unknown } = {}) {
  let meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null };
  try {
    meta = await requestMeta();
  } catch {
    /* outside a request */
  }
  await sql`
    INSERT INTO security_logs (user_id, identifier, event, portal, ip_address, user_agent, detail)
    VALUES (${opts.userId ?? null}, ${opts.identifier?.slice(0, 80) ?? null}, ${event}, ${opts.portal ?? null}, ${meta.ip}, ${meta.userAgent},
            ${opts.detail === undefined ? null : sql.json(redact(opts.detail) as never)})`;
}
