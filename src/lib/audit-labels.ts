/** Human-readable labels for audit actions (current codes and legacy dotted codes). */
export const AUDIT_LABELS: Record<string, { label: string; icon: string; group: string }> = {
  USER_CREATED: { label: 'User created', icon: '➕', group: 'Users' },
  USER_UPDATED: { label: 'User updated', icon: '✏️', group: 'Users' },
  USER_DEACTIVATED: { label: 'User deactivated', icon: '⏸️', group: 'Users' },
  USER_REACTIVATED: { label: 'User reactivated', icon: '▶️', group: 'Users' },
  ROLE_CHANGED: { label: 'Role changed', icon: '🎭', group: 'Users' },
  JURISDICTION_CHANGED: { label: 'Jurisdiction changed', icon: '🗺️', group: 'Users' },
  PERMISSION_CHANGED: { label: 'Permission changed', icon: '🔐', group: 'Roles' },
  PASSWORD_CHANGED: { label: 'Password changed', icon: '🔑', group: 'Security' },
  PASSWORD_RESET: { label: 'Password reset by administrator', icon: '🔑', group: 'Security' },
  BULK_USER_IMPORT: { label: 'Bulk user import', icon: '📥', group: 'Users' },
  ROLE_CREATED: { label: 'Role created', icon: '🎭', group: 'Roles' },
  ROLE_UPDATED: { label: 'Role updated', icon: '🎭', group: 'Roles' },
  CITIZEN_CREATED: { label: 'Citizen created', icon: '🧑', group: 'Citizens' },
  CITIZEN_UPDATED: { label: 'Citizen updated', icon: '🧑', group: 'Citizens' },
  CITIZEN_REGISTERED: { label: 'Citizen self-registered', icon: '🧑', group: 'Citizens' },
  COMPLAINT_CREATED: { label: 'Complaint created', icon: '📝', group: 'Complaints' },
  COMPLAINT_ASSIGNED: { label: 'Complaint assigned', icon: '👷', group: 'Complaints' },
  COMPLAINT_REASSIGNED: { label: 'Complaint reassigned', icon: '🔄', group: 'Complaints' },
  INSPECTION_SCHEDULED: { label: 'Inspection scheduled', icon: '🔍', group: 'Complaints' },
  INSPECTION_COMPLETED: { label: 'Inspection completed', icon: '🔍', group: 'Complaints' },
  ACTION_CREATED: { label: 'Action created', icon: '🛠️', group: 'Complaints' },
  ACTION_UPDATED: { label: 'Action updated', icon: '🛠️', group: 'Complaints' },
  PROGRESS_UPDATED: { label: 'Progress updated', icon: '📈', group: 'Complaints' },
  EVIDENCE_UPLOADED: { label: 'Evidence uploaded', icon: '📷', group: 'Complaints' },
  STATUS_CHANGED: { label: 'Status changed', icon: '🔁', group: 'Complaints' },
  COMPLAINT_VERIFIED: { label: 'Complaint verified', icon: '✔️', group: 'Complaints' },
  COMPLAINT_REJECTED: { label: 'Complaint rejected', icon: '⛔', group: 'Complaints' },
  COMPLAINT_CLOSED: { label: 'Complaint closed', icon: '🔒', group: 'Complaints' },
  COMPLAINT_CLASSIFIED: { label: 'Classification / department changed', icon: '🏷️', group: 'Complaints' },
  SUPERVISOR_ASSIGNED: { label: 'Supervisor assigned', icon: '🧑‍💼', group: 'Complaints' },
  WORK_STARTED: { label: 'Work started', icon: '▶️', group: 'Complaints' },
  WORK_ON_HOLD: { label: 'Work put on hold', icon: '⏸️', group: 'Complaints' },
  WORK_RESUMED: { label: 'Work resumed', icon: '▶️', group: 'Complaints' },
  WORK_COMPLETED: { label: 'Work completed', icon: '✅', group: 'Complaints' },
  WORK_NOTE_ADDED: { label: 'Field note added', icon: '📝', group: 'Complaints' },
  NO_ISSUE_REPORTED: { label: 'No issue found (field report)', icon: '🚫', group: 'Complaints' },
  VERIFICATION_SUBMITTED: { label: 'Submitted for verification', icon: '📨', group: 'Complaints' },
  VERIFICATION_APPROVED: { label: 'Verification approved', icon: '🏁', group: 'Complaints' },
  VERIFICATION_REJECTED: { label: 'Verification rejected (rework)', icon: '↩️', group: 'Complaints' },
  REWORK_REQUIRED: { label: 'Rework required', icon: '↩️', group: 'Complaints' },
  COMPLAINT_AUTO_ESCALATED: { label: 'Escalated automatically (SLA)', icon: '⏰', group: 'Complaints' },
  COMPLAINT_REOPENED: { label: 'Complaint reopened', icon: '🔓', group: 'Complaints' },
  COMPLAINT_ESCALATED: { label: 'Complaint escalated', icon: '⬆️', group: 'Complaints' },
  COMPLAINT_REMARK: { label: 'Remark added', icon: '💬', group: 'Complaints' },
  COMPLAINT_SUPPORTED: { label: 'Citizen supported complaint', icon: '👥', group: 'Complaints' },
  WORK_ACCEPTED: { label: 'Work accepted', icon: '👍', group: 'Complaints' },
  APPEAL_CREATED: { label: 'Reconsideration requested', icon: '🔁', group: 'Complaints' },
  APPEAL_ACCEPTED: { label: 'Reconsideration accepted', icon: '🔁', group: 'Complaints' },
  APPEAL_REJECTED: { label: 'Reconsideration not accepted', icon: '🔁', group: 'Complaints' },
  LOCATION_CREATED: { label: 'Location created', icon: '📍', group: 'Locations' },
  LOCATION_UPDATED: { label: 'Location updated', icon: '📍', group: 'Locations' },
  WARD_CREATED: { label: 'Ward created', icon: '🏘️', group: 'Locations' },
  WARD_UPDATED: { label: 'Ward updated', icon: '🏘️', group: 'Locations' },
  WARD_MAP_CREATED: { label: 'Ward map feature added', icon: '🗺️', group: 'Locations' },
  WARD_MAP_UPDATED: { label: 'Ward map feature updated', icon: '🗺️', group: 'Locations' },
  WARD_MAP_ARCHIVED: { label: 'Ward map feature archived', icon: '🗺️', group: 'Locations' },
  DEPARTMENT_CREATED: { label: 'Department created', icon: '🏛️', group: 'Master data' },
  DEPARTMENT_UPDATED: { label: 'Department updated', icon: '🏛️', group: 'Master data' },
  MASTER_DATA_CREATED: { label: 'Master data created', icon: '🗂️', group: 'Master data' },
  MASTER_DATA_UPDATED: { label: 'Master data updated', icon: '🗂️', group: 'Master data' },
  POSTAL_IMPORT: { label: 'Postal data imported', icon: '📮', group: 'Master data' },
  POSTAL_EXPORT: { label: 'Postal data exported', icon: '📮', group: 'Master data' },
  SETTINGS_UPDATED: { label: 'System setting changed', icon: '⚙️', group: 'System' },
  AUDIT_EXPORTED: { label: 'Audit log exported', icon: '🧾', group: 'System' },
};

const LEGACY: Record<string, string> = {
  'user.create': 'USER_CREATED', 'user.update': 'USER_UPDATED', 'user.deactivate': 'USER_DEACTIVATED', 'user.activate': 'USER_REACTIVATED',
  'user.role_change': 'ROLE_CHANGED', 'user.password_reset': 'PASSWORD_RESET', 'user.password_change': 'PASSWORD_CHANGED', 'user.register': 'CITIZEN_REGISTERED',
  'user.bootstrap': 'USER_CREATED', 'complaint.create': 'COMPLAINT_CREATED', 'complaint.assigned': 'COMPLAINT_ASSIGNED', 'complaint.reassigned': 'COMPLAINT_REASSIGNED',
  'complaint.inspected': 'INSPECTION_COMPLETED', 'complaint.progress': 'PROGRESS_UPDATED', 'complaint.escalated': 'COMPLAINT_ESCALATED', 'complaint.remark': 'COMPLAINT_REMARK',
  'role.permission_grant': 'PERMISSION_CHANGED', 'role.permission_revoke': 'PERMISSION_CHANGED', 'settings.update': 'SETTINGS_UPDATED', 'audit.export': 'AUDIT_EXPORTED',
};

export function auditLabel(action: string) {
  const code = LEGACY[action] ?? action;
  if (AUDIT_LABELS[code]) return AUDIT_LABELS[code];
  if (action.startsWith('complaint.status.')) return { label: `Status → ${action.slice(17).toUpperCase()}`, icon: '🔁', group: 'Complaints' };
  if (action.startsWith('master.')) return { label: action.replace(/^master\./, '').replace(/\./g, ' '), icon: '🗂️', group: 'Master data' };
  return { label: action, icon: '•', group: 'Other' };
}

/** Summarise old → new without ever printing secrets (the log never stores them anyway). */
export function auditSummary(oldV: unknown, newV: unknown): string {
  const fmt = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const o = (oldV ?? {}) as Record<string, unknown>;
  const n = (newV ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])];
  return keys.slice(0, 12).map((k) => (k in o && k in n ? `${k}: ${fmt(o[k])} → ${fmt(n[k])}` : k in n ? `${k}: ${fmt(n[k])}` : `${k}: ${fmt(o[k])} (removed)`)).join(' · ');
}
