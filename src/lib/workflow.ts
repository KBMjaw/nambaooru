import 'server-only';
import { sql } from './db';
import type { AuthUser } from './auth';
import { audit } from './audit';
import { notify } from './notify';
import { badRequest, conflict } from './errors';
import { STATUSES, REASON_RESOLUTION } from './workflow-constants';

export { STATUSES };
export type Status = (typeof STATUSES)[number];

export const FINAL: Status[] = ['CLOSED', 'REJECTED', 'DUPLICATE'];
export const OPEN_STATUSES: Status[] = STATUSES.filter((s) => !FINAL.includes(s) && s !== 'DRAFT');

/** Allowed transitions. The permission needed for each is checked by the caller's action. */
export const TRANSITIONS: Record<Status, Status[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['AI_CLASSIFIED'],
  AI_CLASSIFIED: ['INITIAL_REVIEW', 'SITE_INSPECTION', 'REJECTED', 'DUPLICATE'],
  REOPENED: ['INITIAL_REVIEW', 'SITE_INSPECTION', 'REJECTED', 'DUPLICATE'],
  INITIAL_REVIEW: ['SITE_INSPECTION', 'VERIFIED', 'REJECTED', 'DUPLICATE'],
  SITE_INSPECTION: ['VERIFIED', 'REJECTED', 'DUPLICATE', 'SITE_INSPECTION'],
  VERIFIED: ['ASSIGNED', 'REJECTED', 'DUPLICATE'],
  // VERIFICATION_PENDING from ASSIGNED / IN_PROGRESS = field staff reported "no issue found" (verified like completed work)
  ASSIGNED: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'VERIFICATION_PENDING', 'REJECTED', 'DUPLICATE'],
  IN_PROGRESS: ['WORK_COMPLETED', 'ASSIGNED', 'ON_HOLD', 'VERIFICATION_PENDING', 'REJECTED', 'DUPLICATE'],
  ON_HOLD: ['IN_PROGRESS', 'ASSIGNED', 'REJECTED', 'DUPLICATE'],
  WORK_COMPLETED: ['VERIFICATION_PENDING', 'REWORK_REQUIRED'],
  // REJECTED from VERIFICATION_PENDING = a verified "no issue found" report
  VERIFICATION_PENDING: ['COMPLETION_VERIFIED', 'REWORK_REQUIRED', 'REJECTED'],
  REWORK_REQUIRED: ['IN_PROGRESS', 'ASSIGNED', 'ON_HOLD', 'REJECTED', 'DUPLICATE'],
  COMPLETION_VERIFIED: ['CLOSED'],
  CLOSED: ['REOPENED'],
  REJECTED: ['REOPENED'],
  DUPLICATE: ['REOPENED'],
};

/** Business audit code recorded for entering a status (everything else is STATUS_CHANGED). */
const STATUS_AUDIT: Partial<Record<Status, string>> = {
  VERIFIED: 'COMPLAINT_VERIFIED', COMPLETION_VERIFIED: 'COMPLAINT_VERIFIED', REJECTED: 'COMPLAINT_REJECTED', DUPLICATE: 'COMPLAINT_REJECTED',
  CLOSED: 'COMPLAINT_CLOSED', REOPENED: 'COMPLAINT_REOPENED', ON_HOLD: 'WORK_ON_HOLD', VERIFICATION_PENDING: 'VERIFICATION_SUBMITTED',
  REWORK_REQUIRED: 'REWORK_REQUIRED',
};

/** Citizen notification template for entering a status. */
const CITIZEN_TEMPLATE: Partial<Record<Status, string>> = {
  INITIAL_REVIEW: 'ACCEPTED',
  SITE_INSPECTION: 'INSPECTION_SCHEDULED',
  VERIFIED: 'VERIFIED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'WORK_STARTED',
  ON_HOLD: 'ON_HOLD',
  WORK_COMPLETED: 'WORK_COMPLETED',
  VERIFICATION_PENDING: 'VERIFICATION_PENDING',
  COMPLETION_VERIFIED: 'COMPLETION_VERIFIED',
  REJECTED: 'REJECTED',
  DUPLICATE: 'DUPLICATE',
  CLOSED: 'CLOSED',
  REOPENED: 'REOPENED',
};

export const REJECTION_REASONS = ['DUPLICATE', 'NOT_FOUND', 'OUTSIDE_JURISDICTION', 'INSUFFICIENT_EVIDENCE', 'ALREADY_RESOLVED', 'INVALID', 'CANNOT_VERIFY', 'OTHER'] as const;
export const REASON_LABEL: Record<string, { en: string; ta: string }> = {
  DUPLICATE: { en: 'Duplicate complaint', ta: 'இரட்டைப் புகார்' },
  NOT_FOUND: { en: 'No issue found at the site', ta: 'இடத்தில் பிரச்சினை காணப்படவில்லை' },
  OUTSIDE_JURISDICTION: { en: 'Outside jurisdiction', ta: 'அதிகார வரம்புக்கு வெளியே' },
  INSUFFICIENT_EVIDENCE: { en: 'Insufficient information', ta: 'போதிய தகவல் இல்லை' },
  ALREADY_RESOLVED: { en: 'Already resolved', ta: 'ஏற்கனவே தீர்க்கப்பட்டது' },
  INVALID: { en: 'Invalid complaint', ta: 'செல்லாத புகார்' },
  CANNOT_VERIFY: { en: 'Cannot be verified', ta: 'சரிபார்க்க இயலவில்லை' },
  OTHER: { en: 'Other', ta: 'பிற' },
};

export interface TransitionOpts {
  note?: string | null;
  publicNote?: boolean;
  set?: Record<string, unknown>;
  notifyVars?: Record<string, string | number | null>;
  skipCitizenNotify?: boolean;
  /** Citizen template to use instead of the default for the target status. */
  citizenTemplate?: string;
  auditAction?: string;
}

/**
 * Move a complaint to a new status atomically: validates the transition against the
 * current DB state (optimistic check), updates the row, appends status history, writes
 * the audit log and notifies the citizen.
 */
export async function transition(complaintId: number, to: Status, actor: AuthUser | null, opts: TransitionOpts = {}) {
  const [c] = await sql`SELECT id, code, status, citizen_id, category_id FROM complaints WHERE id = ${complaintId}`;
  if (!c) throw badRequest('Complaint not found');
  const from = c.status as Status;
  if (!TRANSITIONS[from]?.includes(to)) throw conflict(`Cannot move complaint from ${from} to ${to}`);

  const set: Record<string, unknown> = { ...(opts.set ?? {}), status: to, updated_at: new Date() };
  if (to === 'IN_PROGRESS' && from === 'ASSIGNED') set.work_started_at = new Date();
  if (to === 'WORK_COMPLETED') set.work_completed_at = new Date();
  if (to === 'CLOSED') set.closed_at = new Date();
  // Every finished complaint records how it ended and who ended it
  if (FINAL.includes(to)) {
    set.resolution_type ??= to === 'CLOSED' ? 'RESOLVED' : to === 'DUPLICATE' ? 'DUPLICATE' : REASON_RESOLUTION[(set.rejection_reason as string) ?? 'OTHER'] ?? 'OTHER';
    set.resolved_by = actor?.id ?? null;
    set.resolved_at = new Date();
  }
  if (to === 'REOPENED') Object.assign(set, { resolution_type: null, resolution_notes: null, resolved_by: null, resolved_at: null });
  if (from === 'ON_HOLD' && to !== 'ON_HOLD') Object.assign(set, { on_hold_reason: null, on_hold_note: null, on_hold_since: null });

  const cols = Object.keys(set);
  const updated = await sql.begin(async (tx) => {
    // Time spent on hold does not count against the resolution deadline
    if (from === 'ON_HOLD' && to !== 'ON_HOLD') {
      await tx`UPDATE complaints SET sla_due_at = sla_due_at + (now() - on_hold_since),
                  sla_breached_at = CASE WHEN sla_due_at + (now() - on_hold_since) > now() THEN NULL ELSE sla_breached_at END,
                  sla_warned_at = CASE WHEN sla_due_at + (now() - on_hold_since) > now() THEN NULL ELSE sla_warned_at END
                WHERE id = ${complaintId} AND status = 'ON_HOLD' AND on_hold_since IS NOT NULL AND sla_due_at IS NOT NULL`;
    }
    const res = await tx`UPDATE complaints SET ${tx(set, cols)} WHERE id = ${complaintId} AND status = ${from} RETURNING id`;
    if (!res.length) throw conflict('This complaint was updated by someone else. Please refresh.');
    await tx`
      INSERT INTO complaint_status_history (complaint_id, from_status, to_status, actor_id, actor_label, note, public_note)
      VALUES (${complaintId}, ${from}, ${to}, ${actor?.id ?? null}, ${actor ? `${actor.fullName} (${actor.roleNameEn})` : 'System'},
              ${opts.note ?? null}, ${opts.publicNote ?? true})`;
    return res;
  });

  await audit(actor, {
    action: opts.auditAction ?? STATUS_AUDIT[to] ?? 'STATUS_CHANGED',
    entityType: 'complaint',
    entityId: c.code as string,
    oldValue: { status: from },
    newValue: { status: to, ...(opts.set ?? {}), note: opts.note ?? undefined },
  });

  const tpl = opts.citizenTemplate ?? CITIZEN_TEMPLATE[to];
  if (tpl && !opts.skipCitizenNotify) {
    const [cat] = c.category_id ? await sql`SELECT name_en, name_ta FROM complaint_categories WHERE id = ${c.category_id}` : [];
    await notify(c.citizen_id as string, tpl, {
      code: c.code as string,
      category_en: (cat?.name_en as string) ?? '',
      category_ta: (cat?.name_ta as string) ?? '',
      ...(opts.notifyVars ?? {}),
    }, complaintId);
  }
  return updated;
}

/** System history entry without a status change (e.g. escalation, remark). */
export async function addHistoryNote(complaintId: number, status: string, actor: AuthUser, note: string, publicNote = false) {
  await sql`
    INSERT INTO complaint_status_history (complaint_id, from_status, to_status, actor_id, actor_label, note, public_note)
    VALUES (${complaintId}, ${status}, ${status}, ${actor.id}, ${`${actor.fullName} (${actor.roleNameEn})`}, ${note}, ${publicNote})`;
}
