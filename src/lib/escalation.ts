import 'server-only';
import { sql } from './db';
import type { AuthUser } from './auth';
import { audit } from './audit';
import { notify } from './notify';
import { ESCALATION_LEVELS } from './workflow-constants';

export const ESCALATION_LABEL: Record<number, { en: string; ta: string }> = {
  1: { en: 'Supervisor', ta: 'மேற்பார்வையாளர்' },
  2: { en: 'Department Officer', ta: 'துறை அலுவலர்' },
  3: { en: 'Executive Officer', ta: 'செயல் அலுவலர்' },
  4: { en: 'Higher authority', ta: 'உயர் அதிகாரி' },
};

/** Officials who receive a complaint escalated to `level` (chain: Field staff → Supervisor → Dept officer → EO → Higher). */
async function recipients(c: { id: number; local_body_id: number; department_id: number | null }, level: number) {
  if (level >= 4) {
    return sql`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.status = 'ACTIVE' AND r.code IN ('SYSTEM_ADMIN','SUPER_ADMIN')`;
  }
  if (level === 3) {
    return sql`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id = u.role_id JOIN officials o ON o.user_id = u.id
               WHERE u.status = 'ACTIVE' AND r.default_scope = 'LOCAL_BODY' AND o.local_body_id = ${c.local_body_id}`;
  }
  const role = level === 1 ? 'SUPERVISOR' : 'DEPT_OFFICER';
  return sql`
    SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id = u.role_id JOIN officials o ON o.user_id = u.id
    WHERE u.status = 'ACTIVE' AND o.local_body_id = ${c.local_body_id} AND r.code = ${role}
      AND (o.department_id = ${c.department_id} OR o.department_id IS NULL)
    UNION
    SELECT a.assigned_to FROM assignments a JOIN users u ON u.id = a.assigned_to
    WHERE ${level === 1} AND a.complaint_id = ${c.id} AND a.assignee_role = 'SUPERVISOR' AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS') AND u.status = 'ACTIVE'`;
}

/**
 * Raise a complaint's escalation level (never lowers it), record history + audit and notify the officials
 * at the new level. If nobody holds that level in the jurisdiction, the next level up is notified too.
 * `actor` null = automatic (SLA breach).
 */
export async function escalateComplaint(complaintId: number, actor: AuthUser | null, reason: string, targetLevel?: number) {
  const [c] = await sql`SELECT id, code, status, local_body_id, department_id, escalation_level FROM complaints WHERE id = ${complaintId}`;
  if (!c) return null;
  const from = c.escalation_level as number;
  const to = Math.min(4, Math.max(from + 1, targetLevel ?? from + 1));
  if (to <= from) return null;
  const res = await sql`UPDATE complaints SET escalation_level = ${to}, escalated = true, escalated_at = now(), escalation_note = ${reason}, updated_at = now()
                        WHERE id = ${complaintId} AND escalation_level = ${from} RETURNING id`;
  if (!res.length) return null; // someone else escalated it meanwhile
  const label = ESCALATION_LABEL[to];
  await sql`
    INSERT INTO complaint_status_history (complaint_id, from_status, to_status, actor_id, actor_label, note, public_note)
    VALUES (${complaintId}, ${c.status}, ${c.status}, ${actor?.id ?? null}, ${actor ? `${actor.fullName} (${actor.roleNameEn})` : 'System'},
            ${`Escalated to level ${to} (${label.en}): ${reason}`}, false)`;
  await audit(actor, {
    action: actor ? 'COMPLAINT_ESCALATED' : 'COMPLAINT_AUTO_ESCALATED', entityType: 'complaint', entityId: c.code as string, reason,
    oldValue: { escalationLevel: from, level: ESCALATION_LEVELS[from] }, newValue: { escalationLevel: to, level: ESCALATION_LEVELS[to] },
  });
  const cc = { id: complaintId, local_body_id: c.local_body_id as number, department_id: c.department_id as number | null };
  let people = await recipients(cc, to);
  for (let lvl = to + 1; !people.length && lvl <= 4; lvl++) people = await recipients(cc, lvl);
  for (const p of people) {
    if (p.id === actor?.id) continue;
    await notify(p.id as string, 'ESCALATED_TO_YOU', { code: c.code as string, level: `${to} – ${label.en}`, reason }, complaintId);
  }
  return { from, to };
}
