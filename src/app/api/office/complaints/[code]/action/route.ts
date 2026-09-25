import { z } from 'zod';
import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiStaffFor, has, type AuthUser } from '@/lib/auth';
import { complaintScope, assignableScope } from '@/lib/scope';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { badRequest, forbidden, notFound, conflict } from '@/lib/errors';
import { transition, addHistoryNote, REASON_LABEL, REJECTION_REASONS } from '@/lib/workflow';
import { storeEvidence, num } from '@/lib/evidence';
import { notify } from '@/lib/notify';
import { notifyOfficials } from '@/lib/complaints';

const OUTCOMES = ['VERIFIED', 'NOT_FOUND', 'DUPLICATE', 'ALREADY_RESOLVED', 'INVALID', 'REQUIRES_HIGHER_AUTHORITY'] as const;

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
  let photo: File | null = null;
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    data = JSON.parse(String(fd.get('data') ?? '{}'));
    const f = fd.get('photo');
    photo = f instanceof File && f.size > 0 ? f : null;
  } else {
    data = await req.json().catch(() => ({}));
  }
  const action = z.string().parse(data.action);

  const [c] = await sql`SELECT c.*, cat.inspection_required, cat.name_en AS cat_en, cat.name_ta AS cat_ta
                        FROM complaints c LEFT JOIN complaint_categories cat ON cat.id = c.category_id
                        WHERE c.code = ${code} AND (${complaintScope(u)})`;
  if (!c) throw notFound('Complaint not found in your jurisdiction');
  const id = c.id as number;
  const need = (perm: string) => { if (!has(u, perm)) throw forbidden(); };
  const requireStatus = (...s: string[]) => { if (!s.includes(c.status as string)) throw conflict(`Action not allowed while complaint is ${c.status}`); };
  const geo = { latitude: num(data.latitude as never), longitude: num(data.longitude as never), accuracy: num(data.accuracy as never) };

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
        await sql`UPDATE complaints SET inspection_outcome = ${outcome}, updated_at = now() ${escalate ? sql`, escalated = true, escalation_note = ${notes}` : sql``} WHERE id = ${id}`;
        await addHistoryNote(id, c.status as string, u, `Site inspection outcome: ${outcome.replace(/_/g, ' ').toLowerCase()}. ${notes}`, false);
        await notifyOfficials(id, escalate ? 'ESCALATED' : 'WORK_REVIEW', {}, { includeWardMember: false });
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

    case 'assign':
    case 'reassign': {
      const reassign = action === 'reassign';
      need(reassign ? 'complaint.reassign' : 'complaint.assign');
      requireStatus(...(reassign ? ['ASSIGNED', 'IN_PROGRESS'] : ['VERIFIED']));
      const assigneeId = z.string().uuid().parse(data.assigneeId);
      const supportIds = [...new Set(z.array(z.string().uuid()).max(10).parse(data.supportIds ?? []))].filter((x) => x !== assigneeId);
      const assignee = await assignableUser(u, assigneeId, false, c.local_body_id as number);
      const supporters: { id: string; full_name: string; department_id: number | null }[] = [];
      for (const sid of supportIds) {
        const s = await assignableUser(u, sid, false, c.local_body_id as number);
        supporters.push({ id: sid, full_name: s.full_name as string, department_id: (s.department_id as number | null) ?? null });
      }
      const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).parse(data.priority ?? c.priority);
      const due = data.dueAt ? new Date(String(data.dueAt)) : (c.sla_due_at as Date | null);
      if (reassign && !str(data.note)) throw badRequest('err.reasonRequired');
      const prev = await sql`UPDATE assignments SET status = 'REASSIGNED' WHERE complaint_id = ${id} AND purpose = 'WORK' AND status IN ('PENDING','ACCEPTED','IN_PROGRESS')
                             RETURNING assigned_to, assignee_role`;
      await sql`INSERT INTO assignments (complaint_id, assigned_to, assigned_by, department_id, purpose, priority, due_at, note, assignee_role)
                VALUES (${id}, ${assigneeId}, ${u.id}, ${assignee.department_id ?? c.department_id}, 'WORK', ${priority}, ${due}, ${str(data.note)}, 'PRIMARY')`;
      for (const sp of supporters) {
        await sql`INSERT INTO assignments (complaint_id, assigned_to, assigned_by, department_id, purpose, priority, due_at, note, assignee_role)
                  VALUES (${id}, ${sp.id}, ${u.id}, ${sp.department_id ?? c.department_id}, 'WORK', ${priority}, ${due}, ${str(data.note)}, 'SUPPORT')`;
      }
      const team = [assignee.full_name, ...supporters.map((x) => x.full_name)].join(', ');
      await transition(id, 'ASSIGNED', u, {
        note: `${reassign ? 'Reassigned' : 'Assigned'} to ${team}${data.note ? ` — ${str(data.note)}` : ''}`,
        set: { assigned_to: assigneeId, priority, department_id: assignee.department_id ?? c.department_id },
        skipCitizenNotify: reassign,
      });
      for (const uid of [assigneeId, ...supportIds]) await notify(uid, 'STAFF_ASSIGNED', { code, category_en: c.cat_en as string, category_ta: c.cat_ta as string }, id);
      await audit(u, { action: reassign ? 'COMPLAINT_REASSIGNED' : 'COMPLAINT_ASSIGNED', entityType: 'complaint', entityId: code, targetUserId: assigneeId, reason: reassign ? str(data.note) : null,
        oldValue: { team: prev.map((p) => ({ user: p.assigned_to, role: p.assignee_role })) },
        newValue: { primary: assigneeId, supporting: supportIds, priority, due } });
      break;
    }

    case 'add_support':
    case 'remove_support': {
      need('complaint.reassign');
      requireStatus('ASSIGNED', 'IN_PROGRESS');
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
    case 'complete': {
      need('complaint.work');
      // Primary and supporting assignees can all report on the work
      const [a] = await sql`SELECT * FROM assignments WHERE complaint_id = ${id} AND purpose = 'WORK' AND assigned_to = ${u.id}
                            AND status IN ('PENDING','ACCEPTED','IN_PROGRESS') ORDER BY (assignee_role = 'PRIMARY') DESC, created_at DESC LIMIT 1`;
      if (!a) throw forbidden('This work is not assigned to you');
      if (action === 'accept') {
        requireStatus('ASSIGNED');
        if (a.status !== 'PENDING') throw conflict('Already accepted');
        await sql`UPDATE assignments SET status = 'ACCEPTED', accepted_at = now() WHERE id = ${a.id}`;
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes) VALUES (${id}, ${a.id}, ${u.id}, 'ACCEPTED', ${str(data.note)})`;
        await addHistoryNote(id, 'ASSIGNED', u, 'Work accepted by field staff', true);
        await audit(u, { action: 'WORK_ACCEPTED', entityType: 'complaint', entityId: code, newValue: { role: a.assignee_role } });
      } else if (action === 'start') {
        requireStatus('ASSIGNED');
        await sql`UPDATE assignments SET status = 'IN_PROGRESS', started_at = now(), accepted_at = COALESCE(accepted_at, now())
                  WHERE complaint_id = ${id} AND purpose = 'WORK' AND status IN ('PENDING','ACCEPTED')`;
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes, latitude, longitude)
                  VALUES (${id}, ${a.id}, ${u.id}, 'STARTED', ${str(data.note)}, ${geo.latitude}, ${geo.longitude})`;
        await transition(id, 'IN_PROGRESS', u, { note: str(data.note) ?? 'Work started' });
      } else if (action === 'progress') {
        requireStatus('IN_PROGRESS');
        const notes = z.string().trim().min(2).max(2000).parse(data.notes);
        const pct = z.coerce.number().int().min(0).max(100).parse(data.progress ?? 50);
        const evidenceId = photo ? await storeEvidence(id, 'PROGRESS', photo, u.id, { ...geo, capturedAt: new Date().toISOString(), source: 'CAMERA' }) : null;
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes, progress_pct, evidence_id, latitude, longitude)
                  VALUES (${id}, ${a.id}, ${u.id}, 'PROGRESS', ${notes}, ${pct}, ${evidenceId}, ${geo.latitude}, ${geo.longitude})`;
        await addHistoryNote(id, 'IN_PROGRESS', u, `Progress ${pct}%: ${notes}`, true);
        await notify(c.citizen_id as string, 'PROGRESS', { code }, id);
        await audit(u, { action: 'PROGRESS_UPDATED', entityType: 'complaint', entityId: code, newValue: { pct, notes, evidenceId } });
        if (evidenceId) await audit(u, { action: 'EVIDENCE_UPLOADED', entityType: 'complaint', entityId: code, newValue: { kind: 'PROGRESS', evidenceId } });
      } else {
        requireStatus('IN_PROGRESS');
        const notes = z.string().trim().min(3).max(2000).parse(data.notes);
        if (!photo) throw badRequest('field.completionPhoto');
        if (geo.latitude == null || geo.longitude == null) throw badRequest('field.needLocation');
        const evidenceId = await storeEvidence(id, 'COMPLETION', photo, u.id, { ...geo, capturedAt: new Date().toISOString(), source: 'CAMERA' });
        await sql`INSERT INTO completion_evidence (complaint_id, assignment_id, evidence_id, notes, latitude, longitude, gps_accuracy_m, completed_by)
                  VALUES (${id}, ${a.id}, ${evidenceId}, ${notes}, ${geo.latitude}, ${geo.longitude}, ${geo.accuracy}, ${u.id})`;
        await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes, progress_pct, evidence_id, latitude, longitude)
                  VALUES (${id}, ${a.id}, ${u.id}, 'COMPLETED', ${notes}, 100, ${evidenceId}, ${geo.latitude}, ${geo.longitude})`;
        await sql`UPDATE assignments SET status = 'COMPLETED', completed_at = now() WHERE complaint_id = ${id} AND purpose = 'WORK' AND status IN ('PENDING','ACCEPTED','IN_PROGRESS')`;
        await transition(id, 'WORK_COMPLETED', u, { note: notes });
        await audit(u, { action: 'EVIDENCE_UPLOADED', entityType: 'complaint', entityId: code, newValue: { kind: 'COMPLETION', evidenceId } });
        await notifyOfficials(id, 'WORK_REVIEW', {}, { includeWardMember: false });
      }
      break;
    }

    case 'verify_completion': {
      need('complaint.verify');
      requireStatus('WORK_COMPLETED');
      const decision = z.enum(['approve', 'send_back']).parse(data.decision);
      const notes = str(data.notes);
      const [ce] = await sql`SELECT id, completed_by FROM completion_evidence WHERE complaint_id = ${id} AND verification_status = 'PENDING' ORDER BY completed_at DESC LIMIT 1`;
      if (!ce) throw conflict('No completion evidence to verify');
      if (ce.completed_by === u.id) throw forbidden('Completion must be verified by a different official');
      if (decision === 'approve') {
        await sql`UPDATE completion_evidence SET verification_status = 'APPROVED', verified_by = ${u.id}, verified_at = now(), verification_notes = ${notes} WHERE id = ${ce.id}`;
        await transition(id, 'COMPLETION_VERIFIED', u, { note: notes ?? 'Completion verified by officer' });
        if (data.close === true) {
          need('complaint.close');
          await transition(id, 'CLOSED', u, { note: notes ?? 'Closed after verification' });
        }
      } else {
        if (!notes || notes.length < 3) throw badRequest('Please give a reason for sending back');
        await sql`UPDATE completion_evidence SET verification_status = 'SENT_BACK', verified_by = ${u.id}, verified_at = now(), verification_notes = ${notes} WHERE id = ${ce.id}`;
        const [wa] = await sql`UPDATE assignments SET status = 'IN_PROGRESS', completed_at = NULL
                               WHERE id = (SELECT assignment_id FROM completion_evidence WHERE id = ${ce.id}) RETURNING assigned_to, id, complaint_id`;
        // Supporting assignees who were on the job return to it as well
        if (wa) await sql`UPDATE assignments SET status = 'IN_PROGRESS', completed_at = NULL WHERE complaint_id = ${id} AND purpose = 'WORK' AND status = 'COMPLETED'
                          AND assignee_role = 'SUPPORT' AND completed_at >= (SELECT completed_at FROM completion_evidence WHERE id = ${ce.id}) - interval '1 minute'`;
        if (wa) {
          await sql`INSERT INTO work_updates (complaint_id, assignment_id, user_id, update_type, notes) VALUES (${id}, ${wa.id}, ${u.id}, 'SENT_BACK', ${notes})`;
          await notify(wa.assigned_to as string, 'STAFF_ASSIGNED', { code, category_en: c.cat_en as string, category_ta: c.cat_ta as string }, id);
        }
        await transition(id, 'IN_PROGRESS', u, { note: `Sent back for rework: ${notes}`, skipCitizenNotify: true });
      }
      break;
    }

    case 'close': {
      need('complaint.close');
      requireStatus('COMPLETION_VERIFIED');
      await transition(id, 'CLOSED', u, { note: str(data.note) ?? 'Complaint closed' });
      break;
    }

    case 'reject': {
      need('complaint.reject');
      requireStatus('AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW', 'SITE_INSPECTION', 'VERIFIED');
      const reason = z.enum(REJECTION_REASONS).parse(data.reason);
      const notes = z.string().trim().min(5, 'Notes are required').max(2000).parse(data.notes);
      if (reason === 'DUPLICATE') {
        const dupCode = z.string().trim().min(3).parse(data.duplicateOf);
        const [orig] = await sql`SELECT c.id, c.code FROM complaints c WHERE c.code = ${dupCode} AND c.id <> ${id} AND (${complaintScope(u)})`;
        if (!orig) throw badRequest('Original complaint not found in your jurisdiction');
        await transition(id, 'DUPLICATE', u, {
          note: `Duplicate of ${orig.code}: ${notes}`,
          set: { rejection_reason: 'DUPLICATE', rejection_notes: notes, duplicate_of_id: orig.id },
          notifyVars: { reason_en: REASON_LABEL.DUPLICATE.en, reason_ta: REASON_LABEL.DUPLICATE.ta },
        });
        // The citizen can follow the original complaint
        await sql`INSERT INTO complaint_supporters (complaint_id, user_id) VALUES (${orig.id}, ${c.citizen_id}) ON CONFLICT DO NOTHING`;
      } else {
        await transition(id, 'REJECTED', u, {
          note: `${REASON_LABEL[reason].en}: ${notes}`,
          set: { rejection_reason: reason, rejection_notes: notes },
          notifyVars: { reason_en: REASON_LABEL[reason].en, reason_ta: REASON_LABEL[reason].ta },
        });
      }
      break;
    }

    case 'escalate': {
      need('complaint.escalate');
      if (['CLOSED', 'REJECTED', 'DUPLICATE'].includes(c.status as string)) throw conflict('Complaint is already closed');
      const note = z.string().trim().min(5).max(1000).parse(data.note);
      await sql`UPDATE complaints SET escalated = true, escalation_note = ${note}, updated_at = now() WHERE id = ${id}`;
      await addHistoryNote(id, c.status as string, u, `Escalated: ${note}`, false);
      await audit(u, { action: 'COMPLAINT_ESCALATED', entityType: 'complaint', entityId: code, oldValue: { escalated: c.escalated }, newValue: { escalated: true, note } });
      const eos = await sql`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id JOIN officials o ON o.user_id = u.id
                            WHERE r.default_scope = 'LOCAL_BODY' AND u.status = 'ACTIVE' AND o.local_body_id = ${c.local_body_id}`;
      for (const e of eos) await notify(e.id as string, 'ESCALATED', { code }, id);
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

async function assignableUser(u: AuthUser, userId: string, allowSelf: boolean, localBodyId: number) {
  if (allowSelf && userId === u.id) return { full_name: u.fullName, department_id: u.departmentId };
  const [row] = await sql`
    SELECT usr.id, usr.full_name, o.department_id FROM users usr JOIN roles r ON r.id = usr.role_id JOIN officials o ON o.user_id = usr.id
    WHERE usr.id = ${userId} AND ${assignableScope(u, localBodyId)}`;
  if (!row) throw forbidden('You cannot assign to this user');
  return row;
}
