import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { auditWhere } from '@/lib/audit-query';

const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export const GET = route(async (req) => {
  const u = await requireApiUser('ADMIN', 'audit.view');
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const rows = await sql`
    SELECT a.created_at, a.actor_role, au.username AS actor, a.action, a.entity_type, a.entity_id, tu.username AS target, a.old_value, a.new_value, a.ip_address, a.user_agent
    FROM audit_logs a LEFT JOIN users au ON au.id = a.actor_id LEFT JOIN users tu ON tu.id = a.target_user_id
    WHERE ${auditWhere(sp)} ORDER BY a.created_at DESC LIMIT 20000`;
  const head = ['time', 'actor_role', 'actor', 'action', 'entity_type', 'entity_id', 'target_user', 'old_value', 'new_value', 'ip', 'user_agent'];
  const csv = [head.join(','), ...rows.map((r) => [r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, r.actor_role, r.actor, r.action, r.entity_type, r.entity_id, r.target, r.old_value, r.new_value, r.ip_address, r.user_agent].map(esc).join(','))].join('\n');
  await audit(u, { action: 'audit.export', entityType: 'audit_logs', newValue: { rows: rows.length, filters: sp } });
  return new Response('﻿' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit_log.csv"' } });
});
