import 'server-only';
import { sql } from './db';
import { AUDIT_LABELS } from './audit-labels';
import type { AuthUser } from './auth';

/**
 * Filters for the business audit log. Login / logout events live in security_logs and never appear here.
 * Only a Super Admin sees Super Admin activity (as actor or as the affected user).
 */
export function auditWhere(f: Record<string, string | undefined>, viewer?: AuthUser) {
  const parts = [sql`a.action NOT LIKE 'auth.%'`];
  if (!viewer || viewer.role !== 'SUPER_ADMIN') {
    parts.push(sql`a.actor_role IS DISTINCT FROM 'SUPER_ADMIN'`);
    parts.push(sql`NOT EXISTS (SELECT 1 FROM users x JOIN roles xr ON xr.id = x.role_id WHERE x.id = a.target_user_id AND xr.code = 'SUPER_ADMIN')`);
  }
  if (f.action) parts.push(sql`a.action ILIKE ${`%${f.action.slice(0, 60)}%`}`);
  if (f.group) {
    const codes = Object.entries(AUDIT_LABELS).filter(([, v]) => v.group === f.group).map(([k]) => k);
    if (codes.length) parts.push(sql`a.action IN ${sql(codes)}`);
  }
  if (f.entity) parts.push(sql`a.entity_type = ${f.entity}`);
  if (f.actor) parts.push(sql`EXISTS (SELECT 1 FROM users x WHERE x.id = a.actor_id AND (x.username ILIKE ${`%${f.actor.slice(0, 60)}%`} OR x.full_name ILIKE ${`%${f.actor.slice(0, 60)}%`}))`);
  if (f.target) parts.push(sql`EXISTS (SELECT 1 FROM users x WHERE x.id = a.target_user_id AND (x.username ILIKE ${`%${f.target.slice(0, 60)}%`} OR x.full_name ILIKE ${`%${f.target.slice(0, 60)}%`}))`);
  if (f.ref) parts.push(sql`a.entity_id = ${f.ref}`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) parts.push(sql`a.created_at >= ${f.from}::date`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) parts.push(sql`a.created_at < ${f.to}::date + 1`);
  return parts.reduce((x, y) => sql`${x} AND ${y}`);
}
