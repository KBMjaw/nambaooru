import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { sql } from './db';
import type { AuthUser } from './auth';
import { complaintScope, localBodyScope } from './scope';
import { filterSql, type Filters } from './office-queries';

export const REPORT_LIMIT = 5000;

/**
 * Complaint rows for export. Always limited to the exporter's jurisdiction (complaintScope) plus the chosen
 * filters. No citizen personal data (name, mobile, address, words) is included.
 */
export async function reportRows(u: AuthUser, f: Filters) {
  return sql`
    SELECT c.code, c.submitted_at, c.status, c.resolution_type, c.priority, c.escalation_level,
           cat.name_en AS category, sc.name_en AS subcategory, it.name_en AS issue_type, d.name_en AS department,
           dist.name_en AS district, lb.name_en AS local_body, w.ward_number, COALESCE(s.name_en, c.street_text) AS street,
           (SELECT string_agg(x.full_name, '; ') FROM assignments a JOIN users x ON x.id = a.assigned_to
             WHERE a.complaint_id = c.id AND a.purpose = 'WORK' AND a.assignee_role IN ('PRIMARY','SUPPORT') AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS','COMPLETED')) AS field_staff,
           (SELECT x.full_name FROM assignments a JOIN users x ON x.id = a.assigned_to
             WHERE a.complaint_id = c.id AND a.assignee_role = 'SUPERVISOR' AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS') ORDER BY a.created_at DESC LIMIT 1) AS supervisor,
           c.sla_due_at, (c.sla_due_at < COALESCE(c.closed_at, c.resolved_at, now())) AS overdue, c.work_completed_at, c.closed_at, c.resolved_at
    FROM complaints c
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    LEFT JOIN complaint_subcategories sc ON sc.id = c.subcategory_id
    LEFT JOIN complaint_issue_types it ON it.id = c.issue_type_id
    LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN local_bodies lb ON lb.id = c.local_body_id
    LEFT JOIN districts dist ON dist.id = lb.district_id
    LEFT JOIN wards w ON w.id = c.ward_id
    LEFT JOIN streets s ON s.id = c.street_id
    WHERE c.status <> 'DRAFT' AND (${complaintScope(u)}) AND ${filterSql(f, u)}
    ORDER BY c.submitted_at DESC NULLS LAST
    LIMIT ${REPORT_LIMIT}`;
}

/** Department, ward and status summaries for the same scope and filters. */
export async function reportSummary(u: AuthUser, f: Filters) {
  const where = sql`c.status <> 'DRAFT' AND (${complaintScope(u)}) AND ${filterSql(f, u)}`;
  const base = sql`FROM complaints c LEFT JOIN complaint_categories cat ON cat.id = c.category_id LEFT JOIN wards w ON w.id = c.ward_id
                   LEFT JOIN departments d ON d.id = c.department_id LEFT JOIN local_bodies lb ON lb.id = c.local_body_id LEFT JOIN streets s ON s.id = c.street_id`;
  const open = sql`c.status NOT IN ('CLOSED','REJECTED','DUPLICATE')`;
  const [[totals], byDept, byWard, byStatus] = await Promise.all([
    sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE ${open})::int AS pending,
               count(*) FILTER (WHERE c.status = 'CLOSED')::int AS closed,
               count(*) FILTER (WHERE c.status IN ('VERIFICATION_PENDING','WORK_COMPLETED'))::int AS verification,
               count(*) FILTER (WHERE c.sla_due_at < now() AND ${open})::int AS overdue,
               count(*) FILTER (WHERE c.resolution_type = 'NO_ISSUE_FOUND')::int AS no_issue,
               count(*) FILTER (WHERE c.status = 'CLOSED' AND c.closed_at <= c.sla_due_at)::int AS closed_in_sla,
               round(avg(EXTRACT(EPOCH FROM (c.closed_at - c.submitted_at)) / 3600) FILTER (WHERE c.status = 'CLOSED'))::int AS avg_hours
        ${base} WHERE ${where}`,
    sql`SELECT COALESCE(d.name_en, '—') AS name, count(*)::int AS n, count(*) FILTER (WHERE ${open})::int AS pending,
               count(*) FILTER (WHERE c.status = 'CLOSED')::int AS closed, count(*) FILTER (WHERE c.sla_due_at < now() AND ${open})::int AS overdue,
               round(avg(EXTRACT(EPOCH FROM (c.closed_at - c.submitted_at)) / 3600) FILTER (WHERE c.status = 'CLOSED'))::int AS avg_hours
        ${base} WHERE ${where} GROUP BY 1 ORDER BY n DESC LIMIT 30`,
    sql`SELECT COALESCE(lb.name_en || ' – Ward ' || w.ward_number, lb.name_en, '—') AS name, count(*)::int AS n, count(*) FILTER (WHERE ${open})::int AS pending,
               count(*) FILTER (WHERE c.status = 'CLOSED')::int AS closed, count(*) FILTER (WHERE c.sla_due_at < now() AND ${open})::int AS overdue
        ${base} WHERE ${where} GROUP BY 1 ORDER BY n DESC LIMIT 30`,
    sql`SELECT c.status, count(*)::int AS n ${base} WHERE ${where} GROUP BY 1 ORDER BY n DESC`,
  ]);
  return { totals: totals as Record<string, number>, byDept: [...byDept], byWard: [...byWard], byStatus: [...byStatus] };
}

/** Filter choices limited to what the user can see. */
export async function reportFilterOptions(u: AuthUser, f: Filters) {
  const lbs = await sql`SELECT lb.id, lb.name_en, lb.district_id, lb.taluk_id FROM local_bodies lb WHERE lb.status = 'ACTIVE' AND (${localBodyScope(u)}) ORDER BY lb.name_en`;
  const lbIds = lbs.map((l) => l.id as number);
  const none = sql`SELECT NULL WHERE false`;
  const [districts, taluks, wards, depts, cats, staff] = await Promise.all([
    lbIds.length ? sql`SELECT DISTINCT d.id, d.name_en FROM districts d JOIN local_bodies lb ON lb.district_id = d.id WHERE lb.id IN ${sql(lbIds)} ORDER BY d.name_en` : none,
    lbIds.length ? sql`SELECT DISTINCT t.id, t.name_en FROM taluks t JOIN local_bodies lb ON lb.taluk_id = t.id WHERE lb.id IN ${sql(lbIds)} ${Number(f.district) ? sql`AND lb.district_id = ${Number(f.district)}` : sql``} ORDER BY t.name_en` : none,
    f.lb && lbIds.includes(Number(f.lb)) ? sql`SELECT id, ward_number FROM wards WHERE local_body_id = ${Number(f.lb)} ORDER BY ward_number` : none,
    lbIds.length ? sql`SELECT id, name_en FROM departments WHERE status = 'ACTIVE' AND local_body_id IN ${sql(f.lb && lbIds.includes(Number(f.lb)) ? [Number(f.lb)] : lbIds)} ORDER BY name_en` : none,
    sql`SELECT code, name_en FROM complaint_categories WHERE status = 'ACTIVE' ORDER BY sort_order`,
    lbIds.length ? sql`SELECT DISTINCT usr.id, usr.full_name, r.name_en AS role FROM users usr JOIN roles r ON r.id = usr.role_id JOIN officials o ON o.user_id = usr.id
                       WHERE o.local_body_id IN ${sql(lbIds)} AND r.default_scope IN ('ASSIGNED','DEPARTMENT') ORDER BY usr.full_name LIMIT 300` : none,
  ]);
  return { districts: [...districts], taluks: [...taluks], localBodies: [...lbs], wards: [...wards], depts: [...depts], categories: [...cats], staff: [...staff] };
}

const COLS: [key: string, label: string][] = [
  ['code', 'Complaint No.'], ['submitted_at', 'Submitted'], ['status', 'Status'], ['resolution_type', 'Resolution'], ['priority', 'Priority'],
  ['category', 'Category'], ['subcategory', 'Sub-category'], ['issue_type', 'Issue type'], ['department', 'Department'],
  ['district', 'District'], ['local_body', 'Local body'], ['ward_number', 'Ward'], ['street', 'Street / area'],
  ['supervisor', 'Supervisor'], ['field_staff', 'Field staff'], ['sla_due_at', 'Due'], ['overdue', 'Overdue'], ['escalation_level', 'Escalation level'],
  ['work_completed_at', 'Work completed'], ['closed_at', 'Closed'],
];
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 16) : v == null ? '' : String(v));

export function toCsv(rows: Record<string, unknown>[]) {
  // Neutralise spreadsheet formulas (CSV injection) and quote every field
  const cell = (v: unknown) => {
    let s = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : iso(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return '﻿' + [COLS.map(([, l]) => cell(l)).join(','), ...rows.map((r) => COLS.map(([k]) => cell(r[k])).join(','))].join('\r\n');
}

/** A4 landscape PDF: summary, department and ward tables, then the complaint list. Latin text only (standard font). */
export async function toPdf(title: string, filtersText: string, summary: Awaited<ReturnType<typeof reportSummary>>, rows: Record<string, unknown>[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setProducer('Namma Ooru'); doc.setCreator('Namma Ooru');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 32;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const safe = (s: unknown) => iso(s).replace(/[^\x20-\x7E]/g, '?');
  const fit = (s: string, f: PDFFont, size: number, max: number) => {
    let t = s;
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2);
    return t === s ? s : `${t}…`.replace('…', '.');
  };
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const text = (s: string, x: number, size = 9, f = font, color = rgb(0.1, 0.1, 0.15)) => page.drawText(s, { x, y, size, font: f, color });
  const table = (head: string[], widths: number[], body: unknown[][], size = 7.5) => {
    const row = (cells: unknown[], f: PDFFont) => {
      if (y < M + 14) { newPage(); row(head, bold); }
      let x = M;
      cells.forEach((c, i) => { text(fit(safe(c), f, size, widths[i] - 4), x, size, f); x += widths[i]; });
      y -= size + 5;
    };
    row(head, bold);
    page.drawLine({ start: { x: M, y: y + size + 2 }, end: { x: W - M, y: y + size + 2 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    for (const r of body) row(r, font);
    y -= 8;
  };
  text(safe(title), M, 16, bold); y -= 16;
  text(safe(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${filtersText}`), M, 8, font, rgb(0.35, 0.35, 0.4)); y -= 18;
  const tt = summary.totals;
  text(`Total ${tt.total}   Pending ${tt.pending}   Verification pending ${tt.verification}   Closed ${tt.closed} (${tt.closed_in_sla} within SLA)   Overdue ${tt.overdue}   No issue found ${tt.no_issue}   Avg hours to close ${tt.avg_hours ?? '-'}`, M, 9, bold); y -= 18;
  text('Department performance', M, 11, bold); y -= 14;
  table(['Department', 'Total', 'Pending', 'Closed', 'Overdue', 'Avg hours'], [300, 80, 80, 80, 80, 80], summary.byDept.map((d) => [d.name, d.n, d.pending, d.closed, d.overdue, d.avg_hours ?? '-']));
  text('Ward-wise', M, 11, bold); y -= 14;
  table(['Local body / ward', 'Total', 'Pending', 'Closed', 'Overdue'], [300, 80, 80, 80, 80], summary.byWard.map((d) => [d.name, d.n, d.pending, d.closed, d.overdue]));
  text(`Complaints (${rows.length}${rows.length >= REPORT_LIMIT ? `, first ${REPORT_LIMIT}` : ''})`, M, 11, bold); y -= 14;
  const cols: [string, string, number][] = [['code', 'Complaint No.', 78], ['submitted_at', 'Submitted', 62], ['status', 'Status', 84], ['priority', 'Priority', 44], ['issue_type', 'Issue', 110],
    ['department', 'Department', 92], ['local_body', 'Local body', 70], ['ward_number', 'Ward', 28], ['field_staff', 'Field staff', 90], ['sla_due_at', 'Due', 62], ['overdue', 'Late', 26], ['closed_at', 'Closed', 32]];
  table(cols.map((c) => c[1]), cols.map((c) => c[2]), rows.map((r) => cols.map(([k]) => (k === 'overdue' ? (r[k] ? 'Yes' : '') : k === 'issue_type' ? (r.issue_type ?? r.category) : k === 'closed_at' ? (r[k] ? 'Yes' : '') : k.endsWith('_at') ? iso(r[k]).slice(0, 10) : r[k]))));
  return doc.save();
}
