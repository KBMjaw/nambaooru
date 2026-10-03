// Admin / RBAC / jurisdiction / audit end-to-end test against a running server.
//   IMG_DIR=dir node tests/admin-e2e.mjs [baseUrl] [passwords.json]
// passwords.json maps demo usernames to their passwords. Creates clearly-labelled test records.
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
const IMG = process.env.IMG_DIR ?? '.';
const TS = Date.now().toString().slice(-6);
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };

class Client {
  cookies = {};
  async req(path, { method, body, form } = {}) {
    const headers = { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method: method ?? (body || form ? 'POST' : 'GET'), headers, body: form ?? (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); this.cookies[k] = v.join('='); }
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, buf, location: res.headers.get('location'), type: res.headers.get('content-type') };
  }
}
const login = async (portal, id, pw) => { const c = new Client(); const r = await c.req('/api/auth/login', { body: { portal, identifier: id, password: pw } }); return { c, r }; };
const staff = async (portal, username) => { const { c, r } = await login(portal, username, creds[username]); ok(r.status === 200, `login ${username} (${portal})`); return c; };
const GPS = { latitude: 11.1650, longitude: 77.6040, accuracy: 12 };
const photo = (name) => new Blob([readFileSync(`${IMG}/${name}.jpg`)], { type: 'image/jpeg' });

const sa = await staff('ADMIN', 'superadmin');
const adm = await staff('ADMIN', 'sysadmin');
const eo = await staff('OFFICE', 'eo.chennimalai');
const eo2 = await staff('OFFICE', 'eo.perundurai');
const sup = await staff('OFFICE', 'sup.electrical');
const ravi = await staff('OFFICE', 'field.ravi');
const muthu = await staff('OFFICE', 'field.muthu');

// ---------------------------------------------------------------- lookups
const opts = (await adm.req('/api/admin/users/options')).json;
const chen = opts.localBodies.find((l) => l.name_en.startsWith('Chennimalai'));
const peru = opts.localBodies.find((l) => l.name_en.startsWith('Perundurai'));
const chenOpts = (await adm.req(`/api/admin/users/options?lb=${chen.id}`)).json;
const eng = chenOpts.departments.find((d) => d.code === 'ENGINEERING');
const elec = chenOpts.departments.find((d) => d.code === 'ELECTRICAL');
const w10 = chenOpts.wards.find((w) => w.ward_number === 10);
ok(chen && peru && eng && elec && w10, 'lookups: local bodies, departments, ward 10');

// ---------------------------------------------------------------- Super Admin protection
const saRow = (await adm.req('/api/admin/users?q=superadmin')).json.rows.find((u) => u.username === 'superadmin');
ok(!!saRow, 'Admin can see the Super Admin account in the directory');
ok((await adm.req(`/api/admin/users/${saRow.id}`, { method: 'PATCH', body: { status: 'INACTIVE', reason: 'test' } })).status === 403, 'Admin cannot deactivate Super Admin');
ok((await adm.req(`/api/admin/users/${saRow.id}`, { method: 'PATCH', body: { fullName: 'Hacked' } })).status === 403, 'Admin cannot edit Super Admin');
ok((await adm.req(`/api/admin/users/${saRow.id}`, { method: 'PATCH', body: { role: 'SYSTEM_ADMIN', reason: 'test' } })).status === 403, 'Admin cannot change Super Admin role');
ok((await adm.req(`/api/admin/users/${saRow.id}/password`, { body: { reason: 'test reset' } })).status === 403, 'Admin cannot reset Super Admin password');
ok((await adm.req(`/api/admin/users/${saRow.id}/permissions`, { body: { permission: 'audit.view', effect: 'DENY', reason: 'test' } })).status === 403, 'Admin cannot change Super Admin permissions');
ok((await adm.req('/api/admin/users', { body: { username: `sa.${TS}`, fullName: 'Rogue SA', mobile: '9876500001', role: 'SUPER_ADMIN' } })).status === 403, 'Admin cannot create a Super Admin');
ok((await adm.req('/api/admin/users', { body: { username: `adm.${TS}`, fullName: 'Peer Admin', mobile: '9876500002', role: 'SYSTEM_ADMIN' } })).status === 403, 'Admin cannot create another Admin');
const detail = await adm.req(`/api/admin/users/${saRow.id}`);
ok(detail.status === 200 && !detail.text.includes('password_hash') && !detail.text.includes('$2'), 'user detail API never exposes password hashes');
const saCreates = await sa.req('/api/admin/users', { body: { username: `admin.${TS}`, fullName: 'Test Admin', mobile: `98765${TS.slice(-5)}`, role: 'SYSTEM_ADMIN' } });
ok(saCreates.status === 200 && saCreates.json.tempPassword, 'Super Admin can create an Admin (temporary password returned once)');

// ---------------------------------------------------------------- custom role
const roleName = `Junior Engineer T${TS}`;
ok((await adm.req('/api/admin/roles', { body: { name_en: `Bad ${TS}`, default_scope: 'ASSIGNED', rank: 30, permissions: ['settings.manage'] } })).status === 403, 'Admin cannot put a security permission into a role');
ok((await adm.req('/api/admin/roles', { body: { name_en: `Too High ${TS}`, default_scope: 'LOCAL_BODY', rank: 95, permissions: [] } })).status === 400, 'role rank above the creator is refused');
const role = await adm.req('/api/admin/roles', { body: { name_en: roleName, name_ta: 'இளநிலைப் பொறியாளர்', description: 'Test JE', department_code: 'ENGINEERING', default_scope: 'DEPARTMENT', rank: 50,
  permissions: ['complaint.view.department', 'complaint.inspect', 'action.create', 'action.edit', 'complaint.work', 'evidence.upload'] } });
ok(role.status === 200 && role.json.code, `Admin creates custom role ${role.json?.code}`);
const roles = (await adm.req('/api/admin/roles')).json.roles;
const je = roles.find((r) => r.code === role.json.code);
ok(je && je.permissions.length === 6 && je.default_scope === 'DEPARTMENT', 'custom role stored with its permissions and scope');
ok((await adm.req(`/api/admin/roles/${je.id}`, { method: 'PATCH', body: { permissions: [...je.permissions, 'map.view'], reason: 'needs map' } })).status === 200, 'Admin edits role permissions');

// ---------------------------------------------------------------- create user with custom role → forced password change
const jeUser = `je.${TS}`;
const created = await adm.req('/api/admin/users', { body: { username: jeUser, fullName: 'Test JE', mobile: `97${TS}01`.slice(0, 10), role: je.code, localBodyId: chen.id, departmentId: eng.id, employeeId: `JE-${TS}` } });
ok(created.status === 200 && created.json.tempPassword, `create ${je.code} user with temporary password (${created.json?.message ?? ''})`);
const { c: jeC, r: jeLogin } = await login('OFFICE', jeUser, created.json.tempPassword);
ok(jeLogin.status === 200 && jeLogin.json.redirect === '/office/password', 'custom-role user logs in and is sent to set a new password');
ok((await jeC.req('/api/office/users')).status === 403, 'API blocked until the temporary password is changed');
ok((await jeC.req('/office')).location?.includes('/office/password'), 'pages redirect to the password screen');
ok((await jeC.req('/api/profile?portal=OFFICE', { body: { currentPassword: created.json.tempPassword, newPassword: 'password1' } })).status === 400, 'weak / common new password refused');
const newPw = `Je${TS}pass9`;
ok((await jeC.req('/api/profile?portal=OFFICE', { body: { currentPassword: created.json.tempPassword, newPassword: newPw } })).status === 200, 'user sets own password (forced change completed)');
ok((await jeC.req('/office')).status === 200, 'custom-role user can use the officer portal');
const jeId = created.json.id;

// ---------------------------------------------------------------- jurisdiction isolation
ok((await eo.req(`/api/office/users/${jeId}`)).status === 200, 'EO Chennimalai sees the new JE');
ok((await eo2.req(`/api/office/users/${jeId}`)).status === 404, 'EO Perundurai cannot see a Chennimalai user (404)');
const eo2List = (await eo2.req('/api/office/users')).json.rows;
ok(!eo2List.some((u) => u.local_body_id === chen.id) && !eo2List.some((u) => u.portal === 'ADMIN'), 'EO Perundurai list has no Chennimalai or admin accounts');
ok((await eo2.req('/api/office/users', { body: { username: `x.${TS}`, fullName: 'Cross LB', mobile: '9876500003', role: 'FIELD_STAFF', localBodyId: chen.id } })).status === 403, 'EO cannot create users in another local body');
ok((await eo.req('/api/office/users', { body: { username: `eo.${TS}`, fullName: 'Peer EO', mobile: '9876500004', role: 'EO', localBodyId: chen.id } })).status === 403, 'EO cannot create another EO');
ok((await eo.req(`/api/office/users/${saRow.id}`)).status === 404, 'EO cannot even see the Super Admin account');
ok((await eo.req('/api/admin/users')).status === 401, 'EO has no admin-portal session');
const worker = await eo.req('/api/office/users', { body: { username: `plumber.${TS}`, fullName: 'Test Plumber', mobile: `96${TS}02`.slice(0, 10), role: 'FIELD_STAFF', localBodyId: chen.id, wardId: w10.id, designation: 'Plumber' } });
ok(worker.status === 200 && worker.json.tempPassword, 'EO creates a worker in own local body');
const wDet = (await eo.req(`/api/office/users/${worker.json?.id}`)).json;
ok(wDet?.user?.local_body_id === chen.id && wDet.jurisdictions.some((j) => j.is_primary && j.ward_number === 10), 'worker bound to Chennimalai ward 10 jurisdiction');

// ---------------------------------------------------------------- role change, jurisdiction change, deactivate (reasons + history)
ok((await adm.req(`/api/admin/users/${jeId}`, { method: 'PATCH', body: { role: 'SUPERVISOR' } })).status === 400, 'role change without a reason is refused');
ok((await adm.req(`/api/admin/users/${jeId}`, { method: 'PATCH', body: { role: 'SUPERVISOR', departmentId: elec.id, reason: 'Promoted' } })).status === 200, 'role + department change with reason');
ok((await adm.req(`/api/admin/users/${jeId}/jurisdictions`, { body: { localBodyId: peru.id, reason: 'Additional charge of Perundurai' } })).status === 200, 'extra jurisdiction granted');
ok((await eo2.req(`/api/office/users/${jeId}`)).status === 404, 'EO Perundurai still cannot see the user (primary LB is Chennimalai)');
const jeDetail = (await adm.req(`/api/admin/users/${jeId}`)).json;
ok(jeDetail.roleHistory.length === 2 && jeDetail.jurisdictions.filter((j) => !j.revoked_at).length === 2 && jeDetail.jurisdictions.some((j) => j.revoked_at), 'role and jurisdiction history preserved');
ok(jeDetail.audit.some((a) => a.action === 'ROLE_CHANGED') && jeDetail.audit.some((a) => a.action === 'JURISDICTION_CHANGED') && jeDetail.audit.some((a) => a.action === 'PASSWORD_CHANGED'), 'ROLE_CHANGED / JURISDICTION_CHANGED / PASSWORD_CHANGED audited');
const pwAudit = jeDetail.audit.find((a) => a.action === 'PASSWORD_CHANGED');
ok(pwAudit.new_value.source === 'FORCED_RESET' && !JSON.stringify(pwAudit).includes(newPw) && !JSON.stringify(jeDetail.audit).includes(created.json.tempPassword), 'password audit has source only — no password values');
ok((await adm.req(`/api/admin/users/${jeId}/permissions`, { body: { permission: 'settings.manage', effect: 'GRANT', reason: 'test' } })).status === 403, 'Admin cannot grant a security permission to a user');
ok((await adm.req(`/api/admin/users/${jeId}/permissions`, { body: { permission: 'analytics.view', effect: 'GRANT', reason: 'Needs reports' } })).status === 200, 'Admin grants an individual permission (audited)');
const reset = await adm.req(`/api/admin/users/${jeId}/password`, { body: { reason: 'Forgot password' } });
ok(reset.status === 200 && reset.json.tempPassword, 'Admin resets password → one-time temporary password');
ok((await jeC.req('/api/office/users')).status === 401, 'reset revokes the user\'s existing sessions');
ok((await adm.req(`/api/admin/users/${jeId}`, { method: 'PATCH', body: { status: 'INACTIVE' } })).status === 400, 'deactivation without reason refused');
ok((await adm.req(`/api/admin/users/${jeId}`, { method: 'PATCH', body: { status: 'INACTIVE', reason: 'Transferred' } })).status === 200, 'deactivate with reason');
ok((await login('OFFICE', jeUser, reset.json.tempPassword)).r.status === 403, 'deactivated user cannot log in');
ok((await adm.req(`/api/admin/users/${jeId}`, { method: 'PATCH', body: { status: 'ACTIVE' } })).status === 200, 'reactivate');

// ---------------------------------------------------------------- citizens
const cMobile = `8${TS}${'123'}`.slice(0, 10);
const cit = await adm.req('/api/admin/citizens', { body: { fullName: 'Test Citizen', mobile: cMobile, localBodyId: chen.id, wardId: w10.id, address: '5/2 Main Road', pincode: '638051' } });
ok(cit.status === 200 && cit.json.tempPassword, 'Admin adds a citizen (temporary password)');
ok((await eo.req(`/api/office/citizens/${cit.json.id}`)).status === 200, 'EO Chennimalai opens the citizen profile');
ok((await eo2.req(`/api/office/citizens/${cit.json.id}`)).status === 404, 'EO Perundurai cannot open a Chennimalai citizen');
ok((await sup.req(`/api/office/citizens/${cit.json.id}`)).status === 403, 'supervisor without VIEW_CITIZENS is refused');
const cd = (await adm.req(`/api/admin/citizens/${cit.json.id}`)).json;
ok(cd.citizen.address === '5/2 Main Road' && cd.citizen.ward_number === 10, 'citizen profile shows decrypted address and ward to authorised admin');
const { c: citC, r: citLogin } = await login('PUBLIC', cMobile, cit.json.tempPassword);
ok(citLogin.status === 200 && citLogin.json.redirect === '/password', 'citizen created by admin must set own password');
ok((await citC.req('/api/complaints', { form: new FormData() })).status === 403, 'citizen API blocked until password changed');

// ---------------------------------------------------------------- bulk upload
const tplCsv = await adm.req('/api/admin/users/bulk/template?format=csv');
ok(tplCsv.status === 200 && tplCsv.text.includes('Full Name,Username,Mobile'), 'CSV template downloads');
const tplX = await adm.req('/api/admin/users/bulk/template?format=xlsx');
ok(tplX.status === 200 && tplX.type.includes('spreadsheetml') && tplX.buf[0] === 0x50, 'Excel template downloads');
const wb0 = new ExcelJS.Workbook(); await wb0.xlsx.load(tplX.buf);
ok(wb0.getWorksheet('Reference')?.getColumn(1).values.includes(je.code), 'Excel template reference sheet lists the new custom role');
const csv = [
  'Full Name,Username,Mobile,Email,User Type,Role,Designation,Department,District,Taluk,Local Body,Ward,Supervisor,Employee ID,Status',
  `Bulk Electrician ${TS},bulk.elec.${TS},95${TS}11,,Official,FIELD_STAFF,Electrician,ELECTRICAL,Erode,,Chennimalai Town Panchayat,10,sup.electrical,B-${TS}-1,ACTIVE`,
  `Bulk JE ${TS},bulk.je.${TS},95${TS}12,,Official,${je.code},JE,ENGINEERING,Erode,,Chennimalai Town Panchayat,,,B-${TS}-2,ACTIVE`,
  `Bad Ward ${TS},bulk.bad.${TS},95${TS}13,,Official,FIELD_STAFF,Worker,SANITATION,Erode,,Chennimalai Town Panchayat,99,,B-${TS}-3,ACTIVE`,
  `Dup Mobile ${TS},bulk.dup.${TS},95${TS}11,,Official,FIELD_STAFF,Worker,SANITATION,Erode,,Chennimalai Town Panchayat,,,,ACTIVE`,
].join('\n');
const upload = async (mode, content, name = 'users.csv', type = 'text/csv') => { const fd = new FormData(); fd.set('file', new Blob([content], { type }), name); fd.set('mode', mode); return adm.req('/api/admin/users/bulk', { form: fd }); };
let b = await upload('VALIDATE', csv);
ok(b.status === 200 && b.json.valid === 2 && b.json.failed === 2 && b.json.created === 0, `validate: ${b.json?.valid} valid, ${b.json?.failed} failed, nothing created`);
ok(b.json.errors.some((e) => e.row === 4 && e.field === 'Ward') && b.json.errors.some((e) => e.row === 5 && e.field === 'Mobile'), 'row-level errors point at row + column');
b = await upload('ALL_OR_NOTHING', csv);
ok(b.json.committed === false && b.json.created === 0, 'all-or-nothing import refuses the whole file when any row is invalid');
ok((await adm.req(`/api/admin/users?q=bulk.elec.${TS}`)).json.rows.length === 0, 'no partial users were created');
b = await upload('VALID_ONLY', csv);
ok(b.json.committed === true && b.json.created === 2 && b.json.createdUsers.every((u) => u.tempPassword), 'valid-only import creates 2 users and reports the 2 failed rows');
b = await upload('VALID_ONLY', csv);
ok(b.json.created === 0 && b.json.errors.some((e) => /exists|Duplicate/i.test(e.message)), 're-upload detects existing usernames');
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Users');
ws.addRow(['Full Name', 'Username', 'Mobile', 'Email', 'User Type', 'Role', 'Designation', 'Department', 'District', 'Taluk', 'Local Body', 'Ward', 'Supervisor', 'Employee ID', 'Status']);
ws.addRow([`Excel Lineman ${TS}`, `xl.line.${TS}`, `94${TS}21`, '', 'Official', 'FIELD_STAFF', 'EB Lineman', 'ELECTRICAL', 'Erode', '', 'TP-ERD-CHENNIMALAI', 10, '', '', 'ACTIVE']);
ws.addRow([`Excel Citizen ${TS}`, '', `93${TS}22`, '', 'Citizen', 'CITIZEN', '', '', 'Erode', '', 'Chennimalai Town Panchayat', 10, '', '', 'ACTIVE']);
const xbuf = Buffer.from(await wb.xlsx.writeBuffer());
b = await upload('ALL_OR_NOTHING', xbuf, 'users.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
ok(b.json?.committed === true && b.json.created === 2, `Excel import creates an official and a citizen (${b.json?.message ?? JSON.stringify(b.json?.errors ?? [])})`);
ok((await upload('VALIDATE', Buffer.from('PK\u0003\u0004garbage'), 'x.xlsx')).status === 400, 'corrupt Excel file rejected');
ok((await eo.req('/api/admin/users/bulk', { form: new FormData() })).status === 401, 'EO cannot use admin bulk upload');

// ---------------------------------------------------------------- local body + wards
const erode = opts.districts.find((d) => d.name_en === 'Erode');
const lbTypes = await sa.req('/admin/local-bodies/new');
ok(lbTypes.status === 200, 'Add Local Body page renders');
const tpType = (await sa.req('/api/admin/master/local_body_types')).json.rows.find((x) => x.code === 'TOWN_PANCHAYAT');
const nlb = await sa.req('/api/admin/local-bodies', { body: { districtId: erode.id, nameEn: `Test Town ${TS}`, nameTa: 'சோதனை', typeId: tpType.id, pincode: '638051', controllingAuthority: 'Executive Officer', wardCount: 5, departments: ['ELECTRICAL', 'SANITATION'] } });
ok(nlb.status === 200 && nlb.json.id, `local body created (${nlb.json?.code ?? nlb.json?.message})`);
let lw = (await sa.req(`/api/locations?type=wards&parent=${nlb.json.id}`)).json.items;
ok(lw.length === 5, 'wards 1–5 generated');
ok((await sa.req('/api/wards?portal=ADMIN', { body: { localBodyId: nlb.json.id, count: 2 } })).status === 200, 'add 2 more wards');
lw = (await sa.req(`/api/locations?type=wards&parent=${nlb.json.id}`)).json.items;
ok(lw.length === 7 && lw[6].ward_number === 7, 'wards now 1–7');
ok((await sa.req(`/api/wards/${lw[0].id}?portal=ADMIN`, { method: 'PATCH', body: { nameEn: 'Anna Nagar', population: 3200, description: 'North side', streetCount: 12 } })).status === 200, 'ward details saved');
ok((await sa.req(`/api/wards/${lw[0].id}/streets?portal=ADMIN`, { body: { nameEn: 'Test 1st Street' } })).status === 200, 'street added to ward');
ok((await eo.req(`/api/wards/${lw[0].id}?portal=OFFICE`, { method: 'PATCH', body: { population: 1 } })).status === 403, 'EO cannot edit a ward of another local body');
ok((await eo.req(`/api/wards/${w10.id}?portal=OFFICE`, { method: 'PATCH', body: { population: 2100 } })).status === 200, 'EO edits a ward of own local body');
ok((await sa.req(`/admin/local-bodies/${nlb.json.id}`)).status === 200, 'local body detail page renders');

// ---------------------------------------------------------------- ward maps
const poly = { type: 'Polygon', coordinates: [[[77.600, 11.160], [77.606, 11.160], [77.606, 11.166], [77.600, 11.166]]] };
const f1 = await eo.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'BOUNDARY', geometryType: 'Polygon', geometry: poly, name: `Ward 10 boundary ${TS}` } });
ok(f1.status === 200, 'EO draws ward 10 boundary');
ok((await eo.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'STREETLIGHT', geometryType: 'Circle', geometry: { type: 'Point', coordinates: [77.603, 11.163] }, radiusM: 25, name: 'Pole 14' } })).status === 200, 'EO marks a streetlight area (circle)');
ok((await eo.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'DRAINAGE', geometryType: 'LineString', geometry: { type: 'LineString', coordinates: [[77.601, 11.161], [77.604, 11.164]] } } })).status === 200, 'EO draws a drain (line)');
ok((await eo.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'BOUNDARY', geometryType: 'Polygon', geometry: { type: 'Polygon', coordinates: [[[500, 11]]] } } })).status === 400, 'invalid geometry rejected');
ok((await eo2.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'BOUNDARY', geometryType: 'Polygon', geometry: poly } })).status === 403, 'EO Perundurai cannot draw on a Chennimalai ward');
ok((await eo2.req(`/api/ward-maps?ward=${w10.id}&portal=OFFICE`)).status === 403, 'EO Perundurai cannot read Chennimalai ward map');
ok((await sup.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'OTHER', geometryType: 'Point', geometry: { type: 'Point', coordinates: [77.6, 11.16] } } })).status === 403, 'supervisor (view-only) cannot edit ward map');
const wm = (await sup.req(`/api/ward-maps?ward=${w10.id}&portal=OFFICE`)).json;
ok(wm.features.length >= 3 && wm.features.some((f) => f.geometry_type === 'Circle'), `supervisor views ward map (${wm.features.length} features)`);
ok((await eo.req(`/api/ward-maps/${f1.json.id}?portal=OFFICE`, { method: 'PATCH', body: { status: 'INACTIVE', reason: 'Redraw' } })).status === 200, 'feature archived (not deleted)');
ok((await eo.req(`/office/ward-maps/${w10.id}`)).status === 200, 'ward map page renders');

// ---------------------------------------------------------------- complaint actions & multi-person assignment
const citizen = new Client();
const mob = `7${TS}999`.slice(0, 10).replace(/^7/, '9');
const lbInfo = (await citizen.req('/api/locations/pincode/638051')).json;
const chenPub = lbInfo.localBodies.find((l) => l.name_en === 'Chennimalai');
const regR = await citizen.req('/api/auth/register', { body: { fullName: 'Action Tester', dob: '1985-02-02', mobile: mob, pincode: '638051', districtId: chenPub.district_id, localBodyId: chenPub.id, wardId: w10.id, address: '1', password: 'Test1234x', consent: true } });
ok(regR.status === 200, `citizen registered for action test (${regR.json?.message ?? ''})`);
const fd = new FormData();
fd.set('payload', JSON.stringify({ text: 'Street light not working near bus stand ward 10', inputMode: 'TEXT', categoryCode: 'STREET_LIGHT', localBodyId: chenPub.id, wardId: w10.id, streetId: null, streetText: 'Bus stand road', landmark: null, ...GPS, gpsAt: new Date().toISOString(), duplicateOverride: true }));
fd.set('evidenceMeta', JSON.stringify([{ ...GPS, capturedAt: new Date().toISOString(), source: 'CAMERA' }]));
fd.append('evidence', photo('before'), 'before.jpg');
const comp = await citizen.req('/api/complaints', { form: fd });
ok(comp.status === 200, `complaint for action test ${comp.json?.code ?? comp.text.slice(0, 300)}`);
const code = comp.json.code;
const ids = Object.fromEntries((await eo.req('/api/office/users?q=field.')).json.rows.map((u) => [u.username, u.id]));
const act = (c, data, file, portal = 'OFFICE') => {
  if (!file) return c.req(`/api/office/complaints/${code}/action?portal=${portal}`, { body: data });
  const f = new FormData(); f.set('data', JSON.stringify(data)); f.set('photo', photo(file), `${file}.jpg`);
  return c.req(`/api/office/complaints/${code}/action?portal=${portal}`, { form: f });
};
let r0;
ok((await muthu.req(`/api/complaints/${code}/actions?portal=OFFICE`)).status === 404, 'worker not on the team cannot see the complaint');
const a1 = await eo.req(`/api/complaints/${code}/actions?portal=OFFICE`, { body: { title: 'Replace streetlight', priority: 'HIGH', dueAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  assignees: [{ userId: ids['field.ravi'], role: 'PRIMARY' }, { userId: ids['field.muthu'], role: 'SUPPORT' }] } });
ok(a1.status === 200, 'EO adds action with primary + supporting assignee');
ok((await eo2.req(`/api/complaints/${code}/actions?portal=OFFICE`, { body: { title: 'Hijack' } })).status === 404, 'EO of another local body cannot add actions');
ok((await eo.req(`/api/complaints/${code}/actions?portal=OFFICE`, { body: { title: 'Bad team', assignees: [{ userId: ids['field.ravi'], role: 'PRIMARY' }, { userId: ids['field.muthu'], role: 'PRIMARY' }] } })).status === 400, 'only one primary per action');
ok((await muthu.req(`/api/complaints/${code}/actions?portal=OFFICE`)).status === 200, 'supporting worker can now see the complaint');
r0 = await muthu.req(`/api/complaints/${code}/actions/${a1.json.id}?portal=OFFICE`, { method: 'PATCH', body: { status: 'IN_PROGRESS', note: 'On site' } });
ok(r0.status === 200, `supporting worker starts the action (${r0.json?.message ?? ''})`);
ok((await ravi.req(`/api/complaints/${code}/actions/${a1.json.id}?portal=OFFICE`, { method: 'PATCH', body: { title: 'Renamed' } })).status === 403, 'worker cannot edit action definition');
const done = new FormData(); done.set('data', JSON.stringify({ status: 'COMPLETED', note: 'New LED fitted', ...GPS })); done.set('photo', photo('after'), 'after.jpg');
r0 = await ravi.req(`/api/complaints/${code}/actions/${a1.json.id}?portal=OFFICE`, { method: 'PATCH', form: done });
ok(r0.status === 200, `primary worker completes with photo evidence (${r0.json?.message ?? ''})`);
ok((await ravi.req(`/api/complaints/${code}/actions/${a1.json.id}?portal=OFFICE`, { method: 'PATCH', body: { status: 'VERIFIED' } })).status === 403, 'worker cannot verify own action');
r0 = await sup.req(`/api/complaints/${code}/actions/${a1.json.id}?portal=OFFICE`, { method: 'PATCH', body: { status: 'VERIFIED', note: 'Checked' } });
ok(r0.status === 200, `supervisor verifies the action (${r0.json?.message ?? ''})`);
const acts = (await eo.req(`/api/complaints/${code}/actions?portal=OFFICE`)).json.actions;
ok(acts[0].status === 'VERIFIED' && acts[0].assignees.length === 2 && acts[0].updates.length >= 4 && acts[0].updates.some((u) => u.evidence_id), 'action history, team and evidence recorded');
const a2 = await adm.req(`/api/complaints/${code}/actions?portal=ADMIN`, { body: { title: 'Check wiring', assignees: [{ userId: ids['field.ravi'], role: 'PRIMARY' }] } });
ok(a2.status === 200, 'Admin adds an action from the admin portal');
ok((await adm.req(`/api/complaints/${code}/actions/${a2.json.id}?portal=ADMIN`, { method: 'PATCH', body: { status: 'CANCELLED' } })).status === 400, 'cancel without reason refused');
ok((await adm.req(`/api/complaints/${code}/actions/${a2.json.id}?portal=ADMIN`, { method: 'PATCH', body: { status: 'CANCELLED', reason: 'Duplicate task' } })).status === 200, 'Admin cancels action with reason');
// Workflow: review → inspection → verified → assign primary + supporting
let r = await act(sup, { action: 'review', note: 'ok' }); ok(r.status === 200, 'review');
r = await act(sup, { action: 'schedule_inspection', inspectorId: ids['field.ravi'] }); ok(r.status === 200, 'inspection scheduled');
r = await act(ravi, { action: 'inspect', outcome: 'VERIFIED', notes: 'Pole light fused', ...GPS }, 'insp'); ok(r.status === 200, 'inspection recorded');
r = await act(eo, { action: 'assign', assigneeId: ids['field.ravi'], supportIds: [ids['field.muthu']], priority: 'HIGH', note: 'Team job' }); ok(r.status === 200, `EO assigns primary + supporting worker (${r.json?.message ?? ''})`);
r = await act(muthu, { action: 'accept' }); ok(r.status === 200, 'supporting worker accepts');
r = await act(eo, { action: 'reassign', assigneeId: ids['field.ravi'] }); ok(r.status === 400, 'reassign without reason refused');
r = await act(adm, { action: 'remove_support', userId: ids['field.muthu'], note: 'Not needed' }, null, 'ADMIN'); ok(r.status === 200, 'Admin removes supporting worker (audited)');
const audits = await adm.req(`/api/admin/audit/export?ref=${code}`);
const missing = ['COMPLAINT_CREATED', 'ACTION_CREATED', 'ACTION_UPDATED', 'EVIDENCE_UPLOADED', 'INSPECTION_COMPLETED', 'COMPLAINT_ASSIGNED', 'COMPLAINT_VERIFIED', 'COMPLAINT_REASSIGNED'].filter((a) => !audits.text.includes(a));
ok(!missing.length, `meaningful complaint audit events recorded ${missing.join(',')}`);
ok((await adm.req(`/admin/complaints/${code}`)).status === 200 && (await eo.req(`/office/complaints/${code}`)).status === 200, 'complaint pages render in both portals');

// ---------------------------------------------------------------- audit & security log separation
const all = await sa.req('/api/admin/audit/export');
ok(!/,auth\.login,|LOGIN_SUCCESS/.test(all.text), 'main audit log has no login / logout noise');
ok(!all.text.includes(creds.superadmin) && !all.text.includes(newPw) && !all.text.includes('$2b$'), 'audit export contains no passwords or hashes');
const sec = await sa.req('/admin/audit?tab=security');
ok(sec.status === 200 && sec.text.includes('LOGIN_SUCCESS'), 'Super Admin sees login events in the separate security log');
ok((await adm.req('/admin/audit?tab=security')).text.includes('LOGIN_SUCCESS') === false, 'Admin (no MANAGE_AUDIT_LOGS) does not see the security log');

// ---------------------------------------------------------------- pages render
for (const [c, p] of [[sa, '/admin'], [sa, '/admin/users'], [sa, `/admin/users/${jeId}`], [adm, '/admin/citizens'], [adm, `/admin/citizens/${cit.json.id}`], [adm, '/admin/roles'], [sa, '/admin/roles?tab=matrix'],
  [adm, '/admin/users/bulk'], [adm, '/admin/local-bodies'], [adm, '/admin/ward-maps'], [adm, `/admin/ward-maps/${w10.id}`], [sa, '/admin/audit'], [eo, '/office'], [eo, '/office/users'], [eo, '/office/citizens'], [eo, '/office/wards'], [eo, '/office/ward-maps'], [ravi, '/office']]) {
  const res = await c.req(p);
  ok(res.status === 200, `page ${p} → ${res.status}`);
}
ok((await eo.req('/admin')).status === 307, 'EO visiting /admin is sent to admin login');
ok((await ravi.req('/office/users')).status === 307, 'field staff cannot open user management');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
