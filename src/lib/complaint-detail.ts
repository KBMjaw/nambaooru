import 'server-only';
import { sql } from './db';

export async function getComplaintDetail(where: { code: string }) {
  const [c] = await sql`
    SELECT c.*, cat.code AS category_code, cat.name_en AS category_en, cat.name_ta AS category_ta, cat.icon, cat.inspection_required, cat.evidence_required,
           d.name_en AS dept_en, d.name_ta AS dept_ta, w.ward_number, s.name_en AS street_en, s.name_ta AS street_ta,
           lb.name_en AS lb_en, lb.name_ta AS lb_ta, lb.center_lat AS lb_lat, lb.center_lng AS lb_lng,
           au.full_name AS assigned_name, ar.name_en AS assigned_role_en, ar.name_ta AS assigned_role_ta, ao.designation AS assigned_designation,
           iu.full_name AS inspector_name,
           dup.code AS duplicate_of_code, pdup.code AS possible_duplicate_code,
           cu.full_name AS citizen_name, cu.mobile AS citizen_mobile
    FROM complaints c
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    LEFT JOIN departments d ON d.id = c.department_id
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
    sql`SELECT a.*, u.full_name AS assignee_name, r.code AS assignee_role, b.full_name AS assigned_by_name
        FROM assignments a JOIN users u ON u.id = a.assigned_to JOIN roles r ON r.id = u.role_id JOIN users b ON b.id = a.assigned_by
        WHERE a.complaint_id = ${id} ORDER BY a.created_at DESC`,
    sql`SELECT w.*, u.full_name AS user_name FROM work_updates w JOIN users u ON u.id = w.user_id WHERE w.complaint_id = ${id} ORDER BY w.created_at DESC`,
    sql`SELECT ce.*, u.full_name AS completed_by_name, v.full_name AS verified_by_name FROM completion_evidence ce
        JOIN users u ON u.id = ce.completed_by LEFT JOIN users v ON v.id = ce.verified_by WHERE ce.complaint_id = ${id} ORDER BY ce.completed_at DESC`,
    sql`SELECT a.*, r.full_name AS reviewer_name FROM appeals a LEFT JOIN users r ON r.id = a.reviewer_id WHERE a.complaint_id = ${id} ORDER BY a.created_at DESC`,
  ]);
  const progress = (updates.find((u) => u.progress_pct != null)?.progress_pct as number | undefined) ?? (c.status === 'WORK_COMPLETED' || c.status === 'COMPLETION_VERIFIED' || c.status === 'CLOSED' ? 100 : null);
  return { c, history: [...history], evidence: [...evidence], inspections: [...inspections], assignments: [...assignments], updates: [...updates], completions: [...completions], appeals: [...appeals], progress };
}

export type ComplaintDetail = NonNullable<Awaited<ReturnType<typeof getComplaintDetail>>>;
