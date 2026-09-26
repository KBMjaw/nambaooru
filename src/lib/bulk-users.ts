import 'server-only';
import ExcelJS from 'exceljs';
import { sql } from './db';
import { has, type AuthUser } from './auth';
import { audit, type AuditInput } from './audit';
import { HttpError, badRequest } from './errors';
import { parseCsv } from './postal-import';
import { CreateUser, createUser, manageableRoles } from './users';
import { CitizenInput, createCitizen } from './citizens';
import { localBodyScope } from './scope';

/*
 * Bulk user creation from CSV / Excel.
 * Every row goes through exactly the same validation and authorisation as the single-user form
 * (createUser / createCitizen), inside one database transaction with a savepoint per row:
 *   VALIDATE        → everything is rolled back; the row-level report is returned
 *   ALL_OR_NOTHING  → committed only when every row is valid; otherwise nothing is created
 *   VALID_ONLY      → valid rows are committed; every failed row is reported explicitly
 */
export const TEMPLATE_COLUMNS = [
  'Full Name', 'Username', 'Mobile', 'Email', 'User Type', 'Role', 'Designation', 'Department', 'District', 'Taluk',
  'Local Body', 'Ward', 'Supervisor', 'Employee ID', 'Status',
] as const;
export const MAX_ROWS = 300;
export type BulkMode = 'VALIDATE' | 'ALL_OR_NOTHING' | 'VALID_ONLY';

export interface RowError { row: number; field?: string; message: string }
export interface BulkResult {
  importId: number | null; mode: BulkMode; total: number; valid: number; created: number; failed: number; committed: boolean;
  errors: RowError[]; createdUsers: { row: number; username: string; fullName: string; role: string; tempPassword: string | null }[];
}

const norm = (s: unknown) => String(s ?? '').trim();
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Parse CSV text or an .xlsx buffer into header-keyed records. */
export async function parseUpload(file: File): Promise<{ format: 'CSV' | 'XLSX'; records: Record<string, string>[] }> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  let rows: string[][];
  let format: 'CSV' | 'XLSX';
  if (name.endsWith('.xlsx') || isZip) {
    if (!isZip) throw badRequest('This file is not a valid Excel (.xlsx) workbook');
    format = 'XLSX';
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw badRequest('Could not read the Excel file'); }
    const ws = wb.worksheets.find((w) => w.name.toLowerCase() === 'users') ?? wb.worksheets[0];
    if (!ws) throw badRequest('The workbook has no sheets');
    rows = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      for (let c = 1; c <= Math.max(TEMPLATE_COLUMNS.length, r.cellCount); c++) {
        const v = r.getCell(c).value as unknown;
        const txt = v == null ? '' : typeof v === 'object' ? ('text' in (v as object) ? String((v as { text: unknown }).text) : 'result' in (v as object) ? String((v as { result: unknown }).result ?? '') : 'richText' in (v as object) ? (v as { richText: { text: string }[] }).richText.map((x) => x.text).join('') : '') : String(v);
        vals.push(txt);
      }
      rows.push(vals);
    });
  } else if (name.endsWith('.csv') || file.type.includes('csv') || file.type.startsWith('text/')) {
    format = 'CSV';
    const text = buf.toString('utf8').replace(/^﻿/, '');
    if (/[\u0000-\u0008]/.test(text.slice(0, 2000))) throw badRequest('File does not look like CSV text');
    rows = parseCsv(text);
  } else {
    throw badRequest('Upload a .csv or .xlsx file');
  }
  if (!rows.length) throw badRequest('The file is empty');
  const header = rows[0].map((h) => key(h));
  const need = ['fullname', 'username', 'mobile', 'role'];
  const missing = need.filter((n) => !header.includes(n));
  if (missing.length) throw badRequest(`Missing required column(s): ${missing.join(', ')}. Download the template.`);
  const cols = TEMPLATE_COLUMNS.map((c) => [c, header.indexOf(key(c))] as const);
  const records = rows.slice(1)
    .filter((r) => r.some((c) => norm(c) !== '') && !norm(r[0]).startsWith('#'))
    .map((r) => Object.fromEntries(cols.map(([c, i]) => [c, i >= 0 ? norm(r[i]) : ''])));
  if (records.length > MAX_ROWS) throw badRequest(`Too many rows (${records.length}). Upload at most ${MAX_ROWS} users per file.`);
  return { format, records };
}

interface Lookups {
  roles: Map<string, { code: string; portal: string }>;
  districts: Map<string, number>;
  taluks: { id: number; district_id: number; k: string }[];
  lbs: { id: number; district_id: number; taluk_id: number | null; k: string; k2: string; code: string }[];
  depts: { id: number; local_body_id: number | null; code: string; k: string }[];
  wards: Map<string, number>; // `${lb}:${n}`
}

async function lookups(): Promise<Lookups> {
  const [roles, districts, taluks, lbs, depts, wards] = await Promise.all([
    sql`SELECT code, name_en, portal FROM roles WHERE status = 'ACTIVE'`,
    sql`SELECT id, code, name_en, aliases FROM districts`,
    sql`SELECT id, district_id, name_en FROM taluks`,
    sql`SELECT lb.id, lb.district_id, lb.taluk_id, lb.name_en, lb.code, t.name_en AS type_en FROM local_bodies lb JOIN local_body_types t ON t.id = lb.type_id WHERE lb.status = 'ACTIVE'`,
    sql`SELECT id, local_body_id, code, name_en FROM departments WHERE status = 'ACTIVE'`,
    sql`SELECT id, local_body_id, ward_number FROM wards WHERE status = 'ACTIVE'`,
  ]);
  const rm = new Map<string, { code: string; portal: string }>();
  for (const r of roles) { rm.set(key(r.code as string), { code: r.code as string, portal: r.portal as string }); rm.set(key(r.name_en as string), { code: r.code as string, portal: r.portal as string }); }
  const dm = new Map<string, number>();
  for (const d of districts) { dm.set(key(d.name_en as string), d.id as number); dm.set(key(d.code as string), d.id as number); for (const a of (d.aliases as string[]) ?? []) dm.set(key(a), d.id as number); }
  return {
    roles: rm, districts: dm,
    taluks: taluks.map((x) => ({ id: x.id as number, district_id: x.district_id as number, k: key(x.name_en as string) })),
    // "Chennimalai", "Chennimalai Town Panchayat" and the code "TP-ERD-CHENNIMALAI" all match
    lbs: lbs.map((x) => ({ id: x.id as number, district_id: x.district_id as number, taluk_id: x.taluk_id as number | null, k: key(x.name_en as string),
      k2: key(`${x.name_en} ${String(x.type_en).split('/')[0]}`), code: key(x.code as string) })),
    depts: depts.map((x) => ({ id: x.id as number, local_body_id: x.local_body_id as number | null, code: key(x.code as string), k: key(x.name_en as string) })),
    wards: new Map(wards.map((w) => [`${w.local_body_id}:${w.ward_number}`, w.id as number])),
  };
}

/** Turn one spreadsheet record into ids, collecting precise field errors. */
function resolveRow(r: Record<string, string>, lk: Lookups, errs: (field: string, msg: string) => void) {
  const role = lk.roles.get(key(r.Role));
  if (!r.Role) errs('Role', 'Role is required');
  else if (!role) errs('Role', `Unknown role “${r.Role}”`);
  const type = key(r['User Type'] || '');
  const isCitizen = role?.code === 'CITIZEN' || type === 'citizen';
  if (type && !['official', 'staff', 'employee', 'citizen', 'user'].includes(type)) errs('User Type', 'User Type must be Official or Citizen');
  if (type === 'citizen' && role && role.code !== 'CITIZEN') errs('Role', 'A Citizen row must have Role = CITIZEN');
  let districtId: number | null = null;
  if (r.District) { districtId = lk.districts.get(key(r.District)) ?? null; if (!districtId) errs('District', `Unknown district “${r.District}”`); }
  let talukId: number | null = null;
  if (r.Taluk) {
    const t = lk.taluks.find((x) => x.k === key(r.Taluk) && (!districtId || x.district_id === districtId));
    if (!t) errs('Taluk', `Unknown taluk “${r.Taluk}”${r.District ? ` in ${r.District}` : ''}`); else { talukId = t.id; districtId ??= t.district_id; }
  }
  let localBodyId: number | null = null;
  if (r['Local Body']) {
    const want = key(r['Local Body']);
    const matches = lk.lbs.filter((x) => (x.k === want || x.k2 === want || x.code === want) && (!districtId || x.district_id === districtId) && (!talukId || !x.taluk_id || x.taluk_id === talukId));
    if (!matches.length) errs('Local Body', `Unknown local body “${r['Local Body']}”${r.District ? ` in ${r.District}` : ''}`);
    else if (matches.length > 1) errs('Local Body', `“${r['Local Body']}” is ambiguous — add the District or use the local body code`);
    else localBodyId = matches[0].id;
  }
  let departmentId: number | null = null;
  if (r.Department) {
    if (!localBodyId) errs('Department', 'Department needs a Local Body');
    else {
      const d = lk.depts.find((x) => x.local_body_id === localBodyId && (x.code === key(r.Department) || x.k === key(r.Department)));
      if (!d) errs('Department', `Department “${r.Department}” does not exist in this local body`); else departmentId = d.id;
    }
  }
  let wardId: number | null = null;
  if (r.Ward) {
    const n = Number(String(r.Ward).replace(/^ward\s*/i, ''));
    if (!localBodyId) errs('Ward', 'Ward needs a Local Body');
    else if (!Number.isInteger(n)) errs('Ward', 'Ward must be a ward number');
    else { wardId = lk.wards.get(`${localBodyId}:${n}`) ?? null; if (!wardId) errs('Ward', `Ward ${n} does not exist in this local body`); }
  }
  const status = (r.Status || 'ACTIVE').toUpperCase();
  if (!['ACTIVE', 'INACTIVE'].includes(status)) errs('Status', 'Status must be ACTIVE or INACTIVE');
  return { role, isCitizen, districtId, talukId, localBodyId, departmentId, wardId, status: status as 'ACTIVE' | 'INACTIVE' };
}

class Rollback extends Error {}

export async function runBulkImport(actor: AuthUser, file: File, mode: BulkMode): Promise<BulkResult> {
  const { format, records } = await parseUpload(file);
  if (!records.length) throw badRequest('No user rows found under the header');
  const lk = await lookups();
  const allowed = new Set((await manageableRoles(actor)).map((r) => r.code));
  const errors: RowError[] = [];
  const created: BulkResult['createdUsers'] = [];
  const audits: AuditInput[] = [];
  const seenUser = new Map<string, number>();
  const seenMobile = new Map<string, number>();
  let valid = 0;

  // In-file duplicate detection first (clear messages that point at both rows)
  records.forEach((r, i) => {
    const row = i + 2;
    const u = r.Username.toLowerCase();
    if (u) { if (seenUser.has(u)) errors.push({ row, field: 'Username', message: `Duplicate username in file (also row ${seenUser.get(u)})` }); else seenUser.set(u, row); }
    if (r.Mobile) {
      const isCitizen = key(r.Role) === 'citizen' || key(r['User Type']) === 'citizen';
      const mk = `${isCitizen ? 'c' : 'o'}:${r.Mobile}`;
      if (seenMobile.has(mk)) errors.push({ row, field: 'Mobile', message: `Duplicate mobile number in file (also row ${seenMobile.get(mk)})` }); else seenMobile.set(mk, row);
    }
  });
  const dupRows = new Set(errors.map((e) => e.row));

  let committed = false;
  try {
    await sql.begin(async (tx) => {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const row = i + 2;
        const rowErrs: RowError[] = [];
        const err = (field: string, message: string) => rowErrs.push({ row, field, message });
        const x = resolveRow(r, lk, err);
        if (x.role && !x.isCitizen && !allowed.has(x.role.code)) err('Role', `You are not allowed to create “${x.role.code}” users`);
        if (x.isCitizen && !has(actor, 'citizen.manage')) err('Role', 'You are not allowed to create citizen accounts');
        let supervisorId: string | null = null;
        if (r.Supervisor && !x.isCitizen) {
          const [s] = await tx`SELECT id FROM users WHERE lower(username) = ${r.Supervisor.toLowerCase()}`;
          if (!s) err('Supervisor', `Supervisor “${r.Supervisor}” not found (use an existing username or one from an earlier row)`); else supervisorId = s.id as string;
        }
        if (rowErrs.length || dupRows.has(row)) { errors.push(...rowErrs); continue; }
        const pending: AuditInput[] = [];
        try {
          const out = await tx.savepoint(async (sp) => {
            if (x.isCitizen) {
              const input = CitizenInput.parse({ fullName: r['Full Name'], mobile: r.Mobile, email: r.Email || null, username: r.Username || null, localBodyId: x.localBodyId, wardId: x.wardId, status: x.status });
              const res = await createCitizen(actor, input, { db: sp, fastHash: true, dryRun: mode === 'VALIDATE', auditSink: (a) => pending.push(a), source: 'BULK_IMPORT' });
              return { username: res.username, role: 'CITIZEN', tempPassword: res.tempPassword };
            }
            const input = CreateUser.parse({
              fullName: r['Full Name'], username: r.Username, mobile: r.Mobile, email: r.Email || null, role: x.role!.code, designation: r.Designation || null,
              employeeId: r['Employee ID'] || null, districtId: x.districtId, talukId: x.talukId, localBodyId: x.localBodyId, wardId: x.wardId,
              departmentId: x.departmentId, supervisorId, status: x.status,
            });
            const res = await createUser(actor, input, { db: sp, fastHash: true, dryRun: mode === 'VALIDATE', auditSink: (a) => pending.push(a), source: 'BULK_IMPORT' });
            return { username: input.username, role: input.role, tempPassword: res.tempPassword };
          });
          valid++;
          audits.push(...pending);
          created.push({ row, username: out.username, fullName: r['Full Name'], role: out.role, tempPassword: mode === 'VALIDATE' ? null : out.tempPassword });
        } catch (e) {
          if (e instanceof HttpError) {
            const det = (e.details ?? {}) as Record<string, string[]>;
            const field = Object.keys(det)[0];
            errors.push({ row, field: field ? fieldLabel(field) : undefined, message: e.message });
          } else if (e && typeof e === 'object' && 'issues' in e) {
            for (const is of (e as { issues: { path: (string | number)[]; message: string }[] }).issues) errors.push({ row, field: fieldLabel(String(is.path[0] ?? '')), message: is.message });
          } else if ((e as { code?: string }).code === '23505') {
            errors.push({ row, message: 'Duplicate value (username or mobile already exists)' });
          } else throw e;
        }
      }
      if (mode === 'VALIDATE' || (mode === 'ALL_OR_NOTHING' && errors.length)) throw new Rollback();
      committed = true;
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  errors.sort((a, b) => a.row - b.row);
  const createdCount = committed ? created.length : 0;
  const [imp] = await sql`
    INSERT INTO bulk_imports (file_name, file_format, mode, total_rows, created_count, failed_count, errors, created_by)
    VALUES (${file.name.slice(0, 200)}, ${format}, ${mode}, ${records.length}, ${createdCount}, ${new Set(errors.map((e) => e.row)).size}, ${sql.json(errors.slice(0, 1000) as never)}, ${actor.id})
    RETURNING id`;
  if (committed) {
    for (const a of audits) await audit(actor, { ...a, newValue: { ...(a.newValue as object), bulkImportId: imp.id } });
  }
  if (mode !== 'VALIDATE') {
    await audit(actor, { action: 'BULK_USER_IMPORT', entityType: 'bulk_import', entityId: imp.id as number,
      newValue: { file: file.name, format, mode, total: records.length, created: createdCount, failedRows: new Set(errors.map((e) => e.row)).size, committed } });
  }
  return {
    importId: imp.id as number, mode, total: records.length, valid, created: createdCount, failed: new Set(errors.map((e) => e.row)).size, committed, errors,
    createdUsers: committed ? created : created.map((c) => ({ ...c, tempPassword: null })),
  };
}

function fieldLabel(f: string) {
  const m: Record<string, string> = {
    fullName: 'Full Name', username: 'Username', mobile: 'Mobile', email: 'Email', role: 'Role', designation: 'Designation', employeeId: 'Employee ID',
    districtId: 'District', talukId: 'Taluk', localBodyId: 'Local Body', wardId: 'Ward', departmentId: 'Department', supervisorId: 'Supervisor', status: 'Status',
  };
  return m[f] ?? f;
}

/** Template with an instruction sheet and live reference lists (roles, local bodies, departments) from the database. */
export async function buildTemplate(actor: AuthUser, format: 'csv' | 'xlsx') {
  const example = ['S. Kumar', 'je.chennimalai', '9876543210', 'kumar@example.com', 'Official', 'SUPERVISOR', 'Junior Engineer', 'ENGINEERING', 'Erode', 'Perundurai',
    'Chennimalai Town Panchayat', '10', 'eo.chennimalai', 'CTP-JE-01', 'ACTIVE'];
  if (format === 'csv') {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return Buffer.from(`﻿${TEMPLATE_COLUMNS.join(',')}\n${example.map(esc).join(',')}\n`, 'utf8');
  }
  const [roles, lbs, depts] = await Promise.all([
    manageableRoles(actor),
    sql`SELECT lb.code, lb.name_en, d.name_en AS district, t.name_en AS taluk, (SELECT count(*) FROM wards w WHERE w.local_body_id = lb.id)::int AS wards
        FROM local_bodies lb JOIN districts d ON d.id = lb.district_id LEFT JOIN taluks t ON t.id = lb.taluk_id
        WHERE lb.status = 'ACTIVE' AND (${localBodyScope(actor)}) ORDER BY d.name_en, lb.name_en`,
    sql`SELECT DISTINCT ON (code) code, name_en FROM departments WHERE status = 'ACTIVE' ORDER BY code, name_en`,
  ]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Namma Ooru';
  const ws = wb.addWorksheet('Users', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c, key: c, width: Math.max(14, c.length + 4) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2957A4' } };
  ws.addRow(example);
  const roleCodes = [...roles.map((r) => r.code), ...(has(actor, 'citizen.manage') ? ['CITIZEN'] : [])];
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    ws.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Official,Citizen"'] };
    ws.getCell(r, 6).dataValidation = { type: 'list', allowBlank: false, formulae: [`Reference!$A$2:$A$${roleCodes.length + 1}`] };
    ws.getCell(r, 15).dataValidation = { type: 'list', allowBlank: true, formulae: ['"ACTIVE,INACTIVE"'] };
  }
  const ref = wb.addWorksheet('Reference');
  ref.getCell('A1').value = 'Role code'; ref.getCell('B1').value = 'Role name'; ref.getCell('D1').value = 'Local body code'; ref.getCell('E1').value = 'Local body';
  ref.getCell('F1').value = 'District'; ref.getCell('G1').value = 'Taluk'; ref.getCell('H1').value = 'Wards'; ref.getCell('J1').value = 'Department code'; ref.getCell('K1').value = 'Department';
  roleCodes.forEach((c, i) => { ref.getCell(i + 2, 1).value = c; ref.getCell(i + 2, 2).value = roles.find((r) => r.code === c)?.name_en ?? 'Citizen'; });
  lbs.forEach((l, i) => { ref.getCell(i + 2, 4).value = l.code as string; ref.getCell(i + 2, 5).value = l.name_en as string; ref.getCell(i + 2, 6).value = l.district as string; ref.getCell(i + 2, 7).value = (l.taluk as string) ?? ''; ref.getCell(i + 2, 8).value = l.wards as number; });
  depts.forEach((d, i) => { ref.getCell(i + 2, 10).value = d.code as string; ref.getCell(i + 2, 11).value = d.name_en as string; });
  ref.getRow(1).font = { bold: true };
  [12, 28, 2, 22, 34, 16, 16, 8, 2, 18, 28].forEach((w, i) => { ref.getColumn(i + 1).width = w; });
  const help = wb.addWorksheet('Instructions');
  [
    'Namma Ooru — bulk user upload',
    'Fill one user per row on the "Users" sheet. Delete the example row. Required: Full Name, Username, Mobile, Role.',
    'Role: a role code from the Reference sheet (custom roles such as JE, Electrician or Plumber appear there once created).',
    'User Type: Official (default) or Citizen. Citizens use Role = CITIZEN and need a Local Body.',
    'Local Body: name or code from the Reference sheet. Add District when two local bodies share a name.',
    'Department: department code or name inside that local body. Ward: ward number. Supervisor: an existing username (or one from an earlier row).',
    `Status: ACTIVE or INACTIVE. Maximum ${MAX_ROWS} rows per file.`,
    'Passwords are never part of the file: every new user gets a one-time temporary password and must change it at first login.',
    'Upload with "Validate only" first — nothing is created and every problem is listed by row and column.',
  ].forEach((line, i) => { help.getCell(i + 1, 1).value = line; if (i === 0) help.getCell(1, 1).font = { bold: true, size: 14 }; });
  help.getColumn(1).width = 130;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
