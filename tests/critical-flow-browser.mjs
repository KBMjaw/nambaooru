// UI-driven check of the critical complaint flow, clicking through the real pages as each role:
// list → click row → detail → citizen submission → TAKE ACTION → acknowledge → classify → inspection → supervisor →
// supervisor assigns field staff → (phone) open work → Record action: work started → public + internal notes → upload evidence →
// action taken → work completed with after photo → verifier REJECT / REWORK → redo → APPROVE & CLOSE → citizen tracking.
// Also: Not Accepted complaint (reason / who / when, Accept), unauthorized page access, no horizontal scroll on the phone.
// Creates tagged test records (UI-<ts>); the complaints end closed / reopened-and-closed.
//
//   node tests/critical-flow-browser.mjs <baseUrl> <credentials.json> [chromiumPath]
// Existing complaint mode (no new complaint is created for the main flow):
//   EXISTING_CODE=NU-2026-001001 CITIZEN_MOBILE=... CITIZEN_PW=... SNIPPET="words from the complaint"
//   EXISTING_REJECTED=NU-2026-001003 OTHER_CODE=NU-2026-001002 node tests/critical-flow-browser.mjs ...
// Needs playwright-core resolvable from the working directory.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const B = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
const exe = process.argv[4] ?? '/opt/pw-browsers/chromium';
const TS = String(Date.now()).slice(-6); const TAG = `UI-${TS}`;
const res = []; const ok = (area, t, p, a = '') => { res.push({ area, test: t, pass: !!p, actual: String(a) }); console.log(`${p ? '✔' : '✘'} [${area}] ${t} — ${a}`); };
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCtRRRXzh9ef//Z', 'base64');
const GEO = { latitude: 11.165, longitude: 77.604 };
const photo = (n) => ({ name: `p${n}.jpg`, mimeType: 'image/jpeg', buffer: JPG });

const browser = await chromium.launch({ executablePath: exe });
async function session(portal, id, pw, phone = false) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone, geolocation: GEO, permissions: ['geolocation'] });
  if (id) { const r = await ctx.request.post(`${B}/api/auth/login`, { data: { portal, identifier: id, password: pw ?? creds[id] } }); if (r.status() !== 200) throw new Error(`login ${id} ${r.status()}`); }
  await ctx.addCookies([{ name: 'nu_lang', value: 'en', url: B }]); // after login, which applies the saved language
  const page = await ctx.newPage();
  return { ctx, page };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const text = (p) => p.evaluate(() => document.body.innerText);
/** Open TAKE ACTION (if closed), open the action with this label, fill it and confirm. */
async function act(p, label, fill = async () => {}) {
  const ta = p.getByRole('button', { name: /TAKE ACTION/ });
  if (await ta.count() && (await ta.getAttribute('aria-expanded')) !== 'true') await ta.click();
  await p.getByRole('button', { name: new RegExp(label) }).first().click();
  const form = p.locator('div.rounded-xl').filter({ has: p.locator('p.font-bold', { hasText: new RegExp(label) }) }).last();
  await fill(form);
  await form.getByRole('button', { name: /^Confirm$/ }).click();
  await p.waitForTimeout(1800);
  const err = await form.locator('[role=alert], .alert-error, .bg-red-50').first().textContent().catch(() => null);
  await p.reload(); await p.waitForLoadState('networkidle');
  return err;
}
/** "Record an action" in TAKE ACTION: action type + description (+ photos). Returns the error shown, if any. */
async function rec(p, type, description, photos = [], extra = async () => {}) {
  const ta = p.getByRole('button', { name: /TAKE ACTION/ });
  if (await ta.count() && (await ta.getAttribute('aria-expanded')) !== 'true') await ta.click();
  const form = p.getByTestId('record-action');
  await form.locator('select[name=actionType]').selectOption(type);
  await form.locator('textarea[name=description]').fill(description);
  await extra(form);
  if (photos.length) { await form.getByTestId('record-photo').setInputFiles(photos); await p.waitForTimeout(1500); }
  await form.getByRole('button', { name: /Save action/ }).click();
  await p.waitForTimeout(1800);
  const err = await form.locator('.bg-red-50').first().textContent({ timeout: 500 }).catch(() => null);
  await p.reload(); await p.waitForLoadState('networkidle');
  return err;
}
const pick = async (form, optionText) => {
  for (const sel of await form.locator('select').all()) {
    const v = await sel.evaluate((s, t) => [...s.options].find((o) => o.text.includes(t))?.value ?? null, optionText);
    if (v) { await sel.selectOption(v); return true; }
  }
  return false;
};

// ---------------------------------------------------------------- setup: a citizen files a complaint (API, as the citizen app does)
const cit = await session(null);
const pin = await (await cit.ctx.request.get(`${B}/api/locations/pincode/638051`)).json();
const lb = pin.localBodies.find((l) => l.name_en === 'Chennimalai');
const w10 = (await (await cit.ctx.request.get(`${B}/api/locations?type=wards&parent=${lb.id}`)).json()).items.find((w) => w.ward_number === 10);
const mobile = `68${TS}44`.slice(0, 10);
const reg = await cit.ctx.request.post(`${B}/api/auth/register`, { data: { fullName: `${TAG} Citizen`, dob: '1990-01-01', mobile, pincode: '638051', districtId: lb.district_id, localBodyId: lb.id, wardId: w10.id, address: 'Test', password: `Ui${TS}pass!`, consent: true } });
await cit.ctx.addCookies([{ name: 'nu_lang', value: 'en', url: B }]);
const file = async (t) => (await (await cit.ctx.request.post(`${B}/api/complaints`, { multipart: {
  payload: JSON.stringify({ text: `${t} (${TAG})`, inputMode: 'TEXT', categoryCode: 'STREET_LIGHT', localBodyId: lb.id, wardId: w10.id, streetId: null, streetText: `${TAG} road`, landmark: 'near temple', ...GEO, accuracy: 10, gpsAt: new Date().toISOString(), duplicateOverride: true }),
  evidenceMeta: JSON.stringify([{ ...GEO, accuracy: 10, capturedAt: new Date().toISOString(), source: 'CAMERA' }]), evidence: photo(0) } })).json()).code;
const EXISTING = process.env.EXISTING_CODE;
const SNIP = process.env.SNIPPET ?? 'temple gate';
let S;
if (EXISTING) {
  // Existing complaint: its own citizen logs in (password set beforehand); nothing new is filed for the main flow
  const r = await cit.ctx.request.post(`${B}/api/auth/login`, { data: { portal: 'PUBLIC', identifier: process.env.CITIZEN_MOBILE, password: process.env.CITIZEN_PW } });
  await cit.ctx.addCookies([{ name: 'nu_lang', value: 'en', url: B }]);
  S = EXISTING;
  ok('setup', `existing complaint ${S} (its citizen logged in)`, r.status() === 200, r.status());
} else {
  S = await file('Street light near the temple gate is not working at night');
  ok('setup', 'citizen registered and filed a complaint', reg.status() === 200 && S, S);
}

// ---------------------------------------------------------------- EO: list → row click → detail → citizen submission
const eo = await session('OFFICE', 'eo.chennimalai');
await eo.page.goto(`${B}/office/complaints?q=${S}`, { waitUntil: 'networkidle' });
await eo.page.locator('tbody tr').filter({ hasText: S }).locator('td').nth(1).click();
await eo.page.waitForURL(new RegExp(`/office/complaints/${S}`), { timeout: 8000 }).catch(() => {});
ok('list', 'clicking the complaint row opens the detail page', eo.page.url().endsWith(`/office/complaints/${S}`), eo.page.url());
await eo.page.goto(`${B}/office/complaints?q=${S}`, { waitUntil: 'networkidle' });
await eo.page.getByRole('link', { name: S }).first().click();
await eo.page.waitForURL(new RegExp(`/office/complaints/${S}`), { timeout: 8000 }).catch(() => {});
ok('list', 'clicking the complaint number opens the detail page', eo.page.url().endsWith(`/office/complaints/${S}`), eo.page.url());
let t = await text(eo.page);
ok('detail', 'citizen submission: description, category, location, submitted time, citizen photo', t.includes('Citizen submission') && t.includes(SNIP) && t.includes('Ward 10') && ((await eo.page.locator('img[src^="/api/evidence/"]').count()) > 0 || t.includes('No photo was attached')), 'checked');
ok('detail', 'TAKE ACTION and next step shown', /TAKE ACTION/i.test(t) && /Next step/i.test(t), 'checked');
ok('detail', 'direct URL navigation works', (await eo.ctx.request.get(`${B}/office/complaints/${S}`)).status() === 200, 'checked');

let e = await rec(eo.page, 'ACKNOWLEDGE', 'Checked and acknowledged');
ok('acknowledge', 'EO acknowledges → status Acknowledged', !e && (await text(eo.page)).includes('Acknowledged'), e ?? 'ok');
e = await act(eo.page, 'Classify / route department', async (f) => { await pick(f, 'Pole'); await pick(f, 'Electric pole damaged'); });
ok('classify', 'EO classifies Electrical › Pole › Pole damaged', !e && (await text(eo.page)).includes('Electric pole damaged'), e ?? 'ok');
e = await rec(eo.page, 'OTHER', `${TAG} internal: check pole stock before sending staff`);
ok('notes', 'EO adds an INTERNAL action note', !e && (await text(eo.page)).includes('check pole stock'), e ?? 'ok');
e = await act(eo.page, 'Send for site inspection', async (f) => { await pick(f, 'Ravi'); });
ok('inspection', 'EO sends for site inspection (Ravi)', !e, e ?? 'ok');

// ---------------------------------------------------------------- field staff (phone): inspection
const ravi = await session('OFFICE', 'field.ravi', null, true);
await ravi.page.goto(`${B}/office`, { waitUntil: 'networkidle' });
const insp = ravi.page.locator('li', { hasText: S }).first();
await insp.getByRole('button', { name: /Inspect/ }).click();
const inspForm = insp.locator('div.rounded-xl').last();
await pick(inspForm, 'Verified');
await inspForm.locator('textarea').first().fill('Pole leaning, lamp off — confirmed');
await inspForm.locator('input[type=file]').setInputFiles(photo(1));
await ravi.page.waitForTimeout(1500);
await inspForm.getByRole('button', { name: /^Confirm$/ }).click(); await ravi.page.waitForTimeout(1800);
await eo.page.reload();
ok('inspection', 'field staff records the inspection on the phone → Verified', (await text(eo.page)).includes('Verified'), 'checked');

e = await act(eo.page, 'Assign supervisor', async (f) => { await pick(f, 'Senthil'); if (!(await f.locator('select').first().inputValue())) await pick(f, 'Supervisor'); });
ok('assign', 'EO assigns the supervisor', !e && (await text(eo.page)).includes('Supervisor'), e ?? 'ok');

// ---------------------------------------------------------------- supervisor assigns field staff
const sup = await session('OFFICE', 'sup.electrical');
await sup.page.goto(`${B}/office/complaints?bucket=mine`, { waitUntil: 'networkidle' });
await sup.page.locator('tbody tr').filter({ hasText: S }).locator('td').nth(2).click();
await sup.page.waitForURL(new RegExp(S), { timeout: 8000 }).catch(() => {});
ok('assign', 'supervisor finds it under My action required and opens it', sup.page.url().includes(S), sup.page.url());
e = await act(sup.page, 'Assign work', async (f) => { await pick(f, 'Ravi'); });
ok('assign', 'supervisor assigns field staff (Ravi) → Assigned', !e && (await text(sup.page)).includes('Assigned'), e ?? 'ok');

// ---------------------------------------------------------------- field staff on the phone: open → start → notes → evidence → progress → complete
await ravi.page.goto(`${B}/office`, { waitUntil: 'networkidle' });
ok('mobile', 'field queue: no horizontal scroll', (await overflow(ravi.page)) <= 1, await overflow(ravi.page));
await ravi.page.locator('li', { hasText: S }).first().getByRole('link', { name: /Open complaint/ }).click();
await ravi.page.waitForURL(new RegExp(S)); await ravi.page.waitForLoadState('networkidle');
t = await text(ravi.page);
ok('mobile', 'field staff opens the complaint and sees the citizen submission', t.includes('Citizen submission') && t.includes(SNIP), 'checked');
ok('mobile', 'detail page: no horizontal scroll on the phone', (await overflow(ravi.page)) <= 1, await overflow(ravi.page));
e = await rec(ravi.page, 'WORK_STARTED', 'Started work: faulty fitting being removed', [photo(2)]);
ok('work', 'START WORK (with before photo) → Work in Progress', !e && (await text(ravi.page)).includes('Work in Progress'), e ?? 'ok');
e = await rec(ravi.page, 'OTHER', `${TAG} public: old fitting removed, new LED fitting being installed`, [], async (f) => { await f.getByText('Public progress update').click(); });
ok('notes', 'field staff adds a PUBLIC progress update', !e, e ?? 'ok');
e = await act(ravi.page, 'Upload evidence', async (f) => { await f.locator('input[type=file]').setInputFiles([photo(3), photo(4)]); await ravi.page.waitForTimeout(1500); });
ok('evidence', 'field staff uploads 2 work photos', !e, e ?? 'ok');
e = await rec(ravi.page, 'ACTION_TAKEN', 'Inspected the damaged light; removed the faulty fitting and installed a replacement', [photo(5)]);
ok('work', 'Action taken with reference photo', !e, e ?? 'ok');
// Completion without the reference photo must be refused
e = await rec(ravi.page, 'WORK_COMPLETED', 'Street light fitting replaced and tested successfully');
ok('complete', 'completion without the after-work photo is refused', /photo/i.test(e ?? '') && (await text(ravi.page)).includes('Work in Progress'), e);
e = await rec(ravi.page, 'WORK_COMPLETED', 'Street light fitting replaced and tested successfully', [photo(6)]);
ok('complete', 'WORK COMPLETED with description + after photo → Verification Pending (not closed)', !e && (await text(ravi.page)).includes('Verification Pending'), e ?? 'ok');

// ---------------------------------------------------------------- verifier: rework, then approve
await sup.page.reload(); await sup.page.waitForLoadState('networkidle');
t = await text(sup.page);
ok('verify', 'verifier sees citizen evidence + before/progress/completion photos + notes', t.includes('Before work') && t.includes('After (work completed)') && t.includes('Street light fitting replaced') && (await sup.page.locator('img[src^="/api/evidence/"]').count()) >= 6, 'checked');
e = await act(sup.page, 'REJECT / REWORK', async (f) => { await f.locator('textarea').first().fill('Lamp cover missing — please fix'); await f.locator('textarea').nth(1).fill('The lamp cover still has to be fitted.'); });
ok('rework', 'verifier rejects with a reason → Rework Required', !e && (await text(sup.page)).includes('Rework Required'), e ?? 'ok');
await ravi.page.goto(`${B}/office/notifications`, { waitUntil: 'networkidle' });
ok('rework', 'field staff notified: Rework required', (await text(ravi.page)).includes('Rework required'), 'checked');
await ravi.page.goto(`${B}/office/complaints/${S}`, { waitUntil: 'networkidle' });
e = await rec(ravi.page, 'WORK_STARTED', 'Rework started: fitting the lamp cover');
ok('rework', 'field staff restarts → Work in Progress', !e && (await text(ravi.page)).includes('Work in Progress'), e ?? 'ok');
e = await rec(ravi.page, 'WORK_COMPLETED', 'Lamp cover fitted, tested at dusk', [photo(7)]);
ok('rework', 'new completion evidence → Verification Pending', !e && (await text(ravi.page)).includes('Verification Pending'), e ?? 'ok');
await sup.page.reload();
e = await act(sup.page, 'APPROVE & CLOSE', async (f) => { await f.locator('textarea').first().fill('Street light repaired; photos confirm the fix. Closing.'); });
ok('verify', 'verifier APPROVE & CLOSE (closure note) → Closed', !e && (await text(sup.page)).includes('Closed'), e ?? 'ok');
await eo.page.reload();
t = await text(eo.page);
ok('timeline', 'officer timeline lists every step with actor and visibility', ['Acknowledged', 'Verification Pending', 'Rework Required', 'Closed', 'Internal', 'Public', 'Before work', 'After (work completed)'].every((x) => t.includes(x)), 'checked');

// ---------------------------------------------------------------- citizen tracking
await cit.page.goto(`${B}/complaints/${S}`, { waitUntil: 'networkidle' });
t = await text(cit.page);
ok('citizen', 'citizen sees Closed with the full timeline and resolution', t.includes('Resolved / closed') && t.includes('Resolved') && t.includes('Work completed'), 'checked');
ok('citizen', 'citizen sees the PUBLIC progress update and the public work performed', t.includes('new LED fitting being installed') && t.includes('installed a replacement'), 'checked');
ok('citizen', 'citizen timeline: Submitted → Acknowledged → Department → Staff assigned → Action taken → Completed → Evidence → Under verification → Approved → Closed',
  ['Complaint submitted', 'Acknowledged', 'Assigned to department', 'Staff assigned', 'Action taken', 'Work completed', 'Evidence submitted', 'Under verification', 'Approved after verification', 'Resolved / closed'].every((x) => t.includes(x)), 'checked');
ok('citizen', 'citizen told about the rework with the public reason', t.includes('Rework requested 1 time') && t.includes('lamp cover still has to be fitted'), 'checked');
const cn = await (await cit.ctx.request.get(`${B}/api/notifications?portal=PUBLIC`)).json();
const titles = cn.items.filter((n) => n.code === S).map((n) => n.title_en);
ok('notify', 'citizen notified at every stage (received / started / progress / rework / verification / approved / closed)',
  ['Complaint received and under review', 'Work assigned', 'Work started', 'Progress updated', 'Rework required on your complaint', 'Work done — verification pending', 'Resolution verified', 'Complaint closed'].every((x) => titles.includes(x)), titles.join(' | '));
const nb = await (await cit.ctx.request.get(`${B}/api/notifications?portal=PUBLIC&count=1`)).json();
await cit.ctx.request.post(`${B}/api/notifications?portal=PUBLIC`, { data: { id: cn.items.find((n) => n.code === S && !n.read_at)?.id } });
const na = await (await cit.ctx.request.get(`${B}/api/notifications?portal=PUBLIC&count=1`)).json();
ok('notify', 'opening a notification lowers the unread count by 1', na.unread === nb.unread - 1, `${nb.unread} → ${na.unread}`);
ok('citizen', 'citizen does NOT see internal notes or verification notes', !t.includes('check pole stock') && !t.includes('Lamp cover missing'), 'checked');
ok('citizen', 'citizen sees completion photos (not inspection / verification ones)', (await cit.page.locator('img[src^="/api/evidence/"]').count()) >= 2, await cit.page.locator('img[src^="/api/evidence/"]').count());
ok('mobile', 'citizen tracking page: no horizontal scroll', (await overflow(cit.page)) <= 1, await overflow(cit.page));

// ---------------------------------------------------------------- Not Accepted is not a dead end
const R = process.env.EXISTING_REJECTED ?? await file('Street light test that will not be accepted');
const rj = process.env.EXISTING_REJECTED ? { status: () => 200 } : await eo.ctx.request.post(`${B}/api/office/complaints/${R}/action?portal=OFFICE`, { data: { action: 'reject', reason: 'INSUFFICIENT_EVIDENCE', notes: 'Photo does not show a street light' } });
await eo.page.goto(`${B}/office/complaints/${R}`, { waitUntil: 'networkidle' });
t = await text(eo.page);
ok('notaccepted', `Not Accepted complaint ${R} shows the reason, who decided and when`, rj.status() === 200 && t.includes('Not Accepted') && t.includes('Decided by') && /\d{1,2} \w+ \d{4}/.test(t) && (process.env.EXISTING_REJECTED ? true : t.includes('Photo does not show a street light') && t.includes('R. Senthil')), 'checked');
e = await act(eo.page, 'Accept complaint', async (f) => { await f.locator('textarea').fill('Citizen sent a clearer photo by phone'); });
ok('notaccepted', 'EO accepts it (reopen) → back in the workflow', !e && (await text(eo.page)).includes('Reopened'), e ?? 'ok');
await eo.ctx.request.post(`${B}/api/office/complaints/${R}/action?portal=OFFICE`, { data: { action: 'reject', reason: 'INVALID', notes: 'Automated UI test record' } });

// ---------------------------------------------------------------- unauthorized page access
const other = process.env.OTHER_CODE ?? await file('Street light test for access checks');
const r1 = await ravi.ctx.request.get(`${B}/office/complaints/${other}`);
ok('rbac', 'field staff cannot open a complaint that is not assigned to them', r1.status() === 404, r1.status());
const san = await session('OFFICE', 'officer.sanitation');
const r2 = await san.ctx.request.get(`${B}/office/complaints/${S}`);
ok('rbac', 'Sanitation officer cannot open an Electrical complaint (department jurisdiction)', r2.status() === 404, r2.status());
const r3 = await cit.ctx.request.get(`${B}/office/complaints/${S}`, { maxRedirects: 0 });
ok('rbac', 'citizen cannot open the officer page', [302, 303, 307, 308].includes(r3.status()), r3.status());
if (!process.env.OTHER_CODE) await eo.ctx.request.post(`${B}/api/office/complaints/${other}/action?portal=OFFICE`, { data: { action: 'reject', reason: 'INVALID', notes: 'Automated UI test record' } });

await browser.close();
const pass = res.filter((r) => r.pass).length;
console.log(`\n${pass}/${res.length} passed · ${TAG} · ${S} ${R} ${other}`);
writeFileSync(`critical-flow-${TAG}.json`, JSON.stringify({ base: B, tag: TAG, complaints: [S, R, other], res }, null, 2));
process.exit(pass === res.length ? 0 : 1);
