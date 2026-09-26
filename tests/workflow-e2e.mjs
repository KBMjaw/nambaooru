// End-to-end suite for the complaint workflow (classification → routing → assignment → field work → evidence →
// verification → closure → citizen tracking → notifications → audit), across every role.
// Creates controlled test records tagged WF-<ts>: two citizens and their complaints. Every test complaint ends in a
// terminal state (Closed / Not accepted / Duplicate) and the test citizens are deactivated at the end.
//
//   node tests/workflow-e2e.mjs <baseUrl> <credentials.json> [--local-db]
//
// credentials.json maps usernames to passwords for superadmin, eo.chennimalai, sup.electrical, officer.sanitation,
// field.ravi, field.muthu, ward10.member, eo.perundurai (never commit it). --local-db also runs the automatic SLA
// escalation check, which needs to move a deadline into the past (local database only, never production).
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
const LOCAL_DB = process.argv.includes('--local-db');
const TS = String(Date.now()).slice(-6);
const TAG = `WF-${TS}`;
const results = [];
const ok = (area, test, pass, actual = '') => { results.push({ area, test, pass: !!pass, actual: String(actual) }); console.log(`${pass ? '✔' : '✘'} [${area}] ${test} — ${actual}`); };

const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCtRRRXzh9ef//Z', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGPUqDjBQApgIkn1qIYRpAEAVXkBgP+C6V0AAAAASUVORK5CYII=', 'base64');
const GPS = { latitude: 11.1650, longitude: 77.6040, accuracy: 12 };

class Client {
  cookies = {};
  async req(path, { method, body, form } = {}) {
    const headers = { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method: method ?? (body || form ? 'POST' : 'GET'), headers, body: form ?? (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';'); const [k, ...v] = kv.split('=');
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c)) delete this.cookies[k]; else this.cookies[k] = v.join('=');
    }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text, location: res.headers.get('location') };
  }
}
const login = async (portal, username) => {
  const c = new Client(); c.cookies.nu_lang = 'en';
  const r = await c.req('/api/auth/login', { body: { portal, identifier: username, password: creds[username] } });
  if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${r.text.slice(0, 100)}`);
  c.cookies.nu_lang = 'en'; // login applies the user's saved language; the checks below read English labels
  return c;
};
const findDeep = (o, pred) => { if (!o || typeof o !== 'object') return null; if (pred(o)) return o; for (const v of Object.values(o)) { const f = findDeep(v, pred); if (f) return f; } return null; };

// ------------------------------------------------------------------------------------------------ setup
const pub = new Client();
const pin = (await pub.req('/api/locations/pincode/638051')).json;
const lb = pin.localBodies.find((l) => l.name_en === 'Chennimalai');
const wards = (await pub.req(`/api/locations?type=wards&parent=${lb.id}`)).json.items;
const w10 = wards.find((w) => w.ward_number === 10) ?? wards[0];

const sa = await login('ADMIN', 'superadmin');
const eo = await login('OFFICE', 'eo.chennimalai');
const sup = await login('OFFICE', 'sup.electrical');
const ravi = await login('OFFICE', 'field.ravi');
const muthu = await login('OFFICE', 'field.muthu');
const ward = await login('OFFICE', 'ward10.member');
const eoP = await login('OFFICE', 'eo.perundurai');
const sanit = await login('OFFICE', 'officer.sanitation');

const uid = async (username) => {
  const r = await sa.req(`/api/admin/users?portal=ADMIN&q=${encodeURIComponent(username)}`);
  return findDeep(r.json, (o) => o.username === username)?.id;
};
const RAVI = await uid('field.ravi'); const MUTHU = await uid('field.muthu'); const SUP = await uid('sup.electrical');
ok('setup', 'staff user ids resolved', RAVI && MUTHU && SUP, `${!!RAVI} ${!!MUTHU} ${!!SUP}`);
const issueTypes = (await sa.req('/api/admin/master/complaint_issue_types?portal=ADMIN&q=SL_')).json;
const poleType = findDeep(issueTypes, (o) => o.code === 'SL_POLE_DAMAGED');
ok('setup', 'admin-managed issue types exist (Street light › Pole damaged)', poleType?.id, poleType?.id);

async function citizen(label, suffix) {
  const c = new Client(); c.cookies.nu_lang = 'en';
  const mobile = `7${suffix}${TS}`.slice(0, 10).padEnd(10, '5');
  const r = await c.req('/api/auth/register', { body: { fullName: `${TAG} Citizen ${label}`, dob: '1990-05-01', mobile, pincode: '638051', districtId: lb.district_id, localBodyId: lb.id, wardId: w10.id, address: `${label} Test Street`, password: `Wf${TS}${suffix}pass`, consent: true } });
  if (r.status !== 200) throw new Error(`register ${label}: ${r.status} ${r.text.slice(0, 120)}`);
  c.cookies.nu_lang = 'en';
  return c;
}
const A = await citizen('A', '1');
const B = await citizen('B', '2');
async function file(c, text) {
  const fd = new FormData();
  fd.set('payload', JSON.stringify({ text: `${text} (${TAG})`, inputMode: 'TEXT', categoryCode: 'STREET_LIGHT', localBodyId: lb.id, wardId: w10.id, streetId: null, streetText: `${TAG} road`, landmark: 'near temple', ...GPS, gpsAt: new Date().toISOString(), duplicateOverride: true }));
  fd.set('evidenceMeta', JSON.stringify([{ ...GPS, capturedAt: new Date().toISOString(), source: 'CAMERA' }]));
  fd.append('evidence', new Blob([JPG], { type: 'image/jpeg' }), 'c.jpg');
  const r = await c.req('/api/complaints', { form: fd });
  if (!r.json?.code) throw new Error(`file: ${r.status} ${r.text.slice(0, 150)}`);
  return r.json.code;
}
const act = (c, code, data, photos = 0) => {
  if (!photos) return c.req(`/api/office/complaints/${code}/action?portal=${c === sa ? 'ADMIN' : 'OFFICE'}`, { body: data });
  const fd = new FormData(); fd.set('data', JSON.stringify(data));
  for (let i = 0; i < photos; i++) fd.append('photo', new Blob([i % 2 ? PNG : JPG], { type: i % 2 ? 'image/png' : 'image/jpeg' }), `p${i}.${i % 2 ? 'png' : 'jpg'}`);
  return c.req(`/api/office/complaints/${code}/action?portal=OFFICE`, { form: fd });
};
const statusOf = async (code) => { const r = await eo.req(`/office/complaints/${code}`); return (r.text.match(/data-status="([A-Z_]+)"/) ?? r.text.match(/"status":"([A-Z_]+)"/) ?? [])[1]; };
const unread = async (c, portal) => (await c.req(`/api/notifications?portal=${portal}&count=1`)).json?.unread ?? -1;
const notifs = async (c, portal) => (await c.req(`/api/notifications?portal=${portal}`)).json?.items ?? [];
const hasNotif = async (c, portal, code, title) => (await notifs(c, portal)).some((n) => n.code === code && n.title_en === title);
const page = (c, path) => c.req(path).then((r) => r.text);
const expect = (area, test, r, status) => ok(area, test, (Array.isArray(status) ? status : [status]).includes(r.status), `${r.status}${r.json?.message ? ` ${r.json.message}` : ''}`);

async function toVerified(code) {
  expect('flow', `${code}: EO acknowledges (review)`, await act(eo, code, { action: 'review', note: 'Acknowledged' }), 200);
  expect('flow', `${code}: EO schedules site inspection → field.ravi`, await act(eo, code, { action: 'schedule_inspection', inspectorId: RAVI }), 200);
  expect('flow', `${code}: field.ravi records inspection (photo + GPS) → VERIFIED`, await act(ravi, code, { action: 'inspect', outcome: 'VERIFIED', notes: 'Light is off, confirmed', ...GPS }, 1), 200);
}

// ============================================================================ 1. Street light: full lifecycle
const S = await file(A, 'The street light near the temple is not working for 3 days');
ok('create', 'citizen files a street-light complaint → unique complaint number', /^[A-Z]+-\d{4}-\d{6}$/.test(S), S);
const eoS0 = await page(eo, `/office/complaints/${S}`);
ok('routing', 'system suggested + assigned the Electrical department (shown to officer)', /Suggested department/.test(eoS0) && /Electrical/.test(eoS0), 'checked');
ok('classify', 'issue type auto-detected from the citizen\'s words (Street light not working)', eoS0.includes('Street light not working'), 'checked');
ok('ui', 'officer detail page shows the TAKE ACTION button and next step', eoS0.includes('TAKE ACTION') && eoS0.includes('Next step'), 'checked');
ok('notify', 'citizen notified: Complaint registered', await hasNotif(A, 'PUBLIC', S, 'Complaint registered'), 'checked');
ok('notify', 'EO notified: New complaint received', await hasNotif(eo, 'OFFICE', S, 'New complaint received'), 'checked');

// RBAC before anything happens
expect('rbac', 'field staff cannot act on a complaint not assigned to them (review)', await act(ravi, S, { action: 'review' }), [403, 404]);
expect('rbac', 'ward member cannot classify / route', await act(ward, S, { action: 'classify', issueTypeId: poleType?.id }), 403);
expect('rbac', 'EO of another local body cannot see or act (jurisdiction)', await act(eoP, S, { action: 'review' }), 404);
expect('rbac', 'citizen cannot call the officer action API', await act(A, S, { action: 'review' }), [401, 403]);
expect('rbac', 'department officer of another department (Sanitation) cannot act', await act(sanit, S, { action: 'review' }), [403, 404]);

expect('classify', 'EO reclassifies the issue type (Pole damaged) — officer has final authority', await act(eo, S, { action: 'classify', issueTypeId: poleType?.id, note: 'Pole is leaning' }), 200);
ok('classify', 'new issue type shown with who changed it', (await page(eo, `/office/complaints/${S}`)).includes('Electric pole damaged'), 'checked');
expect('classify', 'classify with no change is rejected', await act(eo, S, { action: 'classify', issueTypeId: poleType?.id }), 400);
await toVerified(S);
ok('notify', 'citizen notified: Complaint under review', await hasNotif(A, 'PUBLIC', S, 'Complaint under review'), 'checked');
ok('notify', 'citizen notified: Issue verified', await hasNotif(A, 'PUBLIC', S, 'Issue verified'), 'checked');

expect('assign', 'ward member cannot assign', await act(ward, S, { action: 'assign', assigneeId: RAVI }), 403);
expect('assign', 'EO assigns primary (Ravi), supporting (Muthu) and supervisor (Electrical supervisor)', await act(eo, S, { action: 'assign', assigneeId: RAVI, supportIds: [MUTHU], supervisorId: SUP, priority: 'HIGH', note: 'Replace the lamp' }), 200);
const eoS1 = await page(eo, `/office/complaints/${S}`);
ok('assign', 'team shows primary, supporting and supervisor', ['Primary', 'Supporting', 'Supervisor'].every((x) => eoS1.includes(x)), 'checked');
ok('notify', 'field staff notified: New work assigned', await hasNotif(ravi, 'OFFICE', S, 'New work assigned'), 'checked');
ok('notify', 'supporting staff notified: New work assigned', await hasNotif(muthu, 'OFFICE', S, 'New work assigned'), 'checked');
ok('notify', 'supervisor notified: You are supervising a complaint', await hasNotif(sup, 'OFFICE', S, 'You are supervising a complaint'), 'checked');
ok('notify', 'citizen notified: Work assigned', await hasNotif(A, 'PUBLIC', S, 'Work assigned'), 'checked');
ok('dash', 'complaint appears in field staff "My action required"', (await page(ravi, '/office')).includes(S), 'checked');

expect('work', 'field staff accepts', await act(ravi, S, { action: 'accept' }), 200);
expect('work', 'field staff starts work with a before-work photo + GPS', await act(ravi, S, { action: 'start', ...GPS }, 1), 200);
ok('notify', 'citizen notified: Work started', await hasNotif(A, 'PUBLIC', S, 'Work started'), 'checked');
expect('hold', 'hold without a reason is rejected', await act(ravi, S, { action: 'hold' }), 400);
expect('hold', 'hold with reason OTHER needs a note', await act(ravi, S, { action: 'hold', reason: 'OTHER' }), 400);
expect('hold', 'field staff puts work on hold (material unavailable)', await act(ravi, S, { action: 'hold', reason: 'MATERIAL_UNAVAILABLE', note: 'Waiting for LED lamp' }), 200);
ok('notify', 'citizen notified: Work on hold (with reason)', (await notifs(A, 'PUBLIC')).some((n) => n.code === S && n.title_en === 'Work on hold' && n.body_en.includes('Material unavailable')), 'checked');
ok('hold', 'citizen page shows the on-hold reason', (await page(A, `/complaints/${S}`)).includes('Material unavailable'), 'checked');
expect('hold', 'complete is blocked while on hold', await act(ravi, S, { action: 'complete', notes: 'x done', ...GPS }, 1), 409);
expect('hold', 'field staff resumes work', await act(ravi, S, { action: 'resume', note: 'Lamp arrived' }), 200);
ok('notify', 'citizen notified: Work resumed', await hasNotif(A, 'PUBLIC', S, 'Work resumed'), 'checked');
expect('work', 'progress update 50% with 2 photos + GPS', await act(ravi, S, { action: 'progress', progress: 50, notes: 'Old lamp removed', ...GPS }, 2), 200);
expect('work', 'supporting staff adds a field note', await act(muthu, S, { action: 'note', notes: 'Ladder arranged' }), 200);
expect('work', 'completion without photo is rejected', await act(ravi, S, { action: 'complete', notes: 'Done', ...GPS }), 400);
expect('work', 'completion without GPS is rejected', await act(ravi, S, { action: 'complete', notes: 'Done' }, 1), 400);
expect('work', 'field staff completes with 3 photos + GPS and submits for verification', await act(ravi, S, { action: 'complete', notes: 'New LED lamp fitted and tested', ...GPS }, 3), 200);
ok('notify', 'citizen notified: Work done — verification pending', await hasNotif(A, 'PUBLIC', S, 'Work done — verification pending'), 'checked');
ok('notify', 'supervisor notified: Work completed — verify', await hasNotif(sup, 'OFFICE', S, 'Work completed — verify'), 'checked');
ok('dash', 'complaint listed under Verification pending', (await page(sup, '/office/complaints?bucket=verification')).includes(S), 'checked');

expect('verify', 'field staff cannot verify their own work', await act(ravi, S, { action: 'verify_completion', decision: 'approve' }), 403);
expect('verify', 'ward member cannot verify', await act(ward, S, { action: 'verify_completion', decision: 'approve' }), 403);
expect('verify', 'field verification (method B) without GPS is rejected', await act(sup, S, { action: 'verify_completion', decision: 'send_back', method: 'FIELD', notes: 'Lamp flickers' }), 400);
expect('verify', 'send back without a reason is rejected', await act(sup, S, { action: 'verify_completion', decision: 'send_back' }), 400);
expect('verify', 'supervisor visits the site (method B, GPS + photo) and asks for rework', await act(sup, S, { action: 'verify_completion', decision: 'send_back', method: 'FIELD', notes: 'Lamp flickers at night', ...GPS }, 1), 200);
ok('notify', 'field staff notified: Rework required (with reason)', (await notifs(ravi, 'OFFICE')).some((n) => n.code === S && n.title_en === 'Rework required' && n.body_en.includes('flickers')), 'checked');
ok('dash', 'complaint listed under Rework required', (await page(eo, '/office/complaints?bucket=rework')).includes(S), 'checked');
ok('ui', 'field staff home shows the rework reason', (await page(ravi, '/office')).includes('Lamp flickers at night'), 'checked');
expect('rework', 'field staff restarts (rework) → IN PROGRESS', await act(ravi, S, { action: 'start', note: 'Fixing flicker' }), 200);
expect('rework', 'field staff completes again (photo + GPS)', await act(ravi, S, { action: 'complete', notes: 'Choke replaced, no flicker', ...GPS }, 1), 200);
expect('verify', 'supervisor approves by evidence review (method A) and closes', await act(sup, S, { action: 'verify_completion', decision: 'approve', method: 'EVIDENCE', notes: 'Photos confirm the fix', close: true }), 200);
ok('notify', 'citizen notified: Resolution verified', await hasNotif(A, 'PUBLIC', S, 'Resolution verified'), 'checked');
ok('notify', 'citizen notified: Complaint closed', await hasNotif(A, 'PUBLIC', S, 'Complaint closed'), 'checked');
const eoS2 = await page(eo, `/office/complaints/${S}`);
ok('verify', 'verification history shows method B (sent back) and method A (approved)', eoS2.includes('B · Field verification') && eoS2.includes('A · Evidence review'), 'checked');
ok('verify', 'resolution recorded: Resolved', eoS2.includes('Resolution') && eoS2.includes('Resolved'), 'checked');
const evOffice = new Set(eoS2.match(/\/api\/evidence\/\d+/g) ?? []);
const citS = await page(A, `/complaints/${S}`);
const evCitizen = new Set(citS.match(/\/api\/evidence\/\d+/g) ?? []);
ok('evidence', 'officer sees citizen + before + progress + completion + inspection + verification evidence (≥ 9 files)', evOffice.size >= 9, evOffice.size);
ok('evidence', 'citizen\'s original photo is never overwritten (still served)', [...evCitizen].length > 0 && (await A.req([...evCitizen][0])).status === 200, [...evCitizen][0]);
const internalOnly = [...evOffice].filter((e) => !evCitizen.has(e));
const internalFetch = internalOnly.length ? await A.req(internalOnly[internalOnly.length - 1]) : { status: 'n/a' };
ok('evidence', 'internal field evidence (inspection / verification) is not served to the citizen', internalOnly.length > 0 && internalFetch.status === 403, `${internalOnly.length} internal, ${internalFetch.status}`);
ok('track', 'citizen tracking: responsible department, latest action, last updated, resolution', ['Responsible department', 'Latest action', 'Last updated', 'Resolution', 'Resolved'].every((x) => citS.includes(x)), 'checked');
ok('track', 'citizen timeline includes the Verification step', citS.includes('Verification'), 'checked');
const adminS = await page(sa, `/admin/complaints/${S}`);
ok('audit', 'audit trail records classification, supervisor, hold, rework and verification', ['Classification / department changed', 'Supervisor assigned', 'Work put on hold', 'Verification rejected', 'Verification approved'].every((x) => adminS.includes(x)), 'checked');
ok('audit', 'no password or hash in complaint pages', !/password|\$2[aby]\$|argon2/i.test(adminS + eoS2), 'checked');
ok('dash', 'closed complaint listed under Closed', (await page(eo, '/office/complaints?bucket=closed')).includes(S), 'checked');

// ============================================================================ 2. No issue found
const N = await file(A, 'Street light pole number 7 is not working');
await toVerified(N);
expect('flow', `${N}: EO assigns field.ravi`, await act(eo, N, { action: 'assign', assigneeId: RAVI }), 200);
expect('noissue', 'no-issue report without photo is rejected', await act(ravi, N, { action: 'report_no_issue', notes: 'Light works fine', ...GPS }), 400);
expect('noissue', 'field staff reports "no issue found" (photo + GPS)', await act(ravi, N, { action: 'report_no_issue', notes: 'Light is working normally at night', ...GPS }, 1), 200);
ok('noissue', 'citizen NOT told "work done" for a no-issue report', !(await hasNotif(A, 'PUBLIC', N, 'Work done — verification pending')), 'checked');
ok('notify', 'EO notified: Field report: no issue found', await hasNotif(eo, 'OFFICE', N, 'Field report: no issue found'), 'checked');
expect('noissue', 'EO confirms (evidence review) → finished as No issue found', await act(eo, N, { action: 'verify_completion', decision: 'approve', method: 'EVIDENCE', notes: 'Night photo shows the light on' }), 200);
ok('notify', 'citizen notified: not accepted — reason No issue found (may request reconsideration)', (await notifs(A, 'PUBLIC')).some((n) => n.code === N && n.title_en === 'Complaint not accepted' && n.body_en.includes('No issue found')), 'checked');
ok('dash', 'listed under No issue found', (await page(eo, '/office/complaints?bucket=noissue')).includes(N), 'checked');

// ============================================================================ 3. Invalid, 4. Duplicate, 5. Reopened
const I = await file(B, 'Test complaint that is not a real issue');
expect('invalid', 'reject needs notes', await act(eo, I, { action: 'reject', reason: 'INVALID' }), 400);
expect('invalid', 'EO closes as Invalid with reason', await act(eo, I, { action: 'reject', reason: 'INVALID', notes: 'Not a civic issue' }), 200);
ok('invalid', 'citizen sees resolution Invalid + reason', (await page(B, `/complaints/${I}`)).includes('Not a civic issue'), 'checked');
const D = await file(B, 'Street light near the temple is off');
expect('duplicate', 'duplicate must name an original in jurisdiction', await act(eo, D, { action: 'reject', reason: 'DUPLICATE', notes: 'Same pole', duplicateOf: 'NU-1900-000000' }), 400);
expect('duplicate', 'EO marks duplicate of the street-light complaint', await act(eo, D, { action: 'reject', reason: 'DUPLICATE', notes: 'Same pole as the original', duplicateOf: S }), 200);
ok('duplicate', 'citizen notified: Marked as duplicate', await hasNotif(B, 'PUBLIC', D, 'Marked as duplicate'), 'checked');
expect('reopen', 'ward member cannot reopen', await act(ward, I, { action: 'reopen', note: 'Please reopen' }), 403);
expect('reopen', 'reopen needs a reason', await act(eo, I, { action: 'reopen' }), 400);
expect('reopen', 'EO reopens the invalid complaint with a reason', await act(eo, I, { action: 'reopen', note: 'Citizen gave new details' }), 200);
ok('notify', 'citizen notified: Complaint reopened', await hasNotif(B, 'PUBLIC', I, 'Complaint reopened'), 'checked');
ok('reopen', 'reopened complaint shows in New again', (await page(eo, '/office/complaints?bucket=new')).includes(I), 'checked');

// ============================================================================ 6. Escalation (manual; automatic on --local-db)
expect('escalate', 'escalation needs a note', await act(ward, I, { action: 'escalate' }), 400);
expect('escalate', 'ward member escalates → level 1 (Supervisor)', await act(ward, I, { action: 'escalate', note: 'Residents complaining again' }), 200);
expect('escalate', 'EO escalates straight to level 4 (Higher authority)', await act(eo, I, { action: 'escalate', level: 4, note: 'Needs state attention' }), 200);
ok('notify', 'higher authority (admin) notified: Complaint escalated to you', await hasNotif(sa, 'ADMIN', I, 'Complaint escalated to you'), 'checked');
expect('escalate', 'escalating beyond the top level is refused', await act(eo, I, { action: 'escalate', note: 'again please' }), 409);
ok('dash', 'listed under Escalated', (await page(eo, '/office/complaints?bucket=escalated')).includes(I), 'checked');
expect('invalid', 'EO finishes the reopened complaint again (Invalid)', await act(eo, I, { action: 'reject', reason: 'INVALID', notes: 'Checked again, not a civic issue' }), 200);

if (LOCAL_DB) {
  const { execSync } = await import('node:child_process');
  const E = await file(B, 'Street light flickering all night');
  const db = readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].replace(/"/g, '');
  execSync(`psql "${db}" -Atc "UPDATE complaints SET sla_due_at = now() - interval '26 hours' WHERE code = '${E}'"`);
  const secret = readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/^CRON_SECRET=(.*)$/m)[1].replace(/"/g, '');
  const cron = await fetch(`${BASE}/api/cron/sla`, { headers: { authorization: `Bearer ${secret}` } }).then((r) => r.json());
  ok('escalate', 'SLA sweep auto-escalates an overdue complaint (26h late → level 2)', cron.escalated >= 1, JSON.stringify(cron));
  const eoE = await page(eo, `/office/complaints/${E}`);
  ok('escalate', 'auto-escalation recorded (level 2, Department Officer) and listed as overdue', eoE.includes('Escalation level 2') && (await page(eo, '/office/complaints?bucket=overdue')).includes(E), 'checked');
  ok('audit', 'auto-escalation audited as system action', (await page(sa, `/admin/complaints/${E}`)).includes('Escalated automatically (SLA)'), 'checked');
  expect('invalid', 'overdue test complaint finished (Invalid)', await act(eo, E, { action: 'reject', reason: 'INVALID', notes: 'Automated test record' }), 200);
}

// ============================================================================ 7. Cross-citizen access + notifications read/unread
const cross = await B.req(`/complaints/${N}`);
ok('rbac', 'citizen B cannot open citizen A\'s complaint', cross.status === 404, cross.status);
const merged = await B.req(`/complaints/${S}`);
ok('rbac', 'B (merged as duplicate of S) sees only the public summary of A\'s complaint', merged.status === 200 && !merged.text.includes('/api/evidence/') && !merged.text.includes('temple is not working'), merged.status);
const before = await unread(A, 'PUBLIC');
const all0 = (await notifs(A, 'PUBLIC')).length;
const one = (await notifs(A, 'PUBLIC')).find((n) => !n.read_at);
await A.req('/api/notifications?portal=PUBLIC', { body: { id: one?.id } });
const after1 = await unread(A, 'PUBLIC');
ok('notify', 'reading one notification lowers the unread badge by 1', before > 0 && after1 === before - 1, `${before} → ${after1}`);
const foreign = (await notifs(B, 'PUBLIC')).find((n) => !n.read_at);
await A.req('/api/notifications?portal=PUBLIC', { body: { id: foreign?.id } });
ok('notify', 'a citizen cannot mark another citizen\'s notification read', (await notifs(B, 'PUBLIC')).some((n) => n.id === foreign?.id && !n.read_at), 'checked');
await A.req('/api/notifications?portal=PUBLIC', { body: {} });
ok('notify', 'mark all read → unread badge 0', (await unread(A, 'PUBLIC')) === 0, 'checked');
ok('notify', 'history kept: read notifications are not deleted', (await notifs(A, 'PUBLIC')).length === all0, `${all0}`);
const npage = await page(A, '/notifications');
ok('notify', 'notification centre separates NEW and EARLIER UPDATES', npage.includes('New / Unread') && npage.includes('Earlier updates'), 'checked');
ok('notify', 'admin portal has a notification centre', (await sa.req('/admin/notifications')).status === 200, 'checked');

// ============================================================================ cleanup: deactivate the two test citizens
for (const label of ['A', 'B']) {
  const r = await sa.req(`/api/admin/citizens?portal=ADMIN&q=${encodeURIComponent(`${TAG} Citizen ${label}`)}`);
  const row = findDeep(r.json, (o) => typeof o.full_name === 'string' && o.full_name === `${TAG} Citizen ${label}`);
  const d = row ? await sa.req(`/api/admin/citizens/${row.id}?portal=ADMIN`, { method: 'PATCH', body: { status: 'INACTIVE', reason: `${TAG} automated test cleanup` } }) : { status: 'not found' };
  ok('cleanup', `test citizen ${label} deactivated`, d.status === 200, d.status);
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} passed · tag ${TAG} · complaints ${[S, N, I, D].join(', ')}`);
writeFileSync(`workflow-e2e-${TAG}.json`, JSON.stringify({ base: BASE, tag: TAG, complaints: [S, N, I, D], results }, null, 2));
process.exit(pass === results.length ? 0 : 1);
