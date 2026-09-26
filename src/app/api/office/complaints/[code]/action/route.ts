import { z } from 'zod';
import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiStaffFor, has, type AuthUser } from '@/lib/auth';
import { complaintScope, assignableScope } from '@/lib/scope';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { badRequest, forbidden, notFound, conflict } from '@/lib/errors';
import { transition, addHistoryNote, REASON_LABEL, REJECTION_REASONS } from '@/lib/workflow';
import { HOLD_REASONS } from '@/lib/workflow-constants';
import { storeEvidence, validateFile, num } from '@/lib/evidence';
import { escalateComplaint } from '@/lib/escalation';
import { routeComplaint } from '@/lib/routing';
import { notify } from '@/lib/notify';
import { notifyOfficials } from '@/lib/complaints';

const OUTCOMES = ['VERIFIED', 'NOT_FOUND', 'DUPLICATE', 'ALREADY_RESOLVED', 'INVALID', 'REQUIRES_HIGHER_AUTHORITY'] as const;
export const HOLD_LABEL: Record<string, { en: string; ta: string }> = {
  MATERIAL_UNAVAILABLE: { en: 'Material unavailable', ta: 'பொருள் கிடைக்கவில்லை' },
  WEATHER: { en: 'Weather', ta: 'வானிலை' },
  PERMISSION_REQUIRED: { en: 'Permission required', ta: 'அனுமதி தேவை' },
  EXTERNAL_AGENCY: { en: 'Waiting for external agency', ta: 'வெளி நிறுவனத்திற்காகக் காத்திருப்பு' },
  SAFETY: { en: 'Safety issue', ta: 'பாதுகாப்புப் பிரச்சினை' },
  OTHER: { en: 'Other', ta: 'பிற' },
};
const ACTIVE_A = ['PENDING', 'ACCEPTED', 'IN_PROGRESS'];
/** Statuses in which a complaint may be finished with a resolution type (reject / duplicate). */
const RESOLVABLE = ['AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW', 'SITE_INSPECTION', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED', 'VERIFICATION_PENDING'];
const FINAL_S = ['CLOSED', 'REJECTED', 'DUPLICATE'];

type Ctx = { params: Promise<{ code: string }> };

/**
 * Single endpoint for every official workflow action. Each action checks, on the server:
 *   1. the permission (RBAC), 2. jurisdiction scope for this complaint, 3. the current status,
 *   4. identity where needed (e.g. only the assigned worker can start/complete work).
 */
export const POST = route<Ctx>(async (req, { params }) => {
  // Officer portal by default; the admin portal passes ?portal=ADMIN. Permissions decide what each user may do.
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'));
  await rateLimit(`action:${u.id}`, 120, 300);
  const { code } = await params;

  const ct = req.headers.get('content-type') ?? '';
  let data: Record<string, unknown> = {};
  let photos: File[] = [];
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    data = JSON.parse(String(fd.get('data') ?? '{}'));
    photos = fd.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);
    if (photos.length > 5) throw badRequest('At most 5 photos per update');
    // Validate every file before anything is written, so a bad file never leaves a half-done action
    for (const f of photos) await validateFile(f);
  } else {
    data = await req.json().catch(() => ({}));
  }
  const photo: File | null = photos[0] ?? null;
  const action = z.string().parse(data.action);

  const [c] = await sql`SELECT c.*, cat.inspection_required, cat.name_en AS cat_en, cat.name_ta AS cat_ta
                        FROM complaints c LEFT JOIN complaint_categories cat ON cat.id = c.category_id
                        WHERE c.code = ${code} AND (${complaintScope(u)})`;
  if (!c) throw notFound('Complaint not found in your jurisdiction');
  const id = c.id as number;
  const need = (perm: string) => { if (!has(u, perm)) throw forbidden(); };
  const requireStatus = (...s: string[]) => { if (!s.includes(c.status as string)) throw conflict(`Action not allowed while complaint is ${c.status}`); };
  const geo = { latitude: num(data.latitude as never), longitude: num(data.longitude as never), accuracy: num(data.accuracy as never) };
  const status = c.status as string;
  const catVars = { code, category_en: c.cat_en as string, category_ta: c.cat_ta as string };
  /** Store every uploaded photo as evidence of `kind`; returns the ids (first = main). */
  const storeAll = async (kind: Parameters<typeof storeEvidence>[1]) => {
    const ids: number[] = [];
    for (const f of photos) ids.push(await storeEvidence(id, kind, f, u.id, { ...geo, capturedAt: new Date().toISOString(), source: 'CAMERA' }) as number);
    if (ids.length) await audit(u, { action: 'EVIDENCE_UPLOADED', entityType: 'complaint', entityId: code, newValue: { kind, evidenceIds: ids } });
    return ids;
  };
  /** Active supervisors on this complaint (they hear about holds, completions and escalations). */
  const supervisors = async () => (await sql`SELECT assigned_to FROM assignments WHERE complaint_id = ${id} AND purpose = 'WORK' AND assignee_role = 'SUPERVISOR' AND status IN ${sql(ACTIVE_A)}`).map((r) => r.assigned_to as string);

  switch (action) {
    case 'review': {
      need('complaint.review');
      requireStatus('AI_CLASSIFIED', 'REOPENED', 'SUBMITTED');
      await transition(id, 'INITIAL_REVIEW', u, { note: str(data.note) });
      break;
    }

    case 'schedule_inspection': {
      need('complaint.schedule_inspection');
      requireStatus('AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW', 'SITE_INSPECTION');
      const inspectorId = z.string().uuid().parse(data.inspectorId);
      const inspector = await assignableUser(u, inspectorId, true, c.local_body_id as number);
      const due = data.dueAt ? new Date(String(data.dueAt)) : null;
      await sql`UPDATE assignments SET status = 'REASSIGNED' WHERE complaint_id = ${id} AND purpose = 'INSPECTION' AND status IN ('PENDING','ACCEPTED','IN_PROGRESS')`;
      await sql`INSERT INTO assignments (complaint_id, assigned_to, assigned_by, department_id, purpose, priority, due_at, note)
                VALUES (${id}, ${inspectorId}, ${u.id}, ${c.department_id}, 'INSPECTION', ${c.priority}, ${due}, ${str(data.note)})`;
      await transition(id, 'SITE_INSPECTION', u, { note: str(data.note), set: { inspector_id: inspectorId, inspection_outcome: null } });
      if (inspectorId !== u.id) await notify(inspectorId, 'INSPECTION_ASSIGNED', { code, category_en: c.cat_en as string, category_ta: c.cat_ta as string }, id);
      await audit(u, { action: 'INSPECTION_SCHEDULED', entityType: 'complaint', entityId: code, targetUserId: inspectorId, newValue: { inspector: inspector.full_name, due } });
      break;
    }

    case 'inspect': {
      need('complaint.inspect');
      requireStatus('SITE_INSPECTION');
      if (u.scope === 'ASSIGNED' && c.inspector_id !== u.id) throw forbidden('Only the assigned inspector can record this inspection');
      const outcome = z.enum(OUTCOMES).parse(data.outcome);
      const notes = z.string().trim().min(3).max(2000).parse(data.notes);
      if (geo.latitude == null || geo.longitude == null) throw badRequest('field.needLocation');
      if (!photo) throw badRequest('Inspection photo is required');
      const evidenceId = await storeEvidence(id, 'INSPECTION', photo, u.id, { ...geo, capturedAt: new Date().toISOString(), source: 'CAMERA' });
      await sql`INSERT INTO inspections (complaint_id, inspector_id, outcome, notes, latitude, longitude, gps_accuracy_m, evidence_id)
                VALUES (${id}, ${u.id}, ${outcome}, ${notes}, ${geo.latitude}, ${geo.longitude}, ${geo.accuracy}, ${evidenceId})`;
      await sql`UPDATE assignments SET status = 'COMPLETED', completed_at = now() WHERE complaint_id = ${id} AND purpose = 'INSPECTION' AND status IN ('PENDING','ACCEPTED','IN_PROGRESS')`;
      await audit(u, { action: 'INSPECTION_COMPLETED', entityType: 'complaint', entityId: code, newValue: { outcome, notes, lat: geo.latitude, lng: geo.longitude, evidenceId } });
      if (outcome === 'VERIFIED') {
        await transition(id, 'VERIFIED', u, { note: `Site inspection: issue verified. ${notes}`, set: { inspection_outcome: outcome } });
      } else {
        // Negative outcomes are recorded; an authorised officer takes the final decision (reject / duplicate / escalate).
        const escalate = outcome === 'REQUIRES_HIGHER_AUTHORITY';
        await sql`UPDATE complaints SET inspection_outcome = ${outcome}, updated_at = now() WHERE id = ${id}`;
        await addHistoryNote(id, c.status as string, u, `Site inspection outcome: ${outcome.replace(/_/g, ' ').toLowerCase()}. ${notes}`, false);
        if (escalate) await escalateComplaint(id, u, `Inspection: requires higher authority. ${notes}`);
        else await notifyOfficials(id, 'WORK_REVIEW', {}, { includeWardMember: false });
      }
      break;
    }

    case 'verify_direct': {
      need('complaint.review');
      requireStatus('INITIAL_REVIEW');
      if (c.inspection_required) throw badRequest('Site inspection is mandatory for this category');
      await transition(id, 'VERIFIED', u, { note: str(data.note) ?? 'Verified without site inspection (not required for this category)' });
      break;
    }

    case 'classify': {
      // Classification (category / issue type) and department routing. Officers have the final say over the system's suggestion.
      if (FINAL_S.includes(status)) throw conflict(`Action not allowed while complaint is ${status}`);
      const categoryId = data.categoryId != null && data.categoryId !== '' ? z.coerce.number().int().parse(data.categoryId) : (c.category_id as number);
      const issueTypeId = data.issueTypeId != null && data.issueTypeId !== '' ? z.coerce.number().int().parse(data.issueTypeId) : null;
      const departmentId = data.departmentId != null && data.departmentId !== '' ? z.coerce.number().int().parse(data.departmentId) : null;
      const note = str(data.note);
      const catChanged = categoryId !== c.category_id;
      const issueChanged = issueTypeId !== (c.issue_type_id ?? null) && !(issueTypeId == null && !catChanged);
      const deptChanged = departmentId != null && departmentId !== c.department_id;
      if (!catChanged && !issueChanged && !deptChanged) throw badRequest('Nothing to change');
      if (catChanged || issueChanged) need('complaint.review');
      if (deptChanged) need('complaint.assign');
      const [cat] = await sql`SELECT id, name_en, name_ta FROM complaint_categories WHERE id = ${categoryId} AND status = 'ACTIVE'`;
      if (!cat) throw badRequest('Unknown category');
      if (issueTypeId != null) {
        const [it] = await sql`SELECT 1 FROM complaint_issue_types WHERE id = ${issueTypeId} AND category_id = ${categoryId} AND status = 'ACTIVE'`;
        if (!it) throw badRequest('Issue type does not belong to this category');
      }
      let dept: Record<string, unknown> | undefined;
      if (deptChanged) {
        [dept] = await sql`SELECT id, name_en, name_ta FROM departments WHERE id = ${departmentId} AND local_body_id = ${c.local_body_id} AND status = 'ACTIVE'`;
        if (!dept) throw badRequest('Department is not part of this local body');
      }
      const suggested = catChanged ? (await routeComplaint(c.local_body_id as number, categoryId, (c.ward_id as number | null) ?? null)).departmentId : (c.suggested_department_id as number | null);
      await sql`UPDATE complaints SET category_id = ${categoryId}, issue_type_id = ${catChanged && !issueChanged ? null : issueTypeId}, suggested_department_id = ${suggested},
                  ${deptChanged ? sql`department_id = ${departmentId}, department_assigned_by = ${u.id}, department_assigned_at = now(),` : sql``} updated_at = now()
                WHERE id = ${id}`;
      const [names] = await sql`SELECT cat.name_en AS cat, it.name_en AS issue, d.name_en AS dept, d.name_ta AS dept_ta FROM complaints c2
                                LEFT JOIN complaint_categories cat ON cat.id = c2.category_id LEFT JOIN complaint_issue_types it ON it.id = c2.issue_type_id
                                LEFT JOIN departments d ON d.id = c2.department_id WHERE c2.id = ${id}`;
      const parts = [catChanged || issueChanged ? `Classified as ${names.cat}${names.issue ? ` › ${names.issue}` : ''}` : null, deptChanged ? `Department assigned: ${names.dept}` : null].filter(Boolean);
      await addHistoryNote(id, status, u, `${parts.join('. ')}${note ? ` — ${note}` : ''}`, true);
      await audit(u, { action: 'COMPLAINT_CLASSIFIED', entityType: 'complaint', entityId: code, reason: note,
        oldValue: { categoryId: c.category_id, issueTypeId: c.issue_type_id, departmentId: c.department_id },
        newValue: { categoryId, issueTypeId, departmentId: deptChanged ? departmentId : c.department_id, suggestedDepartmentId: suggested } });
      await notify(c.citizen_id as string, 'CLASSIFIED', { code, category_en: cat.name_en as string, category_ta: cat.name_ta as string, department: (names.dept as string) ?? '' }, id);
      if (deptChanged) await notifyOfficials(id, 'DEPARTMENT_ASSIGNED', { department: (dept!.name_en as string) }, { includeWardMember: false });
      break;
    }

    case 'assign_supervisor': {
      need('complaint.assign');
      if (FINAL_S.includes(status)) throw conflict(`Action not allowed while complaint is ${status}`);
      const userId = z.string().uuid().parse(data.userId);
      const who = await supervisorCandidate(u, userId, c.local_body_id as number);
      const prev = await sql`UPDATE assignments SET status = 'REASSIGNED' WHERE complaint_id = ${id} AND purpose = 'WORK' AND assignee_role = 'SUPERVISOR' AND status IN ${sql(ACTIVE_A)} RETURNING assigned_to`;
      await sql`INSERT INTO assignments (complaint_id, assigned_to, assigned_by, department_id, purpose, priority, due_at, note, assignee_role, status)
                VALUES (${id}, ${userId}, ${u.id}, ${who.department_id ?? c.department_id}, 'WORK', ${c.priority}, ${c.sla_due_at}, ${str(data.note)}, 'SUPERVISOR', 'ACCEPTED')`;
      await addHistoryNote(id, status, u, `Supervisor assigned: ${who.full_name}${str(data.note) ? ` — ${str(data.note)}` : ''}`, false);
      await audit(u, { action: 'SUPERVISOR_ASSIGNED', entityType: 'complaint', entityId: code, targetUserId: userId,
        oldValue: { supervisor: prev.map((p) => p.assigned_to) }, newValue: { supervisor: userId } });
      if (userId !== u.id) await notify(userId, 'SUPERVISOR_ASSIGNED', catVars, id);
      break;
    }

    case 'assign':
    case 'reassign': {
      const reassign = action === 'reassign';
      need(reassign ? 'complaint.reassign' : 'complaint.assign');
      requireStatus(...(reassign ? ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED'] : ['VERIFIED']));
      const assigneeId = z.string().uuid().parse(data.assigneeId);
      const supportIds = [...new Set(z.array(z.string().uuid()).max(10).parse(data.supportIds ?? []))].filter((x) => x !== assigneeId);
      const assignee = await assignableUser(u, assigneeId, false, c.local_body_id as number);
      const supervisorId = data.supervisorId ? z.string().uuid().parse(data.supervisorId) : null;
      const supervisor = supervisorId ? await supervisorCandidate(u, supervisorId, c.local_body_id as number) : null;
      const supporters: { id: string; full_name: string; department_id: number | null }[] = [];
      for (const sid of supportIds) {
        const s = await assignableUser(u, sid, false, c.local_body_id as number);
        supporters.push({ id: sid, full_name: s.full_name as string, department_id: (s.department_id as number | null) ?? null });
      }
      const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).parse(data.priority ?? c.priority);
      const due = data.dueAt ? new Date(String(data.dueAt)) : (c.sla_due_at as Date | null);
      if (reassign && !str(data.note)) throw badRequest('err.reasonRequired');
      // Field team is replaced; the supervisor stays unless a new one is chosen
      const prev = await sql`UPDATE assignments SET status = 'REASSIGNED' WHERE complaint_id = ${id} AND purpose = 'WORK' AND status IN ${sql(ACTIVE_A)}
                             AND (assignee_role <> 'SUPERVISOR' OR ${!!supervisorId}) RETURNING assigned_to, assignee_role`;
      await sql`INSERT INTO assignments (complaint_id, assigned_to, assigned_by, department_id, purpose, priority, due_at, note, assignee_role)
                VALUES (${id}, ${assigneeId}, ${u.id}, ${assignee.department_id ?? c.department_id}, 'WORK', ${priority}, ${due}, ${str(data.note)}, 'PRIMARY')`;
      for (const sp of supporters) {
        await sql`INSERT INTO assignments (complaint_id, assigned_to, assigned_by, department_id, purpose, priority, due_at, note, assignee_role)
                  VALUES (${id}, ${sp.id}, ${u.id}, ${sp.department_id ?? c.department_id}, 'WORK', ${priority}, ${due}, ${str(data.note)}, 'SUPPORT')`;
      }
      if (supervisor) {
        await sql`INSERT INTO assignments (complaint_id, assigned_to, assigned_by, department_id, purpose, priority, due_at, note, assignee_role, status)
                  VALUES (${id}, ${supervisorId}, ${u.id}, ${supervisor.department_id ?? c.department_id}, 'WORK', ${priority}, ${due}, ${str(data.note)}, 'SUPERVISOR', 'ACCEPTED')`;
      }
      const team = [assignee.full_name, ...supporters.map((x) => x.full_name)].join(', ') + (supervisor ? `; supervisor ${supervisor.full_name}` : '');
      await transition(id, 'ASSIGNED', u, {
        note: `${reassign ? 'Reassigned' : 'Assigned'} to ${team}${data.note ? ` — ${str(data.note)}` : ''}`,
        set: { assigned_to: assigneeId, priority, department_id: assignee.department_id ?? c.department_id },
        skipCitizenNotify: reassign,
      });
      for (const uid of [assigneeId, ...supportIds]) await notify(uid, 'STAFF_ASSIGNED', catVars, id);
      if (supervisorId && supervisorId !== u.id) await notify(supervisorId, 'SUPERVISOR_ASSIGNED', catVars, id);
      await audit(u, { action: reassign ? 'COMPLAINT_REASSIGNED' : 'COMPLAINT_ASSIGNED', entityType: 'complaint', entityId: code, targetUserId: assigneeId, reason: reassign ? str(data.note) : null,
        oldValue: { team: prev.map((p) => ({ user: p.assigned_to, role: p.assignee_role })) },
        newValue: { primary: assigneeId, supporting: supportIds, supervisor: supervisorId, priority, due } });
      if (supervisorId) await audit(u, { action: 'SUPERVISOR_ASSIGNED', entityType: 'complaint', entityId: code, targetUserId: supervisorId, newValue: { supervisor: supervisorId } });
      break;
    }

    case 'add_support':
    case 'remove_support': {
      need('complaint.reassign');
      requireStatus('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED');
      const userId = z.string().uuid().parse(data.userId);
      if (action === 'add_support') {
        const who = await assignableUser(u, userId, false, c.local_body_id as number);
        const [dup] = await sql`SELECT 1 FROM assignments WHERE complaint_id = ${id} AND purpose = 'WORK' AND assigned_to = ${userId} AND status IN ('PENDING','ACCEPTED','IN_PROGRESS')`;
        if (dup) throw conflict('Already on this complaint');
        const [p] = await sql`SELECT priority, due_at FROM assignments WHERE complaint_id = ${id} AND purpose = 'WORK' AND assignee_role = 'PRIMARY' AND status IN ('PENDING','ACCEPTED','IN_PROGRESS') ORDER BY created_at DESC LIMIT 1`;
        await sql`INSERT INTO assignments (complaint_id, assigned_to, assigned_by, department_id, purpose, priority, due_at, note, assignee_role)
                  VALUES (${id}, ${userId}, ${u.id}, ${who.department_id ?? c.department_id}, 'WORK', ${p?.priority ?? c.priority}, ${p?.due_at ?? c.sla_due_at}, ${str(data.note)}, 'SUPPORT')`;
        await addHistoryNote(id, c.status as string, u, `Supporting assignee added: ${who.full_name}`, false);
        await notify(userId, 'STAFF_ASSIGNED', { code, category_en: c.cat_en as string, category_ta: c.cat_ta as string }, id);
        await audit(u, { action: 'COMPLAINT_ASSIGNED', entityType: 'complaint', entityId: code, targetUserId: userId, newValue: { supporting: [userId], added: true } });
      } else {
        const r = await sql`UPDATE assignments SET status = 'CANCELLED' WHERE complaint_id = ${id} AND purpose = 'WORK' AND assigned_to = ${userId}
                            AND assignee_role = 'SUPPORT' AND status IN ('PENDING','ACCEPTED','IN_PROGRESS') RETURNING id`;
        if (!r.length) throw badRequest('Not a supporting assignee on this complaint');
        const reason = z.string().trim().min(3, 'err.reasonRequired').max(500).parse(data.note);
        await addHistoryNote(id, c.status as string, u, `Supporting assignee removed: ${reason}`, false);
        await audit(u, { action: 'COMPLAINT_REASSIGNED', entityType: 'complaint', entityId: code, targetUserId: userId, reason, oldValue: { supporting: [userId] }, newValue: { removed: true } });
      }
      break;
    }

    case 'reopen': {
      need('complaint.reopen');
      requireStatus('CLOSED', 'REJECTED', 'DUPLICATE');
      const reason = z.string().trim().min(5, 'err.reasonRequired').max(1000).parse(data.note);
      await transition(id, 'REOPENED', u, { note: `Reopened: ${reason}`, set: { rejection_reason: null, rejection_notes: null, duplicate_of_id: null, closed_at: null, inspection_outcome: null } });
      break;
    }

    case 'accept':
    case 'start':
    case 'progress':
    case 'note':
    case 'complete':
    case 'report_no_issue': {
      need('complaint.work');
      // Primary and supporting assignees can all report on the work (supervisors oversee, they do not report field work)
      const [a] = await sql`SELECT * FROM assignments WHERE complaint_id = ${id} AND purpose = 'WORK' AND assigned_to = ${u.id} AND assignee_role IN ('PRIMARY','SUPPORT')
                            AND status IN ${sql(ACTIVE_A)} ORDER BY (assignee_role = 'PRIMARY') DESC, created_at DESC LIMIT 1`;
      if (!a) throw forbidden('This work is not assigned to you');
      if (action === 'accept') {
        requireStatus('ASSIGNED', 'REWORK_REQUIRED');
        if (a.status !== 'PENDING') throw conflict('Already accepted');
        await sql`UPDATE assignments SET status = 'ACCEPTED', accepted_at = now() WHERE id = ${a.id}`;
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes) VALUES (${id}, ${a.id}, ${u.id}, 'ACCEPTED', ${str(data.note)})`;
        await addHistoryNote(id, status, u, 'Work accepted by field staff', true);
        await audit(u, { action: 'WORK_ACCEPTED', entityType: 'complaint', entityId: code, newValue: { role: a.assignee_role } });
      } else if (action === 'start') {
        // Also restarts work after verification asked for rework
        requireStatus('ASSIGNED', 'REWORK_REQUIRED');
        const before = await storeAll('BEFORE_WORK');
        await sql`UPDATE assignments SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, now()), accepted_at = COALESCE(accepted_at, now())
                  WHERE complaint_id = ${id} AND purpose = 'WORK' AND assignee_role IN ('PRIMARY','SUPPORT') AND status IN ('PENDING','ACCEPTED')`;
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes, evidence_id, latitude, longitude)
                  VALUES (${id}, ${a.id}, ${u.id}, 'STARTED', ${str(data.note) ?? (status === 'REWORK_REQUIRED' ? 'Rework started' : null)}, ${before[0] ?? null}, ${geo.latitude}, ${geo.longitude})`;
        await transition(id, 'IN_PROGRESS', u, { note: str(data.note) ?? (status === 'REWORK_REQUIRED' ? 'Rework started' : 'Work started'), auditAction: 'WORK_STARTED' });
      } else if (action === 'progress') {
        requireStatus('IN_PROGRESS');
        const notes = z.string().trim().min(2).max(2000).parse(data.notes);
        const pct = z.coerce.number().int().min(0).max(100).parse(data.progress ?? 50);
        const ids = await storeAll('PROGRESS');
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes, progress_pct, evidence_id, latitude, longitude)
                  VALUES (${id}, ${a.id}, ${u.id}, 'PROGRESS', ${notes}, ${pct}, ${ids[0] ?? null}, ${geo.latitude}, ${geo.longitude})`;
        await addHistoryNote(id, 'IN_PROGRESS', u, `Progress ${pct}%: ${notes}`, true);
        await notify(c.citizen_id as string, 'PROGRESS', { code }, id);
        await audit(u, { action: 'PROGRESS_UPDATED', entityType: 'complaint', entityId: code, newValue: { pct, notes, evidenceIds: ids } });
      } else if (action === 'note') {
        requireStatus('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED');
        const notes = z.string().trim().min(2).max(2000).parse(data.notes);
        const ids = await storeAll('PROGRESS');
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes, evidence_id, latitude, longitude)
                  VALUES (${id}, ${a.id}, ${u.id}, 'NOTE', ${notes}, ${ids[0] ?? null}, ${geo.latitude}, ${geo.longitude})`;
        await addHistoryNote(id, status, u, `Field note: ${notes}`, false);
        await audit(u, { action: 'WORK_NOTE_ADDED', entityType: 'complaint', entityId: code, newValue: { notes, evidenceIds: ids } });
      } else {
        const noIssue = action === 'report_no_issue';
        requireStatus(...(noIssue ? ['ASSIGNED', 'IN_PROGRESS'] : ['IN_PROGRESS']));
        const notes = z.string().trim().min(noIssue ? 5 : 3).max(2000).parse(data.notes);
        if (!photos.length) throw badRequest(noIssue ? 'Site photo is required' : 'field.completionPhoto');
        if (geo.latitude == null || geo.longitude == null) throw badRequest('field.needLocation');
        // Field evidence is stored separately from the citizen's evidence and never replaces it
        const ids = await storeAll(noIssue ? 'INSPECTION' : 'COMPLETION');
        await sql`INSERT INTO completion_evidence (complaint_id, assignment_id, evidence_id, notes, latitude, longitude, gps_accuracy_m, completed_by, proposed_resolution)
                  VALUES (${id}, ${a.id}, ${ids[0]}, ${notes}, ${geo.latitude}, ${geo.longitude}, ${geo.accuracy}, ${u.id}, ${noIssue ? 'NO_ISSUE_FOUND' : 'RESOLVED'})`;
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes, progress_pct, evidence_id, latitude, longitude)
                  VALUES (${id}, ${a.id}, ${u.id}, ${noIssue ? 'NO_ISSUE' : 'COMPLETED'}, ${notes}, ${noIssue ? null : 100}, ${ids[0]}, ${geo.latitude}, ${geo.longitude})`;
        await sql`UPDATE assignments SET status = 'COMPLETED', completed_at = now() WHERE complaint_id = ${id} AND purpose = 'WORK' AND assignee_role IN ('PRIMARY','SUPPORT') AND status IN ${sql(ACTIVE_A)}`;
        if (noIssue) {
          await transition(id, 'VERIFICATION_PENDING', u, { note: `Field report — no issue found: ${notes}`, publicNote: false, skipCitizenNotify: true, auditAction: 'NO_ISSUE_REPORTED' });
          await notifyOfficials(id, 'NO_ISSUE_REPORTED', {}, { includeWardMember: false });
        } else {
          const submit = data.submit !== false; // "Submit for verification" is on by default
          await transition(id, 'WORK_COMPLETED', u, { note: notes, skipCitizenNotify: submit, auditAction: 'WORK_COMPLETED' });
          if (submit) {
            await transition(id, 'VERIFICATION_PENDING', u, { note: 'Submitted for verification' });
            await notifyOfficials(id, 'WORK_REVIEW', {}, { includeWardMember: false });
          }
        }
        for (const s of await supervisors()) await notify(s, noIssue ? 'NO_ISSUE_REPORTED' : 'WORK_REVIEW', catVars, id);
      }
      break;
    }

    case 'submit_verification': {
      requireStatus('WORK_COMPLETED');
      const [mine] = await sql`SELECT 1 FROM assignments WHERE complaint_id = ${id} AND purpose = 'WORK' AND assigned_to = ${u.id} AND assignee_role IN ('PRIMARY','SUPPORT') AND status = 'COMPLETED'`;
      if (!(mine && has(u, 'complaint.work')) && !has(u, 'complaint.verify')) throw forbidden();
      await transition(id, 'VERIFICATION_PENDING', u, { note: str(data.note) ?? 'Submitted for verification' });
      await notifyOfficials(id, 'WORK_REVIEW', {}, { includeWardMember: false });
      for (const s of await supervisors()) await notify(s, 'WORK_REVIEW', catVars, id);
      break;
    }

    case 'hold':
    case 'resume': {
      // The field team (complaint.work) or an officer who manages assignments (complaint.reassign)
      const [mine] = await sql`SELECT 1 FROM assignments WHERE complaint_id = ${id} AND purpose = 'WORK' AND assigned_to = ${u.id} AND assignee_role IN ('PRIMARY','SUPPORT') AND status IN ${sql(ACTIVE_A)}`;
      if (!(mine && has(u, 'complaint.work')) && !has(u, 'complaint.reassign')) throw forbidden('This work is not assigned to you');
      if (action === 'hold') {
        requireStatus('ASSIGNED', 'IN_PROGRESS', 'REWORK_REQUIRED');
        const reason = z.enum(HOLD_REASONS).parse(data.reason);
        const note = str(data.note);
        if (reason === 'OTHER' && (!note || note.length < 3)) throw badRequest('err.reasonRequired');
        await transition(id, 'ON_HOLD', u, {
          note: `On hold — ${HOLD_LABEL[reason].en}${note ? `: ${note}` : ''}`,
          set: { on_hold_reason: reason, on_hold_note: note, on_hold_since: new Date() },
          notifyVars: { reason_en: HOLD_LABEL[reason].en, reason_ta: HOLD_LABEL[reason].ta },
        });
        await sql`INSERT INTO work_updates (complaint_id, user_id, update_type, notes) VALUES (${id}, ${u.id}, 'ON_HOLD', ${`${HOLD_LABEL[reason].en}${note ? `: ${note}` : ''}`})`;
        for (const s of await supervisors()) if (s !== u.id) await notify(s, 'ON_HOLD', { code, reason_en: HOLD_LABEL[reason].en, reason_ta: HOLD_LABEL[reason].ta }, id);
      } else {
        requireStatus('ON_HOLD');
        const to = c.work_started_at ? 'IN_PROGRESS' : 'ASSIGNED';
        await transition(id, to, u, { note: str(data.note) ?? 'Work resumed', citizenTemplate: 'RESUMED', auditAction: 'WORK_RESUMED' });
        await sql`INSERT INTO work_updates (complaint_id, user_id, update_type, notes) VALUES (${id}, ${u.id}, 'RESUMED', ${str(data.note)})`;
      }
      break;
    }

    case 'verify_completion': {
      need('complaint.verify');
      requireStatus('VERIFICATION_PENDING', 'WORK_COMPLETED');
      const decision = z.enum(['approve', 'send_back']).parse(data.decision);
      const method = z.enum(['EVIDENCE', 'FIELD']).parse(data.method ?? 'EVIDENCE');
      const notes = str(data.notes);
      const [ce] = await sql`SELECT id, completed_by, proposed_resolution, notes FROM completion_evidence WHERE complaint_id = ${id} AND verification_status = 'PENDING' ORDER BY completed_at DESC LIMIT 1`;
      if (!ce) throw conflict('No completion evidence to verify');
      if (ce.completed_by === u.id) throw forbidden('Completion must be verified by a different official');
      const noIssue = ce.proposed_resolution === 'NO_ISSUE_FOUND';
      if (decision === 'approve' && noIssue) need('complaint.reject');
      // Method B: the verifier visits the site — location and notes are mandatory, photo optional
      if (method === 'FIELD') {
        if (geo.latitude == null || geo.longitude == null) throw badRequest('field.needLocation');
        if (!notes || notes.length < 3) throw badRequest('Field verification notes are required');
      }
      if (decision === 'send_back' && (!notes || notes.length < 3)) throw badRequest('Please give a reason for sending back');
      if (status === 'WORK_COMPLETED') await transition(id, 'VERIFICATION_PENDING', u, { note: 'Submitted for verification', skipCitizenNotify: true });
      const vIds = await storeAll('VERIFICATION');
      await sql`UPDATE completion_evidence SET verification_status = ${decision === 'approve' ? 'APPROVED' : 'SENT_BACK'}, verified_by = ${u.id}, verified_at = now(),
                  verification_notes = ${notes}, verification_method = ${method}, verification_latitude = ${geo.latitude}, verification_longitude = ${geo.longitude},
                  verification_evidence_id = ${vIds[0] ?? null}
                WHERE id = ${ce.id}`;
      const how = method === 'FIELD' ? 'field verification' : 'evidence review';
      await audit(u, { action: decision === 'approve' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED', entityType: 'complaint', entityId: code, reason: notes,
        newValue: { method, proposed: ce.proposed_resolution, lat: geo.latitude, lng: geo.longitude, evidenceIds: vIds } });
      if (decision === 'approve') {
        if (noIssue) {
          await transition(id, 'REJECTED', u, {
            note: `No issue found — confirmed by ${how}${notes ? `: ${notes}` : ''}`,
            set: { rejection_reason: 'NOT_FOUND', rejection_notes: (ce.notes as string) ?? notes, resolution_type: 'NO_ISSUE_FOUND', resolution_notes: notes ?? ce.notes },
            notifyVars: { reason_en: REASON_LABEL.NOT_FOUND.en, reason_ta: REASON_LABEL.NOT_FOUND.ta },
          });
        } else {
          await transition(id, 'COMPLETION_VERIFIED', u, { note: `Completion verified by ${how}${notes ? `: ${notes}` : ''}` });
          if (data.close === true) {
            need('complaint.close');
            await transition(id, 'CLOSED', u, { note: notes ?? 'Closed after verification', set: { resolution_type: 'RESOLVED', resolution_notes: notes } });
          }
        }
      } else {
        const [wa] = await sql`UPDATE assignments SET status = 'ACCEPTED', completed_at = NULL
                               WHERE id = (SELECT assignment_id FROM completion_evidence WHERE id = ${ce.id}) RETURNING assigned_to, id`;
        // Supporting assignees who were on the job return to it as well
        const back = await sql`UPDATE assignments SET status = 'ACCEPTED', completed_at = NULL WHERE complaint_id = ${id} AND purpose = 'WORK' AND status = 'COMPLETED'
                               AND assignee_role = 'SUPPORT' AND completed_at >= (SELECT completed_at FROM completion_evidence WHERE id = ${ce.id}) - interval '1 minute' RETURNING assigned_to`;
        if (wa) await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes) VALUES (${id}, ${wa.id}, ${u.id}, 'SENT_BACK', ${notes})`;
        await transition(id, 'REWORK_REQUIRED', u, { note: `Rework required (${how}): ${notes}`, skipCitizenNotify: true });
        for (const x of [wa, ...back].filter(Boolean)) await notify(x.assigned_to as string, 'REWORK_REQUIRED', { code, reason: notes }, id);
      }
      break;
    }

    case 'close': {
      need('complaint.close');
      requireStatus('COMPLETION_VERIFIED');
      await transition(id, 'CLOSED', u, { note: str(data.note) ?? 'Complaint closed', set: { resolution_type: 'RESOLVED', resolution_notes: str(data.note) } });
      break;
    }

    case 'reject': {
      need('complaint.reject');
      requireStatus(...RESOLVABLE);
      const reason = z.enum(REJECTION_REASONS).parse(data.reason);
      const notes = z.string().trim().min(5, 'Notes are required').max(2000).parse(data.notes);
      if (reason === 'DUPLICATE' && status === 'VERIFICATION_PENDING') throw conflict('Decide the pending verification first');
      const cancelWork = async () => {
        await sql`UPDATE assignments SET status = 'CANCELLED' WHERE complaint_id = ${id} AND status IN ${sql(ACTIVE_A)}`;
        await sql`UPDATE completion_evidence SET verification_status = 'SENT_BACK', verified_by = ${u.id}, verified_at = now(), verification_notes = ${`Closed as ${reason}: ${notes}`}
                  WHERE complaint_id = ${id} AND verification_status = 'PENDING'`;
      };
      if (reason === 'DUPLICATE') {
        const dupCode = z.string().trim().min(3).parse(data.duplicateOf);
        const [orig] = await sql`SELECT c.id, c.code FROM complaints c WHERE c.code = ${dupCode} AND c.id <> ${id} AND (${complaintScope(u)})`;
        if (!orig) throw badRequest('Original complaint not found in your jurisdiction');
        await transition(id, 'DUPLICATE', u, {
          note: `Duplicate of ${orig.code}: ${notes}`,
          set: { rejection_reason: 'DUPLICATE', rejection_notes: notes, duplicate_of_id: orig.id, resolution_notes: notes },
          notifyVars: { reason_en: REASON_LABEL.DUPLICATE.en, reason_ta: REASON_LABEL.DUPLICATE.ta },
        });
        await cancelWork();
        // The citizen can follow the original complaint
        await sql`INSERT INTO complaint_supporters (complaint_id, user_id) VALUES (${orig.id}, ${c.citizen_id}) ON CONFLICT DO NOTHING`;
      } else {
        await transition(id, 'REJECTED', u, {
          note: `${REASON_LABEL[reason].en}: ${notes}`,
          set: { rejection_reason: reason, rejection_notes: notes, resolution_notes: notes },
          notifyVars: { reason_en: REASON_LABEL[reason].en, reason_ta: REASON_LABEL[reason].ta },
        });
        await cancelWork();
      }
      break;
    }

    case 'escalate': {
      need('complaint.escalate');
      if (FINAL_S.includes(status)) throw conflict('Complaint is already closed');
      const note = z.string().trim().min(5).max(1000).parse(data.note);
      const level = data.level != null && data.level !== '' ? z.coerce.number().int().min(1).max(4).parse(data.level) : undefined;
      if ((c.escalation_level as number) >= 4) throw conflict('Already escalated to the highest level');
      const r = await escalateComplaint(id, u, note, level);
      if (!r) throw conflict('This complaint was updated by someone else. Please refresh.');
      break;
    }

    case 'remark': {
      need('complaint.remark');
      const note = z.string().trim().min(2).max(1000).parse(data.note);
      await addHistoryNote(id, c.status as string, u, note, false);
      await audit(u, { action: 'COMPLAINT_REMARK', entityType: 'complaint', entityId: code, newValue: { note } });
      break;
    }

    case 'appeal_decide': {
      need('appeal.review');
      const appealId = z.coerce.number().int().parse(data.appealId);
      const decision = z.enum(['ACCEPTED', 'REJECTED']).parse(data.decision);
      const notes = z.string().trim().min(3).max(2000).parse(data.notes);
      const [ap] = await sql`UPDATE appeals SET status = ${decision}, reviewer_id = ${u.id}, decision_notes = ${notes}, decided_at = now()
                             WHERE id = ${appealId} AND complaint_id = ${id} AND status = 'PENDING' RETURNING id`;
      if (!ap) throw conflict('Appeal already decided');
      await audit(u, { action: `APPEAL_${decision}`, entityType: 'complaint', entityId: code, newValue: { appealId, notes } });
      if (decision === 'ACCEPTED') {
        await transition(id, 'REOPENED', u, { note: `Reconsideration accepted: ${notes}`, set: { rejection_reason: null, rejection_notes: null, duplicate_of_id: null, closed_at: null, inspection_outcome: null } });
      } else {
        await addHistoryNote(id, c.status as string, u, `Reconsideration not accepted: ${notes}`, true);
        await notify(c.citizen_id as string, 'APPEAL_REJECTED', { code, reason: notes }, id);
      }
      break;
    }

    default:
      throw badRequest('Unknown action');
  }
  return { ok: true };
});

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 2000);
  return s || null;
}

/** Supervisor candidates: department-level officials the user may assign, or the user themself if department-level. */
async function supervisorCandidate(u: AuthUser, userId: string, localBodyId: number) {
  if (userId === u.id) {
    if (u.scope !== 'DEPARTMENT' && u.scope !== 'LOCAL_BODY') throw forbidden('You cannot supervise this complaint');
    return { full_name: u.fullName, department_id: u.departmentId };
  }
  const [row] = await sql`
    SELECT usr.id, usr.full_name, o.department_id FROM users usr JOIN roles r ON r.id = usr.role_id JOIN officials o ON o.user_id = usr.id
    WHERE usr.id = ${userId} AND r.default_scope = 'DEPARTMENT' AND ${assignableScope(u, localBodyId)}`;
  if (!row) throw forbidden('This user cannot supervise this complaint');
  return row;
}

async function assignableUser(u: AuthUser, userId: string, allowSelf: boolean, localBodyId: number) {
  if (allowSelf && userId === u.id) return { full_name: u.fullName, department_id: u.departmentId };
  const [row] = await sql`
    SELECT usr.id, usr.full_name, o.department_id FROM users usr JOIN roles r ON r.id = usr.role_id JOIN officials o ON o.user_id = usr.id
    WHERE usr.id = ${userId} AND ${assignableScope(u, localBodyId)}`;
  if (!row) throw forbidden('You cannot assign to this user');
  return row;
}
