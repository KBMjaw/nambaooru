// Browser test of the core complaint-action flow, clicking through the real pages as each role:
// citizen files a TEST complaint → admin sees it → click the row → detail opens → TAKE ACTION → Acknowledge → Inspect
// → assign field staff → staff records Action Taken (description + reference photo) → Work Completed (after photo
// required) → Verification Pending → reviewer sees the evidence → REJECT / REWORK with a reason → staff notified →
// staff resubmits with a new photo → APPROVE & CLOSE → citizen sees the public timeline (and no internal notes).
// Also checks server-side refusals (missing photo, wrong role, other jurisdiction).
// Creates one dedicated TEST citizen and one TEST complaint (tagged ACT-TEST-<ts>); the complaint ends CLOSED.
//
//   node tests/action-flow-browser.mjs <baseUrl> <credentials.json> [--db=<postgres url>] [--chromium=<path>]
// --db adds direct database checks (status history, action log, evidence rows); leave it out against production.
// Needs playwright-core resolvable from the working directory.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const B = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
const opt = Object.fromEntries(process.argv.slice(4).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)));
const exe = opt.chromium ?? '/opt/pw-browsers/chromium';
const q = (s) => (opt.db ? execFileSync('psql', [opt.db, '-Atc', s]).toString().trim() : null);
const TS = String(Date.now()).slice(-6); const TAG = `ACT-TEST-${TS}`;
const res = []; const ok = (area, t, p, a = '') => { res.push({ area, test: t, pass: !!p, actual: String(a) }); console.log(`${p ? '✔' : '✘'} [${area}] ${t} — ${a}`); };
const stages = [];
const shot = async (p, name) => { if (opt.shots) await p.screenshot({ path: `${opt.shots}/${name}.png`, fullPage: true }).catch(() => {}); };
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCtRRRXzh9ef//Z', 'base64');
const GEO = { latitude: 11.165, longitude: 77.604 };
const photo = (n) => ({ name: `${n}.jpg`, mimeType: 'image/jpeg', buffer: JPG });

const browser = await chromium.launch({ executablePath: exe });
async function session(portal, id, pw) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, geolocation: GEO, permissions: ['geolocation'] });
  if (id) { const r = await ctx.request.post(`${B}/api/auth/login`, { data: { portal, identifier: id, password: pw ?? creds[id] } }); if (r.status() !== 200) throw new Error(`login ${id} ${r.status()}`); }
  await ctx.addCookies([{ name: 'nu_lang', value: 'en', url: B }]); // after login, which applies the saved language
  return { ctx, page: await ctx.newPage() };
}
const text = (p) => p.evaluate(() => document.body.innerText);
const openTakeAction = async (p) => {
  const ta = p.getByRole('button', { name: /TAKE ACTION/ });
  if ((await ta.getAttribute('aria-expanded')) !== 'true') await ta.click();
};
/** Record an action through the "Record an action" form. Returns { response json | null, uiError }. */
async function record(p, type, description, photos = 0, extra = async () => {}) {
  await openTakeAction(p);
  const form = p.getByTestId('record-action');
  await form.locator('select[name=actionType]').selectOption(type);
  await form.locator('textarea[name=description]').fill(description);
  await extra(form);
  if (photos) {
    await form.getByTestId('record-photo').setInputFiles(Array.from({ length: photos }, (_, i) => photo(`${type}-${i}`)));
    await p.waitForTimeout(1500); // compression + GPS
  }
  const respP = p.waitForResponse((r) => r.url().includes('/action') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
  await form.getByRole('button', { name: /Save action/ }).click();
  const resp = await respP;
  await p.waitForTimeout(1200);
  const uiError = await form.locator('.bg-red-50').first().textContent({ timeout: 500 }).catch(() => null);
  const json = resp ? await resp.json().catch(() => null) : null;
  return { status: resp?.status() ?? null, json, uiError };
}
/** A specialised TAKE ACTION form (Assign work, APPROVE & CLOSE, REJECT / REWORK). */
async function formAction(p, label, fill) {
  await openTakeAction(p);
  await p.locator('#take-action').getByRole('button', { name: new RegExp(label) }).first().click();
  const form = p.locator('#take-action div.rounded-xl').filter({ has: p.locator('p.font-bold', { hasText: new RegExp(label) }) }).last();
  await fill(form);
  const respP = p.waitForResponse((r) => r.url().includes('/action') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
  await form.getByRole('button', { name: /^Confirm$/ }).click();
  const resp = await respP;
  await p.waitForTimeout(1200);
  return { status: resp?.status() ?? null, json: resp ? await resp.json().catch(() => null) : null };
}
const stage = (name, r) => { stages.push({ stage: name, status: r?.json?.status ?? '—', action: r?.json?.actionCode ?? '—' }); };

// ---------------------------------------------------------------- 1. dedicated TEST citizen files a TEST complaint
const cit = await session(null);
const pin = await (await cit.ctx.request.get(`${B}/api/locations/pincode/638051`)).json();
const lb = pin.localBodies.find((l) => l.name_en === 'Chennimalai');
const w10 = (await (await cit.ctx.request.get(`${B}/api/locations?type=wards&parent=${lb.id}`)).json()).items.find((w) => w.ward_number === 10);
const mobile = `63${TS}${String(Date.now()).slice(-2)}`.slice(0, 10);
const cpw = `ActTest${TS}!x`;
const reg = await cit.ctx.request.post(`${B}/api/auth/register`, { data: { fullName: `${TAG} TEST Citizen`, dob: '1990-01-01', mobile, pincode: '638051', districtId: lb.district_id, localBodyId: lb.id, wardId: w10.id, address: `${TAG} test address`, password: cpw, consent: true } });
ok('setup', 'dedicated TEST citizen registered', reg.status() === 200, `${reg.status()} ${TAG} TEST Citizen`);
await cit.ctx.addCookies([{ name: 'nu_lang', value: 'en', url: B }]);
const ORIGINAL = `TEST COMPLAINT — please ignore (${TAG}). Street light near the bus stand is not working for 3 days.`;
const fc = await cit.ctx.request.post(`${B}/api/complaints`, { multipart: {
  payload: JSON.stringify({ text: ORIGINAL, inputMode: 'TEXT', categoryCode: 'STREET_LIGHT', localBodyId: lb.id, wardId: w10.id, streetId: null, streetText: `${TAG} test street`, landmark: 'bus stand', ...GEO, accuracy: 10, gpsAt: new Date().toISOString(), duplicateOverride: true }),
  evidenceMeta: JSON.stringify([{ ...GEO, accuracy: 10, capturedAt: new Date().toISOString(), source: 'CAMERA' }]), evidence: photo('citizen') } });
const code = (await fc.json()).code;
ok('setup', 'TEST complaint submitted with a citizen photo', fc.status() === 200 && code, code);
stages.push({ stage: 'Citizen submitted', status: q(`SELECT status FROM complaints WHERE code='${code}'`) ?? 'SUBMITTED/AI_CLASSIFIED', action: '—' });

// ---------------------------------------------------------------- 2. admin sees it; click the row; detail opens
const admin = await session('ADMIN', 'superadmin');
await admin.page.goto(`${B}/admin/complaints?q=${code}`, { waitUntil: 'networkidle' });
const arow = admin.page.locator('tbody tr').filter({ hasText: code }).first();
ok('open', 'admin sees the TEST complaint in the complaints list', await arow.count(), code);
if (await arow.count()) { await arow.locator('td').nth(2).click(); await admin.page.waitForURL(`**/${code}`, { timeout: 8000 }).catch(() => {}); }
ok('open', 'admin: clicking the row (not the number) opens the detail page', admin.page.url().endsWith(`/admin/complaints/${code}`), admin.page.url());

const eo = await session('OFFICE', 'eo.chennimalai');
const P = eo.page;
await P.goto(`${B}/office/complaints?q=${code}`, { waitUntil: 'networkidle' });
const row = P.locator('tbody tr').filter({ hasText: code }).first();
if (await row.count()) { await row.locator('td').nth(2).click(); await P.waitForURL(`**/${code}`, { timeout: 8000 }).catch(() => {}); }
ok('open', 'officer: clicking anywhere on the row opens the detail page', P.url().endsWith(`/office/complaints/${code}`), P.url());
const direct = await P.goto(`${B}/office/complaints/${code}`, { waitUntil: 'networkidle' });
ok('open', 'direct complaint URL works', direct.status() === 200, direct.status());
const dt = await text(P);
ok('detail', 'complaint number, original text, category, ward, date shown', dt.includes(code) && dt.includes('Street light near the bus stand') && /Street light/i.test(dt) && /Ward 10/i.test(dt), 'checked');
ok('detail', 'citizen photo shown', (await P.locator('img[src^="/api/evidence/"]').count()) >= 1, await P.locator('img[src^="/api/evidence/"]').count());
const ta = P.getByRole('button', { name: /TAKE ACTION/ });
const tab = await ta.boundingBox();
ok('detail', 'TAKE ACTION is a prominent button on the first screen', tab && tab.y < 900 && tab.height >= 48, tab && `${Math.round(tab.y)}px from top, ${Math.round(tab.height)}px tall`);
await openTakeAction(P);
await shot(P, '1-officer-detail-take-action');
ok('detail', 'TAKE ACTION opens the action form with an Action Type list', await P.getByTestId('record-action').locator('select[name=actionType]').count(), 'checked');

// ---------------------------------------------------------------- 3. officer: acknowledge → inspect → assign
let r = await record(P, 'ACKNOWLEDGE', `Acknowledged. Sent to the electrical section (${TAG}).`);
ok('officer', 'Acknowledge saved with an action code', r.status === 200 && /^ACT-\d+/.test(r.json?.actionCode ?? ''), `${r.status} ${r.json?.actionCode} → ${r.json?.status}`); stage('Acknowledged', r);
r = await record(P, 'OTHER', `INTERNAL-ONLY ${TAG}: check pole stock before sending staff`);
ok('officer', 'internal note (Other, Internal) saved', r.status === 200, `${r.status} ${r.json?.actionCode}`);
r = await record(P, 'INSPECT', `Site checked: lamp is dead, pole is fine (${TAG}).`, 1);
ok('officer', 'Inspect (site photo + GPS) → Verified', r.status === 200 && r.json?.status === 'VERIFIED', `${r.status} ${r.json?.actionCode} → ${r.json?.status}`); stage('Inspected / verified', r);
await P.reload(); await P.waitForLoadState('networkidle');
r = await formAction(P, 'Assign work', async (f) => {
  for (const sel of await f.locator('select').all()) {
    const v = await sel.evaluate((s) => [...s.options].find((o) => /Ravi/i.test(o.text))?.value ?? null);
    if (v) { await sel.selectOption(v); break; }
  }
});
ok('officer', 'assigned to field staff (Ravi) from TAKE ACTION', r.status === 200 && r.json?.status === 'ASSIGNED', `${r.status} ${r.json?.actionCode} → ${r.json?.status}`); stage('Staff assigned', r);

// ---------------------------------------------------------------- 4. field staff: action taken, work completed
const ravi = await session('OFFICE', 'field.ravi');
const F = ravi.page;
await F.goto(`${B}/office/complaints/${code}`, { waitUntil: 'networkidle' });
ok('staff', 'assigned staff opens the complaint and sees TAKE ACTION', await F.getByRole('button', { name: /TAKE ACTION/ }).count(), 'checked');
r = await record(F, 'ACTION_TAKEN', 'LED driver checked on site (no photo attached)');
ok('staff', 'Action Taken without a photo is blocked in the form', r.status == null && /photo/i.test(r.uiError ?? ''), r.uiError);
const noPhotoApi = await ravi.ctx.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { data: { action: 'record', actionType: 'ACTION_TAKEN', description: 'no photo via API' } });
ok('staff', 'Action Taken without a photo is refused by the server', noPhotoApi.status() === 400, `${noPhotoApi.status()} ${(await noPhotoApi.text()).slice(0, 80)}`);
r = await record(F, 'ACTION_TAKEN', 'Street light damaged. LED driver replaced and light tested.', 1);
const actionTakenEv = r.json?.evidenceIds ?? [];
ok('staff', 'Action Taken saved with description + reference photo', r.status === 200 && actionTakenEv.length === 1 && r.json?.status === 'IN_PROGRESS', `${r.status} ${r.json?.actionCode} → ${r.json?.status}, evidence ${actionTakenEv}`); stage('Action taken', r);
const evGet = actionTakenEv[0] ? await ravi.ctx.request.get(`${B}/api/evidence/${actionTakenEv[0]}`) : null;
ok('staff', 'action / reference photo stored and retrievable', evGet?.status() === 200 && /image\//.test(evGet.headers()['content-type'] ?? ''), `${evGet?.status()} ${evGet?.headers()['content-type']}`);
r = await record(F, 'WORK_COMPLETED', 'Work completed: new LED driver fitted, lamp tested at dusk.');
ok('staff', 'Work Completed without an after photo is blocked in the form', r.status == null && /photo/i.test(r.uiError ?? ''), r.uiError);
const noAfterApi = await ravi.ctx.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { data: { action: 'record', actionType: 'WORK_COMPLETED', description: 'no after photo via API' } });
ok('staff', 'Work Completed without an after photo is refused by the server', noAfterApi.status() === 400, `${noAfterApi.status()} ${(await noAfterApi.text()).slice(0, 80)}`);
r = await record(F, 'WORK_COMPLETED', 'Work completed: new LED driver fitted, lamp tested at dusk.', 1);
const after1 = r.json?.evidenceIds ?? [];
ok('staff', 'Work Completed with after photo → VERIFICATION_PENDING (not closed)', r.status === 200 && r.json?.status === 'VERIFICATION_PENDING', `${r.status} ${r.json?.actionCode} → ${r.json?.status}`); stage('Work completed', r);

// ---------------------------------------------------------------- 5. security: wrong people cannot act
const muthu = await session('OFFICE', 'field.muthu');
const m = await muthu.ctx.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { multipart: { data: JSON.stringify({ action: 'record', actionType: 'ACTION_TAKEN', description: 'not my work' }), photo: photo('x') } });
ok('security', 'unassigned field staff cannot record actions', [403, 404].includes(m.status()), m.status());
const ward = await session('OFFICE', 'ward10.member');
const wm = await ward.ctx.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { data: { action: 'verify_completion', decision: 'approve', close: true, notes: 'not allowed' } });
ok('security', 'ward member cannot approve / close', [403, 404].includes(wm.status()), wm.status());
const san = await session('OFFICE', 'officer.sanitation');
const sn = await san.ctx.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { data: { action: 'verify_completion', decision: 'send_back', notes: 'not my department' } });
ok('security', 'officer of another department cannot review it', [403, 404].includes(sn.status()), sn.status());
const citAct = await cit.ctx.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { data: { action: 'verify_completion', decision: 'approve', close: true, notes: 'citizen' } });
ok('security', 'citizen cannot call the officer action API', [401, 403].includes(citAct.status()), citAct.status());
const selfV = await ravi.ctx.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { data: { action: 'verify_completion', decision: 'approve', close: true, notes: 'my own work' } });
ok('security', 'field staff cannot approve their own work', [403, 404].includes(selfV.status()), selfV.status());
const anon = await browser.newContext();
const an = await anon.request.post(`${B}/api/office/complaints/${code}/action?portal=OFFICE`, { data: { action: 'close', note: 'x' } });
ok('security', 'anonymous request refused', [401, 403].includes(an.status()), an.status());
const mp = await muthu.page.goto(`${B}/office/complaints/${code}`);
ok('security', 'unassigned field staff cannot open the complaint page', mp.status() === 404, mp.status());

// ---------------------------------------------------------------- 6. reviewer: sees evidence, REJECT / REWORK
const sup = await session('OFFICE', 'sup.electrical');
const S = sup.page;
await S.goto(`${B}/office/complaints/${code}`, { waitUntil: 'networkidle' });
const panel = S.getByTestId('review-panel');
const pt = (await panel.count()) ? await panel.innerText() : '';
ok('review', 'reviewer sees: citizen complaint → before → action history → work description → after → completion details',
  ['1. CITIZEN COMPLAINT', '2. BEFORE', '3. ACTION HISTORY', '4. STAFF WORK DESCRIPTION', '5. AFTER', '6. COMPLETION DETAILS'].every((h) => pt.toUpperCase().includes(h)) && pt.includes('Street light near the bus stand') && pt.includes('LED driver replaced'), 'checked');
ok('review', 'before (citizen) and after (action) photos both shown', (await panel.locator('img[src^="/api/evidence/"]').count()) >= 3, await panel.locator('img[src^="/api/evidence/"]').count());
ok('review', 'APPROVE & CLOSE and REJECT / REWORK buttons shown', (await panel.getByRole('button', { name: /APPROVE & CLOSE/ }).count()) && (await panel.getByRole('button', { name: /REJECT \/ REWORK/ }).count()), 'checked');
await shot(S, '2-reviewer-review-panel');
const REWORK_REASON = `Lamp cover missing on site photo (${TAG})`;
r = await formAction(S, 'REJECT / REWORK', async (f) => { await f.locator('textarea').first().fill(REWORK_REASON); });
ok('review', 'REJECT / REWORK with reason → REWORK_REQUIRED', r.status === 200 && r.json?.status === 'REWORK_REQUIRED', `${r.status} ${r.json?.actionCode} → ${r.json?.status}`); stage('Rework required', r);
const rn = await (await ravi.ctx.request.get(`${B}/api/notifications?portal=OFFICE`)).json().catch(() => ({}));
const rnText = JSON.stringify(rn);
ok('review', 'assigned staff receive the rework notification (with reason)', rnText.includes(code) && rnText.includes('Lamp cover missing'), 'checked');

// ---------------------------------------------------------------- 7. staff redo with new evidence; reviewer approves & closes
await F.goto(`${B}/office/complaints/${code}`, { waitUntil: 'networkidle' });
const ft = await text(F);
ok('staff', 'staff see the rework reason on the complaint', ft.includes('Lamp cover missing'), 'checked');
r = await record(F, 'WORK_COMPLETED', 'Rework done: lamp cover fitted and tested.', 1);
const after2 = r.json?.evidenceIds ?? [];
ok('staff', 'staff resubmit with a new after photo → VERIFICATION_PENDING', r.status === 200 && r.json?.status === 'VERIFICATION_PENDING' && after2.length === 1 && after2[0] !== after1[0], `${r.status} ${r.json?.actionCode} → ${r.json?.status}`); stage('Resubmitted', r);
await P.goto(`${B}/office/complaints/${code}`, { waitUntil: 'networkidle' });
r = await formAction(P, 'APPROVE & CLOSE', async (f) => { await f.locator('textarea').first().fill('Verified from the after photos: lamp working, cover fitted.'); });
ok('review', 'APPROVE & CLOSE → CLOSED', r.status === 200 && r.json?.status === 'CLOSED', `${r.status} ${r.json?.actionCode} → ${r.json?.status}`); stage('Approved & closed', r);
await P.reload(); await P.waitForLoadState('networkidle');
await shot(P, '3-officer-closed-action-history');
const hist = (await P.getByTestId('action-history').first().innerText().catch(() => ''));
ok('history', 'action history lists every action with its code, actor and status change', (hist.match(/ACT-\d{6}/g) ?? []).length >= 8 && hist.includes('Action taken') && hist.includes('Work completed') && hist.includes('→'), `${(hist.match(/ACT-\d{6}/g) ?? []).length} actions`);

// ---------------------------------------------------------------- 8. citizen view
const cp = await cit.ctx.newPage();
await cp.goto(`${B}/complaints/${code}`, { waitUntil: 'networkidle' });
const ct = await text(cp);
await shot(cp, '4-citizen-timeline');
for (const step of ['Complaint submitted', 'Acknowledged', 'Assigned to department', 'Staff assigned', 'Action taken', 'Work completed', 'Evidence submitted', 'Under verification', 'Approved after verification', 'Resolved / closed'])
  ok('citizen', `timeline shows "${step}"`, ct.includes(step), 'checked');
ok('citizen', 'timeline shows the public action description', ct.includes('LED driver replaced and light tested'), 'checked');
ok('citizen', 'timeline shows rework was requested', /Rework requested 1 time/.test(ct), 'checked');
ok('citizen', 'internal note is NOT visible', !ct.includes('INTERNAL-ONLY') && !ct.includes('check pole stock'), 'checked');
ok('citizen', 'internal reviewer reason is NOT visible', !ct.includes('Lamp cover missing'), 'checked');
ok('citizen', 'citizen sees before and after photos', (await cp.locator('img[src^="/api/evidence/"]').count()) >= 3, await cp.locator('img[src^="/api/evidence/"]').count());
const cn = JSON.stringify(await (await cit.ctx.request.get(`${B}/api/notifications`)).json().catch(() => ({})));
ok('citizen', 'citizen received notifications for the public steps', (cn.match(new RegExp(code, 'g')) ?? []).length >= 4 && !cn.includes('INTERNAL-ONLY') && !cn.includes('Lamp cover missing'), `${(cn.match(new RegExp(code, 'g')) ?? []).length} mentions`);

// ---------------------------------------------------------------- 9. database (local only)
if (opt.db) {
  const id = q(`SELECT id FROM complaints WHERE code='${code}'`);
  const hs = q(`SELECT string_agg(to_status, ' → ' ORDER BY created_at, id) FROM complaint_status_history WHERE complaint_id=${id} AND from_status IS DISTINCT FROM to_status`);
  ok('db', 'status history recorded for every change', hs.includes('VERIFICATION_PENDING') && hs.includes('REWORK_REQUIRED') && hs.endsWith('CLOSED'), hs);
  const log = q(`SELECT count(*) FROM complaint_action_log WHERE complaint_id=${id}`);
  ok('db', 'action log rows with codes', +log >= 8, log);
  const ev = q(`SELECT string_agg(e.kind || ':' || coalesce(l.code,'-') || ':' || u.username, ', ' ORDER BY e.id) FROM complaint_evidence e JOIN users u ON u.id=e.uploaded_by LEFT JOIN complaint_action_log l ON l.id=e.workflow_action_id WHERE e.complaint_id=${id}`);
  ok('db', 'evidence stored by kind, uploader and action (citizen photo untouched)', ev.startsWith('CITIZEN:-:') && /ACTION_REFERENCE:ACT-\d+:field\.ravi/.test(ev) && (ev.match(/AFTER:ACT-\d+:field\.ravi/g) ?? []).length === 2, ev);
  const cev = q(`SELECT verification_status || ':' || coalesce(verification_notes,'') || ':' || (verified_by IS NOT NULL) || ':' || (verified_at IS NOT NULL) FROM completion_evidence WHERE complaint_id=${id} ORDER BY completed_at`);
  ok('db', 'rework reason, reviewer and time persisted', cev.includes(`SENT_BACK:${REWORK_REASON}:true:true`) && cev.includes('APPROVED:'), cev.replace(/\n/g, ' | '));
  const au = q(`SELECT count(*) FROM audit_logs WHERE entity_type='complaint' AND entity_id='${code}'`);
  ok('db', 'audit log entries', +au >= 8, au);
  stages.forEach((s) => { if (s.action !== '—') s.db = q(`SELECT to_status FROM complaint_action_log WHERE code='${s.action}'`); });
}

await browser.close();
const passed = res.filter((x) => x.pass).length;
console.log('\nSTAGES'); for (const s of stages) console.log(`  ${s.stage.padEnd(22)} ${s.status.padEnd(22)} ${s.action}`);
writeFileSync(`action-flow-${TAG}.json`, JSON.stringify({ code, tag: TAG, citizenMobile: mobile, stages, results: res }, null, 2));
console.log(`\n${passed}/${res.length} passed · ${TAG} · ${code}`);
if (passed !== res.length) process.exitCode = 1;
