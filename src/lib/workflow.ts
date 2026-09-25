import 'server-only';
import { sql } from './db';
import type { AuthUser } from './auth';
import { audit } from './audit';
import { notify } from './notify';
import { badRequest, conflict } from './errors';
import { STATUSES } from './workflow-constants';

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
  VERIFIED: ['ASSIGNED', 'REJECTED'],
  ASSIGNED: ['ASSIGNED', 'IN_PROGRESS'],
  IN_PROGRESS: ['WORK_COMPLETED', 'ASSIGNED'],
  WORK_COMPLETED: ['COMPLETION_VERIFIED', 'IN_PROGRESS'],
  COMPLETION_VERIFIED: ['CLOSED'],
  CLOSED: ['REOPENED'],
  REJECTED: ['REOPENED'],
  DUPLICATE: ['REOPENED'],
};

/** Business audit code recorded for entering a status (everything else is STATUS_CHANGED). */
const STATUS_AUDIT: Partial<Record<Status, string>> = {
  VERIFIED: 'COMPLAINT_VERIFIED', COMPLETION_VERIFIED: 'COMPLAINT_VERIFIED', REJECTED: 'COMPLAINT_REJECTED', DUPLICATE: 'COMPLAINT_REJECTED',
  CLOSED: 'COMPLAINT_CLOSED', REOPENED: 'COMPLAINT_REOPENED',
};

/** Citizen notification template for entering a status. */
const CITIZEN_TEMPLATE: Partial<Record<Status, string>> = {
  INITIAL_REVIEW: 'ACCEPTED',
  SITE_INSPECTION: 'INSPECTION_SCHEDULED',
  VERIFIED: 'VERIFIED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'WORK_STARTED',
  WORK_COMPLETED: 'WORK_COMPLETED',
  COMPLETION_VERIFIED: 'COMPLETION_VERIFIED',
  REJECTED: 'REJECTED',
  DUPLICATE: 'DUPLICATE',
  CLOSED: 'CLOSED',
  REOPENED: 'REOPENED',
};

export const REJECTION_REASONS = ['DUPLICATE', 'NOT_FOUND', 'OUTSIDE_JURISDICTION', 'INSUFFICIENT_EVIDENCE', 'ALREADY_RESOLVED', 'INVALID', 'OTHER'] as const;
export const REASON_LABEL: Record<string, { en: string; ta: string }> = {
  DUPLICATE: { en: 'Duplicate complaint', ta: 'இரட்டைப் புகார்' },
  NOT_FOUND: { en: 'Issue not found during inspection', ta: 'ஆய்வின்போது பிரச்சினை காணப்படவில்லை' },
  OUTSIDE_JURISDICTION: { en: 'Outside jurisdiction', ta: 'அதிகார வரம்புக்கு வெளியே' },
  INSUFFICIENT_EVIDENCE: { en: 'Insufficient evidence', ta: 'போதிய ஆதாரம் இல்லை' },
  ALREADY_RESOLVED: { en: 'Already resolved', ta: 'ஏற்கனவே தீர்க்கப்பட்டது' },
  INVALID: { en: 'Invalid complaint', ta: 'செல்லாத புகார்' },
  OTHER: { en: 'Other', ta: 'பிற' },
};

export interface TransitionOpts {
  note?: string | null;
  publicNote?: boolean;
  set?: Record<string, unknown>;
  notifyVars?: Record<string, string | number | null>;
  skipCitizenNotify?: boolean;
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

  const cols = Object.keys(set);
  const updated = await sql.begin(async (tx) => {
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

  const tpl = CITIZEN_TEMPLATE[to];
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
