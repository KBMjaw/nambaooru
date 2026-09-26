import 'server-only';
import { sql } from './db';

export async function getComplaintDetail(where: { code: string }) {
  const [c] = await sql`
    SELECT c.*, cat.code AS category_code, cat.name_en AS category_en, cat.name_ta AS category_ta, cat.icon, cat.inspection_required, cat.evidence_required,
           d.name_en AS dept_en, d.name_ta AS dept_ta, w.ward_number,
           it.name_en AS issue_en, it.name_ta AS issue_ta, sd.name_en AS sdept_en, sd.name_ta AS sdept_ta, dab.full_name AS dept_assigned_by_name,
           rbu.full_name AS resolved_by_name, s.name_en AS street_en, s.name_ta AS street_ta,
           lb.name_en AS lb_en, lb.name_ta AS lb_ta, lb.center_lat AS lb_lat, lb.center_lng AS lb_lng,
           au.full_name AS assigned_name, ar.name_en AS assigned_role_en, ar.name_ta AS assigned_role_ta, ao.designation AS assigned_designation,
           iu.full_name AS inspector_name,
           dup.code AS duplicate_of_code, pdup.code AS possible_duplicate_code,
           cu.full_name AS citizen_name, cu.mobile AS citizen_mobile
    FROM complaints c
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN complaint_issue_types it ON it.id = c.issue_type_id
    LEFT JOIN departments sd ON sd.id = c.suggested_department_id
    LEFT JOIN users dab ON dab.id = c.department_assigned_by
    LEFT JOIN users rbu ON rbu.id = c.resolved_by
    LEFT JOIN wards w ON w.id = c.ward_id
    LEFT JOIN streets s ON s.id = c.street_id
    LEFT JOIN local_bodies lb ON lb.id = c.local_body_id
    LEFT JOIN users au ON au.id = c.assigned_to LEFT JOIN roles ar ON ar.id = au.role_id LEFT JOIN officials ao ON ao.user_id = au.id
    LEFT JOIN users iu ON iu.id = c.inspector_id
    LEFT JOIN complaints dup ON dup.id = c.duplicate_of_id
    LEFT JOIN complaints pdup ON pdup.id = c.possible_duplicate_of_id
    JOIN users cu ON cu.id = c.citizen_id
    WHERE c.code = ${where.code}`;
  if (!c) return null;
  const id = c.id as number;
  const [history, evidence, inspections, assignments, updates, completions, appeals] = await Promise.all([
    sql`SELECT h.*, r.code AS actor_role FROM complaint_status_history h LEFT JOIN users u ON u.id = h.actor_id LEFT JOIN roles r ON r.id = u.role_id
        WHERE h.complaint_id = ${id} ORDER BY h.created_at, h.id`,
    sql`SELECT e.id, e.kind, e.media_type, e.latitude, e.longitude, e.gps_accuracy_m, e.captured_at, e.capture_source, e.created_at, e.appeal_id,
               u.full_name AS uploaded_by_name
        FROM complaint_evidence e JOIN users u ON u.id = e.uploaded_by WHERE e.complaint_id = ${id} ORDER BY e.created_at`,
    sql`SELECT i.*, u.full_name AS inspector_name FROM inspections i JOIN users u ON u.id = i.inspector_id WHERE i.complaint_id = ${id} ORDER BY i.inspected_at DESC`,
    sql`SELECT a.*, u.full_name AS assignee_name, r.code AS assignee_role_code, r.name_en AS assignee_role_en, r.name_ta AS assignee_role_ta, b.full_name AS assigned_by_name
        FROM assignments a JOIN users u ON u.id = a.assigned_to JOIN roles r ON r.id = u.role_id JOIN users b ON b.id = a.assigned_by
        WHERE a.complaint_id = ${id} ORDER BY a.created_at DESC`,
    sql`SELECT w.*, u.full_name AS user_name FROM work_updates w JOIN users u ON u.id = w.user_id WHERE w.complaint_id = ${id} ORDER BY w.created_at DESC`,
    sql`SELECT ce.*, u.full_name AS completed_by_name, v.full_name AS verified_by_name FROM completion_evidence ce
        JOIN users u ON u.id = ce.completed_by LEFT JOIN users v ON v.id = ce.verified_by WHERE ce.complaint_id = ${id} ORDER BY ce.completed_at DESC`,
    sql`SELECT a.*, r.full_name AS reviewer_name FROM appeals a LEFT JOIN users r ON r.id = a.reviewer_id WHERE a.complaint_id = ${id} ORDER BY a.created_at DESC`,
  ]);
  const progress = (updates.find((u) => u.progress_pct != null)?.progress_pct as number | undefined) ?? (['WORK_COMPLETED', 'VERIFICATION_PENDING', 'COMPLETION_VERIFIED', 'CLOSED'].includes(c.status as string) ? 100 : null);
  return { c, history: [...history], evidence: [...evidence], inspections: [...inspections], assignments: [...assignments], updates: [...updates], completions: [...completions], appeals: [...appeals], progress };
}

export type ComplaintDetail = NonNullable<Awaited<ReturnType<typeof getComplaintDetail>>>;

/** Staff an official can assign on this complaint, its departments and its actions (for the work panels). */
export async function complaintWorkData(u: import('./auth').AuthUser, c: Record<string, unknown>) {
  const { assignableScope } = await import('./scope');
  const { listActions } = await import('./complaint-actions');
  const { has } = await import('./auth');
  const [staff, depts, actions] = await Promise.all([
    sql`SELECT usr.id, usr.full_name, r.code AS role, r.name_en AS role_name, r.default_scope AS scope, o.designation FROM users usr JOIN roles r ON r.id = usr.role_id JOIN officials o ON o.user_id = usr.id
        WHERE ${assignableScope(u, c.local_body_id as number)} ORDER BY r.rank DESC, usr.full_name`,
    sql`SELECT id, name_en FROM departments WHERE local_body_id = ${c.local_body_id as number} AND status = 'ACTIVE' ORDER BY name_en`,
    listActions(c.id as number),
  ]);
  const self = { id: u.id, full_name: `${u.fullName} (me)`, role: u.role, role_name: u.roleNameEn, designation: null };
  // Supervisors: department-level officials this user may assign, plus the user themself when department / local-body level
  const supervisors = [
    ...(u.scope === 'DEPARTMENT' || u.scope === 'LOCAL_BODY' ? [self] : []),
    ...staff.filter((s) => s.scope === 'DEPARTMENT').map((s) => ({ id: s.id as string, full_name: s.full_name as string, role: s.role as string, role_name: s.role_name as string, designation: (s.designation as string) ?? null })),
  ];
  return {
    supervisors,
    staff: [...staff].filter((s) => s.scope === 'ASSIGNED' || s.scope === 'DEPARTMENT').map((s) => ({ id: s.id as string, full_name: s.full_name as string, role: s.role as string, role_name: s.role_name as string, designation: (s.designation as string) ?? null })),
    staffWithSelf: [self, ...staff.map((s) => ({ id: s.id as string, full_name: s.full_name as string, role: s.role as string, role_name: s.role_name as string, designation: (s.designation as string) ?? null }))],
    departments: [...depts].map((d) => ({ id: d.id as number, name_en: d.name_en as string })),
    actions: JSON.parse(JSON.stringify(actions)),
    perms: { create: has(u, 'action.create'), edit: has(u, 'action.edit'), verify: has(u, 'complaint.verify'), work: has(u, 'complaint.work') || has(u, 'evidence.upload') },
  };
}
