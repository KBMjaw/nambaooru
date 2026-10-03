// TAKE ACTION from all three entry points reaches the same action workflow (same panel, same API, same records):
//   A. Complaints → List view → row TAKE ACTION (desktop and phone)
//   B. Complaints → Map view → marker → Open detail → TAKE ACTION
//   C. Direct complaint URL → TAKE ACTION
// The flow runs one dedicated TEST complaint through Acknowledge → Inspect → Assign → Action taken → Work completed
// → REJECT / REWORK → resubmit → APPROVE & CLOSE, switching entry points between steps, then checks that every step
// was persisted identically (action code, status change, evidence links, audit, notifications) and that the list only
// offers TAKE ACTION where the user can act. Creates one TEST citizen + complaint (tag LTA-TEST-<ts>).
//
//   node tests/list-take-action-browser.mjs <baseUrl> <credentials.json> [--db=<postgres url>] [--shots=<dir>] [--chromium=<path>]
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const B = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
const opt = Object.fromEntries(process.argv.slice(4).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)));
const q = (s) => (opt.db ? execFileSync('psql', [opt.db, '-Atc', s]).toString().trim() : null);
const TS = String(Date.now()).slice(-6); const TAG = `LTA-TEST-${TS}`;
const res = []; const ok = (area, t, p, a = '') => { res.push({ area, test: t, pass: !!p, actual: String(a) }); console.log(`${p ? '✔' : '✘'} [${area}] ${t} — ${a}`); };
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCtRRRXzh9ef//Z', 'base64');
const GEO = { latitude: 11.165, longitude: 77.604 };
const photo = (n) => ({ name: `${n}.jpg`, mimeType: 'image/jpeg', buffer: JPG });
const shot = async (p, name) => { if (opt.shots) await p.screenshot({ path: `${opt.shots}/${name}.png` }).catch(() => {}); };

const browser = await chromium.launch({ executablePath: opt.chromium ?? '/opt/pw-browsers/chromium' });
const cspIssues = []; const jsErrors = [];
async function session(portal, id, phone = false) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone, geolocation: GEO, permissions: ['geolocation'] });
  if (id) { const r = await ctx.request.post(`${B}/api/auth/login`, { data: { portal, identifier: id, password: creds[id] } }); if (r.status() !== 200) throw new Error(`login ${id} ${r.status()}`); }
  await ctx.addCookies([{ name: 'nu_lang', value: 'en', url: B }]);
  ctx.on('page', (pg) => {
    pg.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspIssues.push({ id, url: pg.url(), msg: m.text().slice(0, 160) }); });
    pg.on('pageerror', (e) => jsErrors.push({ id, url: pg.url(), error: String(e).slice(0, 160) }));
  });
  return { ctx, page: await ctx.newPage() };
}
const panelOpen = async (p) => (await p.getByRole('button', { name: /TAKE ACTION/ }).getAttribute('aria-expanded')) === 'true';

/** Entry A: complaints list → the row's TAKE ACTION button. Returns whether the panel arrived open on the right complaint. */
async function viaList(p, code, phone = false) {
  await p.goto(`${B}/office/complaints?q=${code}`, { waitUntil: 'networkidle' });
  const scope = phone ? p.locator('ul li').filter({ hasText: code }).first() : p.locator('tbody tr').filter({ hasText: code }).first();
  const btn = scope.getByTestId('list-take-action');
  if (!(await btn.count()) || !(await btn.isVisible())) return { ok: false, why: 'no visible TAKE ACTION on the row' };
  await btn.click();
  await p.waitForURL(new RegExp(`/office/complaints/${code}\\?action=1`), { timeout: 8000 }).catch(() => {});
  await p.waitForLoadState('networkidle');
  const onRight = p.url().includes(`/office/complaints/${code}`);
  const open = await panelOpen(p);
  const inView = await p.evaluate(() => { const r = document.getElementById('take-action')?.getBoundingClientRect(); return !!r && r.top < window.innerHeight && r.bottom > 0; });
  return { ok: onRight && open && inView, why: `url=${p.url().replace(B, '')} open=${open} inView=${inView}` };
}
/** Entry B: complaints map view → marker popup → Open detail → TAKE ACTION. */
async function viaMap(p, code) {
  await p.goto(`${B}/office/complaints?view=map&q=${code}`, { waitUntil: 'networkidle' });
  await p.locator('.nu-marker').first().click();
  const link = p.locator('.leaflet-popup a', { hasText: /Open/ }).first();
  await link.waitFor({ timeout: 5000 });
  await link.click();
  await p.waitForURL(new RegExp(`/office/complaints/${code}$`), { timeout: 8000 }).catch(() => {});
  await p.waitForLoadState('networkidle');
  await p.getByRole('button', { name: /TAKE ACTION/ }).click();
  return { ok: p.url().endsWith(`/office/complaints/${code}`) && (await panelOpen(p)), why: p.url().replace(B, '') };
}
/** Entry C: direct URL → TAKE ACTION. */
async function viaDirect(p, code) {
  await p.goto(`${B}/office/complaints/${code}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /TAKE ACTION/ }).click();
  return { ok: await panelOpen(p), why: p.url().replace(B, '') };
}
/** The existing "Record an action" form in the TAKE ACTION panel. */
async function record(p, type, description, photos = 0) {
  const form = p.getByTestId('record-action');
  await form.locator('select[name=actionType]').selectOption(type);
  await form.locator('textarea[name=description]').fill(description);
  if (photos) { await form.getByTestId('record-photo').setInputFiles(Array.from({ length: photos }, (_, i) => photo(`${type}-${i}`))); await p.waitForTimeout(1500); }
  const respP = p.waitForResponse((r) => r.url().includes('/action?') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
  await form.getByRole('button', { name: /Save action/ }).click();
  const resp = await respP; await p.waitForTimeout(1000);
  return { status: resp?.status() ?? null, json: resp ? await resp.json().catch(() => null) : null, uiError: await form.locator('.bg-red-50').first().textContent({ timeout: 300 }).catch(() => null) };
}
/** A specialised form in the same TAKE ACTION panel (Assign work, APPROVE & CLOSE, REJECT / REWORK). */
async function formAction(p, label, fill) {
  await p.locator('#take-action').getByRole('button', { name: new RegExp(label) }).first().click();
  const form = p.locator('#take-action div.rounded-xl').filter({ has: p.locator('p.font-bold', { hasText: new RegExp(label) }) }).last();
  await fill(form);
  const respP = p.waitForResponse((r) => r.url().includes('/action?') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
  await form.getByRole('button', { name: /^Confirm$/ }).click();
  const resp = await respP; await p.waitForTimeout(1000);
  return { status: resp?.status() ?? null, json: resp ? await resp.json().catch(() => null) : null };
}
const steps = [];
const step = (entry, name, r, expectStatus) => {
  steps.push({ entry, name, status: r.json?.status, code: r.json?.actionCode, evidence: r.json?.evidenceIds ?? [] });
  ok(entry, `${name} → ${expectStatus}`, r.status === 200 && r.json?.status === expectStatus && /^ACT-\d{6}$/.test(r.json?.actionCode ?? ''), `${r.status} ${r.json?.actionCode} → ${r.json?.status}${r.uiError ? ` ${r.uiError}` : ''}`);
};

// ---------------------------------------------------------------- setup: dedicated TEST citizen + TEST complaint
const cit = await session(null);
const pin = await (await cit.ctx.request.get(`${B}/api/locations/pincode/638051`)).json();
const lb = pin.localBodies.find((l) => l.name_en === 'Chennimalai');
const w10 = (await (await cit.ctx.request.get(`${B}/api/locations?type=wards&parent=${lb.id}`)).json()).items.find((w) => w.ward_number === 10);
const reg = await cit.ctx.request.post(`${B}/api/auth/register`, { data: { fullName: `${TAG} TEST Citizen`, dob: '1990-01-01', mobile: `62${TS}${String(Date.now()).slice(-2)}`.slice(0, 10), pincode: '638051', districtId: lb.district_id, localBodyId: lb.id, wardId: w10.id, address: `${TAG} test`, password: `Lta${TS}pass!x`, consent: true } });
await cit.ctx.addCookies([{ name: 'nu_lang', value: 'en', url: B }]);
const fc = await cit.ctx.request.post(`${B}/api/complaints`, { multipart: {
  payload: JSON.stringify({ text: `TEST COMPLAINT — please ignore (${TAG}). Street light near the school gate is off.`, inputMode: 'TEXT', categoryCode: 'STREET_LIGHT', localBodyId: lb.id, wardId: w10.id, streetId: null, streetText: `${TAG} street`, landmark: 'school gate', ...GEO, accuracy: 10, gpsAt: new Date().toISOString(), duplicateOverride: true }),
  evidenceMeta: JSON.stringify([{ ...GEO, accuracy: 10, capturedAt: new Date().toISOString(), source: 'CAMERA' }]), evidence: photo('citizen') } });
const code = (await fc.json()).code;
ok('setup', 'TEST citizen + TEST complaint', reg.status() === 200 && code, code);

const eo = await session('OFFICE', 'eo.chennimalai');
const sup = await session('OFFICE', 'sup.electrical');
const ravi = await session('OFFICE', 'field.ravi');
const raviPhone = await session('OFFICE', 'field.ravi', true);
const eoPhone = await session('OFFICE', 'eo.chennimalai', true);

// ---------------------------------------------------------------- list view shows TAKE ACTION (desktop + phone)
await eo.page.goto(`${B}/office/complaints?q=${code}`, { waitUntil: 'networkidle' });
const row = eo.page.locator('tbody tr').filter({ hasText: code }).first();
ok('list', 'desktop list row shows [View / Open] and [TAKE ACTION] without opening the map', (await row.getByRole('link', { name: /View \/ Open|Open complaint/ }).count()) && (await row.getByTestId('list-take-action').isVisible()), 'checked');
await shot(eo.page, 'list-desktop-take-action');
await eoPhone.page.goto(`${B}/office/complaints?q=${code}`, { waitUntil: 'networkidle' });
const card = eoPhone.page.locator('ul li').filter({ hasText: code }).first();
const mb = await card.getByTestId('list-take-action').boundingBox();
ok('list', 'phone list card shows an accessible TAKE ACTION button (≥ 44px, labelled)', mb && mb.height >= 44 && (await card.getByTestId('list-take-action').getAttribute('aria-label'))?.includes(code), mb && `${Math.round(mb.height)}px`);
ok('list', 'phone list: no horizontal scroll', (await eoPhone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'checked');
await shot(eoPhone.page, 'list-phone-take-action');
// The row itself still opens the complaint (existing behaviour kept)
await row.locator('td').nth(1).click();
await eo.page.waitForURL(new RegExp(`/office/complaints/${code}$`), { timeout: 8000 }).catch(() => {});
ok('list', 'clicking the row itself still opens the complaint (TAKE ACTION panel closed)', eo.page.url().endsWith(`/office/complaints/${code}`) && !(await panelOpen(eo.page)), eo.page.url().replace(B, ''));

// ---------------------------------------------------------------- the flow, alternating entry points
let e = await viaList(eo.page, code); ok('A list', 'EO: list TAKE ACTION opens the same TAKE ACTION panel on this complaint', e.ok, e.why);
step('A list', 'EO Acknowledge', await record(eo.page, 'ACKNOWLEDGE', `Acknowledged from the list (${TAG})`), 'INITIAL_REVIEW');
e = await viaMap(eo.page, code); ok('B map', 'EO: map → marker → Open detail → TAKE ACTION', e.ok, e.why);
step('B map', 'EO Inspect (photo + GPS)', await record(eo.page, 'INSPECT', `Inspected from the map (${TAG})`, 1), 'VERIFIED');
e = await viaDirect(eo.page, code); ok('C direct', 'EO: direct URL → TAKE ACTION', e.ok, e.why);
step('C direct', 'EO Assign work (Ravi)', await formAction(eo.page, 'Assign work', async (f) => {
  for (const sel of await f.locator('select').all()) { const v = await sel.evaluate((s) => [...s.options].find((o) => /Ravi/i.test(o.text))?.value ?? null); if (v) { await sel.selectOption(v); break; } }
}), 'ASSIGNED');

e = await viaList(raviPhone.page, code, true); ok('A list (phone)', 'field staff: phone list TAKE ACTION opens the panel', e.ok, e.why);
let r = await record(raviPhone.page, 'ACTION_TAKEN', 'Street light damaged. LED driver replaced and light tested.');
ok('A list (phone)', 'Action Taken without a photo is still blocked (evidence rule unchanged)', r.status == null && /photo/i.test(r.uiError ?? ''), r.uiError);
step('A list (phone)', 'Staff Action Taken + reference photo', await record(raviPhone.page, 'ACTION_TAKEN', 'Street light damaged. LED driver replaced and light tested.', 1), 'IN_PROGRESS');
e = await viaDirect(ravi.page, code); ok('C direct', 'field staff: direct URL → TAKE ACTION', e.ok, e.why);
r = await record(ravi.page, 'WORK_COMPLETED', 'Work completed, lamp tested at dusk.');
ok('C direct', 'Work Completed without an after photo is still blocked', r.status == null && /photo/i.test(r.uiError ?? ''), r.uiError);
step('C direct', 'Staff Work Completed + after photo', await record(ravi.page, 'WORK_COMPLETED', 'Work completed, lamp tested at dusk.', 1), 'VERIFICATION_PENDING');

e = await viaMap(sup.page, code); ok('B map', 'reviewer: map → Open detail → TAKE ACTION', e.ok, e.why);
step('B map', 'Reviewer REJECT / REWORK', await formAction(sup.page, 'REJECT / REWORK', async (f) => { await f.locator('textarea').first().fill(`Lamp cover missing (${TAG})`); }), 'REWORK_REQUIRED');
e = await viaList(ravi.page, code); ok('A list', 'field staff: desktop list TAKE ACTION opens the panel', e.ok, e.why);
step('A list', 'Staff resubmits Work Completed + new photo', await record(ravi.page, 'WORK_COMPLETED', 'Rework done: lamp cover fitted.', 1), 'VERIFICATION_PENDING');
e = await viaList(eo.page, code); ok('A list', 'EO: list TAKE ACTION for review', e.ok, e.why);
step('A list', 'EO APPROVE & CLOSE', await formAction(eo.page, 'APPROVE & CLOSE', async (f) => { await f.locator('textarea').first().fill('Verified from the after photos. Closing.'); }), 'CLOSED');

// ---------------------------------------------------------------- same persisted behaviour from every entry point
const byEntry = (x) => steps.filter((s) => s.entry.startsWith(x));
ok('same', 'every step from every entry point returned an action code', steps.every((s) => /^ACT-\d{6}$/.test(s.code ?? '')), steps.map((s) => `${s.entry.split(' ')[0]}:${s.code}`).join(' '));
ok('same', 'photo steps linked evidence from list, map and direct entry alike', byEntry('A').some((s) => s.evidence.length) && byEntry('B').some((s) => s.evidence.length) && byEntry('C').some((s) => s.evidence.length), 'checked');
if (opt.db) {
  const id = q(`SELECT id FROM complaints WHERE code='${code}'`);
  const logs = q(`SELECT string_agg(l.code || ':' || l.action_type || ':' || l.from_status || '>' || l.to_status || ':' || (SELECT count(*) FROM complaint_evidence e WHERE e.workflow_action_id = l.id), ' ' ORDER BY l.id) FROM complaint_action_log l WHERE l.complaint_id=${id}`);
  ok('db', 'action log has every step (code, type, status change, evidence count)', steps.every((s) => logs.includes(s.code)), logs);
  const ev = q(`SELECT string_agg(kind || '@' || coalesce((SELECT code FROM complaint_action_log WHERE id = workflow_action_id), '-'), ' ' ORDER BY id) FROM complaint_evidence WHERE complaint_id=${id}`);
  ok('db', 'evidence kinds unchanged: CITIZEN, INSPECTION, ACTION_REFERENCE, AFTER ×2 — each linked to its action', /^CITIZEN@- INSPECTION@ACT-\d+ ACTION_REFERENCE@ACT-\d+ AFTER@ACT-\d+ AFTER@ACT-\d+$/.test(ev), ev);
  const au = +q(`SELECT count(*) FROM audit_logs WHERE entity_type='complaint' AND entity_id='${code}'`);
  const nt = +q(`SELECT count(*) FROM notifications WHERE complaint_id=${id}`);
  ok('db', 'audit and notifications written as before', au >= 10 && nt >= 8, `audit ${au}, notifications ${nt}`);
}
const ct = await (async () => { const p = await cit.ctx.newPage(); await p.goto(`${B}/complaints/${code}`, { waitUntil: 'networkidle' }); return p.evaluate(() => document.body.innerText); })();
ok('citizen', 'citizen timeline unchanged: all stages, public description, internal reason hidden',
  ['Complaint submitted', 'Acknowledged', 'Staff assigned', 'Action taken', 'Work completed', 'Evidence submitted', 'Under verification', 'Approved after verification', 'Resolved / closed'].every((x) => ct.includes(x))
  && ct.includes('LED driver replaced') && !ct.includes('Lamp cover missing'), 'checked');

// ---------------------------------------------------------------- TAKE ACTION only where the user can act
await ravi.page.goto(`${B}/office/complaints?q=${code}`, { waitUntil: 'networkidle' });
const rrow = ravi.page.locator('tbody tr').filter({ hasText: code }).first();
ok('rbac', 'closed complaint: field staff (no reopen permission) get no TAKE ACTION on the row', (await rrow.count()) && !(await rrow.getByTestId('list-take-action').count()), `row ${await rrow.count()}`);
await ravi.page.goto(`${B}/office/complaints/${code}?action=1`, { waitUntil: 'networkidle' });
ok('rbac', '…and forcing ?action=1 shows no actions either (same rules)', (await ravi.page.getByTestId('record-action').count()) === 0 && (await ravi.page.locator('#take-action').innerText()).includes('No actions available'), 'checked');
await eo.page.goto(`${B}/office/complaints?q=${code}`, { waitUntil: 'networkidle' });
ok('rbac', 'closed complaint: EO (reopen permission) still gets TAKE ACTION, as on the detail page', await eo.page.locator('tbody tr').filter({ hasText: code }).getByTestId('list-take-action').count(), 'checked');
const san = await session('OFFICE', 'officer.sanitation');
await san.page.goto(`${B}/office/complaints?q=${code}`, { waitUntil: 'networkidle' });
ok('rbac', 'other department: complaint not listed at all', !(await san.page.locator('tbody tr').filter({ hasText: code }).count()), 'checked');
const forged = await san.ctx.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { data: { action: 'record', actionType: 'OTHER', description: 'forged from another department' } });
ok('rbac', 'server still refuses an action outside jurisdiction', forged.status() === 404, forged.status());

ok('csp', 'no CSP violations and no JS errors on any page', !cspIssues.length && !jsErrors.length, JSON.stringify([...cspIssues, ...jsErrors].slice(0, 3)));
await browser.close();
const passed = res.filter((x) => x.pass).length;
writeFileSync(`list-take-action-${TAG}.json`, JSON.stringify({ code, steps, results: res }, null, 2));
console.log(`\n${passed}/${res.length} passed · ${TAG} · ${code}`);
if (passed !== res.length) process.exitCode = 1;
