export const STATUSES = [
  'DRAFT', 'SUBMITTED', 'AI_CLASSIFIED', 'INITIAL_REVIEW', 'SITE_INSPECTION', 'VERIFIED', 'REJECTED', 'DUPLICATE',
  'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'WORK_COMPLETED', 'VERIFICATION_PENDING', 'REWORK_REQUIRED', 'COMPLETION_VERIFIED', 'CLOSED', 'REOPENED',
] as const;

/** Why work was paused (ON_HOLD). */
export const HOLD_REASONS = ['MATERIAL_UNAVAILABLE', 'WEATHER', 'PERMISSION_REQUIRED', 'EXTERNAL_AGENCY', 'SAFETY', 'OTHER'] as const;

/** How a finished complaint ended. Complaints are never deleted; they end with one of these. */
export const RESOLUTION_TYPES = ['RESOLVED', 'NO_ISSUE_FOUND', 'INVALID', 'DUPLICATE', 'OUTSIDE_JURISDICTION', 'INSUFFICIENT_INFORMATION', 'CANNOT_VERIFY', 'OTHER'] as const;

/** Rejection reason → resolution type recorded on the complaint. */
export const REASON_RESOLUTION: Record<string, (typeof RESOLUTION_TYPES)[number]> = {
  DUPLICATE: 'DUPLICATE', NOT_FOUND: 'NO_ISSUE_FOUND', ALREADY_RESOLVED: 'NO_ISSUE_FOUND', OUTSIDE_JURISDICTION: 'OUTSIDE_JURISDICTION',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_INFORMATION', INVALID: 'INVALID', CANNOT_VERIFY: 'CANNOT_VERIFY', OTHER: 'OTHER',
};

/** Escalation chain. Level 0 = not escalated. */
export const ESCALATION_LEVELS = ['NONE', 'SUPERVISOR', 'DEPT_OFFICER', 'EO', 'HIGHER'] as const;

/** Statuses where field work is active (assignees can act). */
export const WORK_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED'] as const;
