import 'server-only';
import { z } from 'zod';
import { sql } from './db';
import { has, type AuthUser } from './auth';
import { audit } from './audit';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { complaintScope, assignableScope } from './scope';
import { addHistoryNote } from './workflow';
import { notify } from './notify';
import { storeEvidence } from './evidence';

/*
 * Complaint actions — concrete work items inside a complaint ("Replace streetlight", "Clear drain"),
 * each with a primary assignee and optional supporting assignees (JE + Electrician + EB Lineman …).
 * Every change is logged in complaint_action_updates (append-only) and in the audit log.
 */
export const ACTION_STATUSES = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED'] as const;
type AStatus = (typeof ACTION_STATUSES)[number];
const NEXT: Record<AStatus, AStatus[]> = {
  PENDING: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'PENDING', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ASSIGNED', 'CANCELLED'],
  COMPLETED: ['VERIFIED', 'IN_PROGRESS'],
  VERIFIED: [],
  CANCELLED: ['PENDING'],
};
const FINAL_COMPLAINT = ['CLOSED', 'REJECTED', 'DUPLICATE'];

const optId = z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : v));
const Assignee = z.object({ userId: z.string().uuid(), role: z.enum(['PRIMARY', 'SUPPORT']) });

const ActionFields = {
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  departmentId: optId,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  dueAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}/), z.literal(''), z.null()]).optional().transform((v) => (v ? new Date(v) : v === undefined ? undefined : null)),
  notes: z.string().trim().max(2000).optional().nullable(),
  assignees: z.array(Assignee).max(12),
};

export const ActionCreate = z.object({ ...ActionFields, priority: ActionFields.priority.default('MEDIUM'), assignees: ActionFields.assignees.default([]) });

// No defaults here: a field that is not sent must stay undefined so it is not treated as an edit.
export const ActionUpdate = z.object(ActionFields).partial().extend({
  status: z.enum(ACTION_STATUSES).optional(),
  note: z.string().trim().max(2000).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

async function loadComplaint(u: AuthUser, code: string) {
  const [c] = await sql`SELECT c.id, c.code, c.status, c.local_body_id, c.department_id, c.citizen_id FROM complaints c WHERE c.code = ${code} AND (${complaintScope(u)})`;
  if (!c) throw notFound('Complaint not found in your jurisdiction');
  return c;
}

async function checkAssignees(u: AuthUser, list: z.infer<typeof Assignee>[], localBodyId: number) {
  const primaries = list.filter((a) => a.role === 'PRIMARY');
  if (primaries.length > 1) throw badRequest('Only one primary assignee per action');
  const ids = [...new Set(list.map((a) => a.userId))];
  if (ids.length !== list.length) throw badRequest('The same person is listed twice');
  const others = ids.filter((id) => id !== u.id);
  if (others.length) {
    const ok = await sql`SELECT usr.id FROM users usr JOIN roles r ON r.id = usr.role_id JOIN officials o ON o.user_id = usr.id
                         WHERE usr.id IN ${sql(others)} AND ${assignableScope(u, localBodyId)}`;
    if (ok.length !== others.length) throw forbidden('You cannot assign work to one or more of these users');
  }
}

export async function listActions(complaintId: number) {
  const [actions, assignees, updates] = await Promise.all([
    sql`SELECT a.*, d.name_en AS dept_en, d.name_ta AS dept_ta, cu.full_name AS created_by_name, uu.full_name AS updated_by_name, vu.full_name AS verified_by_name
        FROM complaint_actions a LEFT JOIN departments d ON d.id = a.department_id JOIN users cu ON cu.id = a.created_by
        LEFT JOIN users uu ON uu.id = a.updated_by LEFT JOIN users vu ON vu.id = a.verified_by
        WHERE a.complaint_id = ${complaintId} ORDER BY a.created_at`,
    sql`SELECT x.action_id, x.user_id, x.assignee_role, x.assigned_at, x.removed_at, u.full_name, r.name_en AS role_en, r.name_ta AS role_ta, o.designation
        FROM complaint_action_assignees x JOIN complaint_actions a ON a.id = x.action_id JOIN users u ON u.id = x.user_id JOIN roles r ON r.id = u.role_id
        LEFT JOIN officials o ON o.user_id = u.id WHERE a.complaint_id = ${complaintId} ORDER BY x.assignee_role, x.assigned_at`,
    sql`SELECT x.*, u.full_name FROM complaint_action_updates x JOIN complaint_actions a ON a.id = x.action_id JOIN users u ON u.id = x.user_id
        WHERE a.complaint_id = ${complaintId} ORDER BY x.created_at DESC`,
  ]);
  return actions.map((a) => ({
    ...a,
    assignees: assignees.filter((x) => x.action_id === a.id && !x.removed_at),
    pastAssignees: assignees.filter((x) => x.action_id === a.id && x.removed_at),
    updates: updates.filter((x) => x.action_id === a.id),
  }));
}

export async function createAction(u: AuthUser, code: string, d: z.infer<typeof ActionCreate>) {
  if (!has(u, 'action.create')) throw forbidden();
  const c = await loadComplaint(u, code);
  if (FINAL_COMPLAINT.includes(c.status as string)) throw conflict('The complaint is closed');
  if (d.departmentId) {
    const [dep] = await sql`SELECT 1 FROM departments WHERE id = ${d.departmentId} AND local_body_id = ${c.local_body_id}`;
    if (!dep) throw badRequest('Department does not belong to this local body');
  }
  await checkAssignees(u, d.assignees, c.local_body_id as number);
  const status: AStatus = d.assignees.length ? 'ASSIGNED' : 'PENDING';
  const id = await sql.begin(async (tx) => {
    const [a] = await tx`
      INSERT INTO complaint_actions (complaint_id, title, description, department_id, priority, due_at, status, notes, created_by, updated_by)
      VALUES (${c.id}, ${d.title}, ${d.description ?? null}, ${d.departmentId ?? c.department_id}, ${d.priority}, ${d.dueAt ?? null}, ${status}, ${d.notes ?? null}, ${u.id}, ${u.id})
      RETURNING id`;
    for (const x of d.assignees) {
      await tx`INSERT INTO complaint_action_assignees (action_id, user_id, assignee_role, assigned_by) VALUES (${a.id}, ${x.userId}, ${x.role}, ${u.id})`;
    }
    await tx`INSERT INTO complaint_action_updates (action_id, user_id, from_status, to_status, note, changes)
             VALUES (${a.id}, ${u.id}, NULL, ${status}, ${d.notes ?? null}, ${tx.json({ created: true, assignees: d.assignees } as never)})`;
    return a.id as number;
  });
  await addHistoryNote(c.id as number, c.status as string, u, `Action added: ${d.title}`, false);
  for (const x of d.assignees) if (x.userId !== u.id) await notify(x.userId, 'STAFF_ASSIGNED', { code, category_en: d.title, category_ta: d.title }, c.id as number);
  await audit(u, { action: 'ACTION_CREATED', entityType: 'complaint', entityId: code,
    newValue: { actionId: id, title: d.title, priority: d.priority, dueAt: d.dueAt, departmentId: d.departmentId ?? c.department_id, status, assignees: d.assignees } });
  return { ok: true, id };
}

export async function updateAction(u: AuthUser, code: string, actionId: number, d: z.infer<typeof ActionUpdate>, photo: File | null, geo: { latitude: number | null; longitude: number | null; accuracy: number | null }) {
  const c = await loadComplaint(u, code);
  const [a] = await sql`SELECT * FROM complaint_actions WHERE id = ${actionId} AND complaint_id = ${c.id}`;
  if (!a) throw notFound('Action not found');
  const current = await sql`SELECT user_id, assignee_role FROM complaint_action_assignees WHERE action_id = ${actionId} AND removed_at IS NULL`;
  const isAssignee = current.some((x) => x.user_id === u.id);
  const canEdit = has(u, 'action.edit');
  const managerFields = (['title', 'description', 'departmentId', 'priority', 'dueAt', 'notes', 'assignees'] as const).filter((k) => d[k] !== undefined);
  if (managerFields.length && !canEdit) throw forbidden('You cannot edit this action');

  let to: AStatus | null = d.status && d.status !== a.status ? d.status : null;
  if (to) {
    if (!NEXT[a.status as AStatus].includes(to)) throw conflict(`Action cannot move from ${a.status} to ${to}`);
    if (to === 'VERIFIED') {
      if (!has(u, 'complaint.verify')) throw forbidden('Only an officer who verifies work can verify an action');
      if (isAssignee) throw forbidden('An action must be verified by someone who did not do the work');
    } else if (to === 'CANCELLED' || to === 'PENDING' || (to === 'IN_PROGRESS' && a.status === 'COMPLETED')) {
      if (!canEdit) throw forbidden();
      if (!d.reason || d.reason.length < 3) throw badRequest('err.reasonRequired');
    } else if (!canEdit && !(isAssignee && has(u, 'complaint.work'))) {
      throw forbidden('Only the assigned team can update this action');
    }
  }
  if (FINAL_COMPLAINT.includes(c.status as string) && (managerFields.length || (to && to !== 'VERIFIED'))) throw conflict('The complaint is closed');
  if (to === 'COMPLETED' && !photo && !(d.note && d.note.length >= 3)) throw badRequest('Add a completion note or photo');
  if (photo && !(has(u, 'evidence.upload') || isAssignee || canEdit)) throw forbidden();

  if (d.departmentId) {
    const [dep] = await sql`SELECT 1 FROM departments WHERE id = ${d.departmentId} AND local_body_id = ${c.local_body_id}`;
    if (!dep) throw badRequest('Department does not belong to this local body');
  }
  let added: z.infer<typeof Assignee>[] = [];
  let removed: { user_id: string; assignee_role: string }[] = [];
  let roleChanged: z.infer<typeof Assignee>[] = [];
  if (d.assignees) {
    await checkAssignees(u, d.assignees.filter((x) => !current.some((cx) => cx.user_id === x.userId)), c.local_body_id as number);
    if (d.assignees.filter((x) => x.role === 'PRIMARY').length > 1) throw badRequest('Only one primary assignee per action');
    added = d.assignees.filter((x) => !current.some((cx) => cx.user_id === x.userId));
    removed = current.filter((cx) => !d.assignees!.some((x) => x.userId === cx.user_id)) as never;
    roleChanged = d.assignees.filter((x) => current.some((cx) => cx.user_id === x.userId && cx.assignee_role !== x.role));
    if ((added.length || removed.length || roleChanged.length) && (!d.reason || d.reason.length < 3) && current.length) throw badRequest('err.reasonRequired');
    if (!to && a.status === 'PENDING' && d.assignees.length) to = 'ASSIGNED';
  }

  const evidenceId = photo ? await storeEvidence(c.id as number, 'ACTION', photo, u.id, { ...geo, capturedAt: new Date().toISOString(), source: 'CAMERA' }, null, actionId) : null;
  const set: Record<string, unknown> = {};
  const map: Record<string, string> = { title: 'title', description: 'description', departmentId: 'department_id', priority: 'priority', dueAt: 'due_at', notes: 'notes' };
  for (const [k, col] of Object.entries(map)) {
    const v = (d as Record<string, unknown>)[k];
    if (v !== undefined && String(v ?? '') !== String(a[col] ?? '')) set[col] = v;
  }
  if (to) {
    set.status = to;
    if (to === 'COMPLETED') set.completed_at = new Date();
    if (to === 'VERIFIED') { set.verified_by = u.id; set.verified_at = new Date(); }
    if (to === 'IN_PROGRESS' && a.status === 'COMPLETED') set.completed_at = null;
  }
  await sql.begin(async (tx) => {
    if (Object.keys(set).length) await tx`UPDATE complaint_actions SET ${tx({ ...set, updated_by: u.id, updated_at: new Date() })} WHERE id = ${actionId}`;
    else await tx`UPDATE complaint_actions SET updated_by = ${u.id}, updated_at = now() WHERE id = ${actionId}`;
    for (const r of removed) await tx`UPDATE complaint_action_assignees SET removed_at = now(), removed_by = ${u.id} WHERE action_id = ${actionId} AND user_id = ${r.user_id} AND removed_at IS NULL`;
    for (const r of roleChanged) {
      await tx`UPDATE complaint_action_assignees SET removed_at = now(), removed_by = ${u.id} WHERE action_id = ${actionId} AND user_id = ${r.userId} AND removed_at IS NULL`;
      await tx`INSERT INTO complaint_action_assignees (action_id, user_id, assignee_role, assigned_by) VALUES (${actionId}, ${r.userId}, ${r.role}, ${u.id})`;
    }
    for (const x of added) await tx`INSERT INTO complaint_action_assignees (action_id, user_id, assignee_role, assigned_by) VALUES (${actionId}, ${x.userId}, ${x.role}, ${u.id})`;
    await tx`INSERT INTO complaint_action_updates (action_id, user_id, from_status, to_status, note, changes, evidence_id)
             VALUES (${actionId}, ${u.id}, ${a.status}, ${to ?? a.status}, ${d.note ?? d.reason ?? null},
                     ${tx.json({ fields: Object.keys(set).filter((k) => !['status', 'completed_at', 'verified_by', 'verified_at'].includes(k)), added, removed: removed.map((r) => r.user_id), roleChanged } as never)}, ${evidenceId})`;
  });
  if (to) await addHistoryNote(c.id as number, c.status as string, u, `Action “${a.title}”: ${a.status} → ${to}${d.note ? ` — ${d.note}` : ''}`, false);
  for (const x of added) if (x.userId !== u.id) await notify(x.userId, 'STAFF_ASSIGNED', { code, category_en: a.title as string, category_ta: a.title as string }, c.id as number);
  const oldV: Record<string, unknown> = Object.fromEntries(Object.keys(set).map((k) => [k, a[k]]));
  await audit(u, { action: 'ACTION_UPDATED', entityType: 'complaint', entityId: code, reason: d.reason ?? null,
    oldValue: { actionId, ...oldV, ...(removed.length ? { removedAssignees: removed.map((r) => r.user_id) } : {}) },
    newValue: { actionId, ...set, ...(added.length ? { addedAssignees: added } : {}), ...(roleChanged.length ? { roleChanged } : {}), note: d.note ?? undefined } });
  if (evidenceId) await audit(u, { action: 'EVIDENCE_UPLOADED', entityType: 'complaint', entityId: code, newValue: { kind: 'ACTION', actionId, evidenceId } });
  return { ok: true };
}
