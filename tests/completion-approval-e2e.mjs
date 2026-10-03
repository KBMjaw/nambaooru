// "Mark as completed" for every category, and final approval by the EO or an Admin above the EO.
//   - officers handling a complaint (Supervisor, Dept officer, EO) mark it completed from any open stage
//     with a reference photo + GPS (no distance limit for these higher grades);
//   - field staff (lower grade) must be within 200 m of the complaint, and from a mobile phone the photo
//     must be a live camera photo (gallery upload only from a PC / laptop);
//   - only the EO / System Admin / Super Admin give the final approval (which closes the complaint), never
//     on their own completion; Supervisors / Dept officers can only send it back for rework;
//   - site inspection is no longer mandatory for any category.
// API checks plus browser checks of the forms (desktop and phone). Creates controlled TEST records tagged
// CMP-TEST-<ts> (one citizen and their complaints); every test complaint ends Closed and the citizen is deactivated.
//
//   node tests/completion-approval-e2e.mjs <baseUrl> <credentials.json> [--chromium=<path>] [--shots=<dir>]
//
// credentials.json maps usernames to passwords for superadmin, eo.chennimalai, sup.electrical, field.ravi,
// ward10.member (never commit it).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
const opt = Object.fromEntries(process.argv.slice(4).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)));
const TS = String(Date.now()).slice(-6);
const TAG = `CMP-TEST-${TS}`;
const results = [];
const ok = (area, test, pass, actual = '') => { results.push({ area, test, pass: !!pass, actual: String(actual) }); console.log(`${pass ? '✔' : '✘'} [${area}] ${test} — ${actual}`); };
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCtRRRXzh9ef//Z', 'base64');
// Complaint location, a point ~110 m away, ~250 m away and ~5 km away
const SITE = { latitude: 11.1650, longitude: 77.6040, accuracy: 10 };
const NEAR = { latitude: 11.1660, longitude: 77.6040, accuracy: 8 };
const OUT_250 = { latitude: 11.16725, longitude: 77.6040, accuracy: 8 };
const FAR = { latitude: 11.2100, longitude: 77.6040, accuracy: 15 };
const UA = {
  MOBILE: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  DESKTOP: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

class Client {
  cookies = {};
  constructor(portal = 'OFFICE') { this.portal = portal; }
  async req(path, { method, body, form, ua } = {}) {
    const headers = { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': ua ?? UA.DESKTOP };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method: method ?? (body || form ? 'POST' : 'GET'), headers, body: form ?? (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';'); const [k, ...v] = kv.split('=');
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c)) delete this.cookies[k]; else this.cookies[k] = v.join('=');
    }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text };
  }
}
const login = async (portal, username) => {
  const c = new Client(portal); c.cookies.nu_lang = 'en';
  const r = await c.req('/api/auth/login', { body: { portal, identifier: username, password: creds[username] } });
  if (r.status !== 200) throw new Error(`login ${username}: ${r.status}`);
  c.cookies.nu_lang = 'en';
  return c;
};
/** Workflow action; `photos` = [{ source, ageMs }] per attached photo (what the completion forms send as photoMeta). */
const act = (c, code, data, { photos = [], ua, meta = true } = {}) => {
  const url = `/api/office/complaints/${code}/action?portal=${c.portal}`;
  if (!photos.length) return c.req(url, { body: data, ua });
  const fd = new FormData();
  fd.set('data', JSON.stringify(meta ? { ...data, photoMeta: photos } : data));
  photos.forEach((_, i) => fd.append('photo', new Blob([JPG], { type: 'image/jpeg' }), `p${i}.jpg`));
  return c.req(url, { form: fd, ua });
};
const LIVE = [{ source: 'CAMERA', ageMs: 20_000 }];
const GALLERY = [{ source: 'FILE', ageMs: 3 * 24 * 3600_000 }];
const expect = (area, test, r, status, msg) => ok(area, test, (Array.isArray(status) ? status : [status]).includes(r.status) && (!msg || r.json?.message === msg), `${r.status}${r.json?.message ? ` ${r.json.message}` : ''}`);

const pub = new Client();
const pin = (await pub.req('/api/locations/pincode/638051')).json;
const lb = pin.localBodies.find((l) => l.name_en === 'Chennimalai');
const w10 = (await pub.req(`/api/locations?type=wards&parent=${lb.id}`)).json.items.find((w) => w.ward_number === 10);
const sa = await login('ADMIN', 'superadmin');
const eo = await login('OFFICE', 'eo.chennimalai');
const sup = await login('OFFICE', 'sup.electrical');
const ravi = await login('OFFICE', 'field.ravi');
const ward = await login('OFFICE', 'ward10.member');
const findDeep = (o, pred) => { if (!o || typeof o !== 'object') return null; if (pred(o)) return o; for (const v of Object.values(o)) { const f = findDeep(v, pred); if (f) return f; } return null; };
const RAVI = findDeep((await sa.req('/api/admin/users?portal=ADMIN&q=field.ravi')).json, (o) => o.username === 'field.ravi')?.id;

const cit = new Client('PUBLIC'); cit.cookies.nu_lang = 'en';
const reg = await cit.req('/api/auth/register', { body: { fullName: `${TAG} Citizen`, dob: '1990-05-01', mobile: `63${TS}77`.slice(0, 10), pincode: '638051', districtId: lb.district_id, localBodyId: lb.id, wardId: w10.id, address: 'Test Street', password: `Cmp${TS}pass!`, consent: true } });
ok('setup', 'TEST citizen registered; staff ids resolved', reg.status === 200 && RAVI, `${reg.status}`);
cit.cookies.nu_lang = 'en';
async function file(text, category = 'STREET_LIGHT') {
  const fd = new FormData();
  fd.set('payload', JSON.stringify({ text: `${text} (${TAG})`, inputMode: 'TEXT', categoryCode: category, localBodyId: lb.id, wardId: w10.id, streetId: null, streetText: `${TAG} road`, landmark: 'near temple', ...SITE, gpsAt: new Date().toISOString(), duplicateOverride: true }));
  fd.set('evidenceMeta', JSON.stringify([{ ...SITE, capturedAt: new Date().toISOString(), source: 'CAMERA' }]));
  fd.append('evidence', new Blob([JPG], { type: 'image/jpeg' }), 'c.jpg');
  const r = await cit.req('/api/complaints', { form: fd });
  if (!r.json?.code) throw new Error(`file: ${r.status} ${r.text.slice(0, 150)}`);
  return r.json.code;
}
const statusOf = async (code) => { const r = await eo.req(`/office/complaints/${code}`); return (r.text.match(/data-status="([A-Z_]+)"/) ?? [])[1]; };
const notifs = async (c) => (await c.req(`/api/notifications?portal=${c.portal}`)).json?.items ?? [];
const record = (c, code, description, geo, photos, extra = {}) => act(c, code, { action: 'record', actionType: 'WORK_COMPLETED', description, ...(geo ?? {}), ...extra }, { photos });
const codes = [];

// ============================================================ 1. Supervisor (higher grade) marks it completed straight from intake
const A = await file('Street light near the bus stop is not working'); codes.push(A);
ok('intake', 'new complaint waits in intake', ['SUBMITTED', 'AI_CLASSIFIED'].includes(await statusOf(A)), await statusOf(A));
const supPage = (await sup.req(`/office/complaints/${A}`)).text;
ok('ui', 'supervisor is offered "Mark as completed" in Record an action (any stage, no inspection first)', /types\\?":\[[^\]]*WORK_COMPLETED/.test(supPage), 'checked');
expect('rules', 'without a reference photo → refused', await record(sup, A, 'Lamp replaced and tested', FAR, []), 400);
expect('rules', 'without GPS → refused', await record(sup, A, 'Lamp replaced and tested', null, LIVE), 400, 'field.needLocation');
expect('rbac', 'ward member (no MARK_COMPLETED permission) cannot mark it completed', await record(ward, A, 'Looks fixed to me', NEAR, LIVE), 403);
expect('rbac', 'field staff not assigned to it cannot mark it completed (outside their scope)', await record(ravi, A, 'Fixed it', NEAR, LIVE), [403, 404]);
expect('higher', 'supervisor marks completed with photo + GPS 5 km away (no distance limit for higher grade, gallery photo OK)', await record(sup, A, 'Lamp replaced and tested at night', FAR, GALLERY), 200);
ok('higher', '→ Verification pending (final approval)', (await statusOf(A)) === 'VERIFICATION_PENDING', await statusOf(A));
ok('notify', 'EO notified to give the final approval', (await notifs(eo)).some((n) => n.code === A && n.title_en === 'Work completed — verify'), 'checked');
const eoA = (await eo.req(`/office/complaints/${A}`)).text;
ok('review', 'EO review panel shows distance, device and photo type of the completion', eoA.includes('Distance from complaint') && /\b5\d{3} m\b/.test(eoA) && eoA.includes('PC / laptop') && eoA.includes('Uploaded photo'), 'checked');
ok('review', 'EO sees APPROVE & CLOSE', eoA.includes('APPROVE &amp; CLOSE') || eoA.includes('APPROVE & CLOSE'), 'checked');
expect('approve', 'supervisor cannot approve their own completion', await act(sup, A, { action: 'verify_completion', decision: 'approve', notes: 'Done' }), 403);
expect('approve', 'final approval needs a closure note', await act(eo, A, { action: 'verify_completion', decision: 'approve' }), 400);
expect('approve', 'EO gives the final approval → closed', await act(eo, A, { action: 'verify_completion', decision: 'approve', notes: 'Photo confirms the new lamp' }), 200);
ok('approve', '→ Closed', (await statusOf(A)) === 'CLOSED', await statusOf(A));

// ============================================================ 2. Field staff (lower grade): 200 m + live photo on mobile
const B = await file('Street light flickering near the school');
codes.push(B);
expect('flow', 'EO acknowledges and accepts (no inspection required for the category)', await act(eo, B, { action: 'record', actionType: 'ACCEPT', description: 'Accepted for work' }), 200);
expect('flow', 'EO assigns field.ravi', await act(eo, B, { action: 'assign', assigneeId: RAVI }), 200);
expect('lower', 'field staff 250 m away → refused (must be within 200 m)', await record(ravi, B, 'Choke replaced', OUT_250, LIVE), 400, 'complete.tooFar');
expect('lower', 'field staff 5 km away → refused', await record(ravi, B, 'Choke replaced', FAR, LIVE), 400, 'complete.tooFar');
expect('lower', 'on a phone, a gallery photo → refused (live camera photo only)', await act(ravi, B, { action: 'record', actionType: 'WORK_COMPLETED', description: 'Choke replaced', ...NEAR }, { photos: GALLERY, ua: UA.MOBILE }), 400, 'complete.liveOnly');
expect('lower', 'on a phone, a photo without capture details → refused', await act(ravi, B, { action: 'record', actionType: 'WORK_COMPLETED', description: 'Choke replaced', ...NEAR }, { photos: LIVE, ua: UA.MOBILE, meta: false }), 400, 'complete.liveOnly');
expect('lower', 'on a phone, a camera photo older than 15 min → refused', await act(ravi, B, { action: 'record', actionType: 'WORK_COMPLETED', description: 'Choke replaced', ...NEAR }, { photos: [{ source: 'CAMERA', ageMs: 40 * 60_000 }], ua: UA.MOBILE }), 400, 'complete.liveOnly');
ok('lower', 'nothing was saved by the refused attempts (still assigned)', (await statusOf(B)) === 'ASSIGNED', await statusOf(B));
expect('lower', 'on a phone, live camera photo within 200 m → accepted', await act(ravi, B, { action: 'record', actionType: 'WORK_COMPLETED', description: 'Choke replaced, no flicker', ...NEAR }, { photos: LIVE, ua: UA.MOBILE }), 200);
ok('lower', '→ Verification pending', (await statusOf(B)) === 'VERIFICATION_PENDING', await statusOf(B));
const eoB = (await eo.req(`/office/complaints/${B}`)).text;
ok('review', 'review panel: ~111 m, mobile phone, live camera photo', /\b11\d m\b/.test(eoB) && eoB.includes('Mobile phone') && eoB.includes('Live camera photo'), 'checked');
const supB = (await sup.req(`/office/complaints/${B}`)).text;
ok('review', 'supervisor sees REWORK but not APPROVE & CLOSE', supB.includes('REJECT / REWORK') || supB.includes('REWORK') ? !supB.includes('APPROVE &amp; CLOSE') : false, 'checked');
expect('approve', 'supervisor cannot give the final approval', await act(sup, B, { action: 'verify_completion', decision: 'approve', notes: 'Looks good' }), 403);
expect('approve', 'supervisor cannot close as no issue / cannot verify', await act(sup, B, { action: 'verify_completion', decision: 'cannot_verify', method: 'EVIDENCE', notes: 'Cannot tell from the photo' }), 403);
expect('rework', 'supervisor sends it back for rework', await act(sup, B, { action: 'verify_completion', decision: 'send_back', notes: 'Photo is blurred, retake' }), 200);
ok('rework', '→ Rework required', (await statusOf(B)) === 'REWORK_REQUIRED', await statusOf(B));
expect('lower', 'PC / laptop: field staff may upload a gallery photo (still within 200 m)', await act(ravi, B, { action: 'record', actionType: 'WORK_COMPLETED', description: 'Retook the photo in daylight', ...NEAR }, { photos: GALLERY, ua: UA.DESKTOP }), 200);
expect('approve', 'EO approves → closed', await act(eo, B, { action: 'verify_completion', decision: 'approve', notes: 'Approved' }), 200);
ok('approve', '→ Closed', (await statusOf(B)) === 'CLOSED', await statusOf(B));

// ============================================================ 3. EO marks completed → an Admin above the EO approves
const C = await file('Drain overflowing near the market', 'DRAINAGE'); codes.push(C);
expect('eo', 'EO marks it completed (photo + GPS, any distance)', await record(eo, C, 'Drain cleared by the sanitation team', FAR, GALLERY), 200);
expect('eo', 'EO cannot approve their own completion', await act(eo, C, { action: 'verify_completion', decision: 'approve', notes: 'Done' }), 403);
ok('notify', 'Admins above the EO are told (EO completed it)', (await notifs(sa)).some((n) => n.code === C && n.title_en === 'Work completed — verify'), 'checked');
expect('rework', 'Admin sends it back for rework', await act(sa, C, { action: 'verify_completion', decision: 'send_back', notes: 'Please add a photo of the cleared drain' }), 200);
ok('notify', 'EO (the completer) is told about the rework', (await notifs(eo)).some((n) => n.code === C && n.title_en === 'Rework required'), 'checked');
expect('eo', 'EO marks it completed again', await record(eo, C, 'Drain cleared, photo of the clean drain attached', NEAR, LIVE), 200);
const saC = (await sa.req(`/admin/complaints/${C}`)).text;
ok('review', 'Admin sees APPROVE & CLOSE in the admin portal', saC.includes('APPROVE &amp; CLOSE') || saC.includes('APPROVE & CLOSE'), 'checked');
expect('approve', 'Super Admin gives the final approval → closed', await act(sa, C, { action: 'verify_completion', decision: 'approve', notes: 'Approved by admin' }), 200);
ok('approve', '→ Closed', (await statusOf(C)) === 'CLOSED', await statusOf(C));
const citC = (await cit.req(`/complaints/${C}`)).text;
ok('citizen', 'citizen timeline shows the closure', /Resolved \/ closed|Closed/.test(citC), 'checked');

// ============================================================ 4. Browser: forms on desktop (supervisor) and phone (field staff)
const browser = await chromium.launch({ executablePath: opt.chromium ?? '/opt/pw-browsers/chromium' });
const jsErrors = [];
async function session(id, phone) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone,
    userAgent: phone ? UA.MOBILE : UA.DESKTOP, geolocation: { latitude: NEAR.latitude, longitude: NEAR.longitude }, permissions: ['geolocation'] });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { portal: 'OFFICE', identifier: id, password: creds[id] } });
  if (r.status() !== 200) throw new Error(`login ${id} ${r.status()}`);
  await ctx.addCookies([{ name: 'nu_lang', value: 'en', url: BASE }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 160)));
  return { ctx, page };
}
const D = await file('Street light pole leaning near the park'); codes.push(D);
const s1 = await session('sup.electrical', false);
await s1.page.goto(`${BASE}/office/complaints/${D}`, { waitUntil: 'networkidle' });
const ta = s1.page.getByRole('button', { name: /TAKE ACTION/ });
if ((await ta.getAttribute('aria-expanded')) !== 'true') await ta.click();
const ra = s1.page.getByTestId('record-action');
await ra.locator('select[name=actionType]').selectOption('WORK_COMPLETED');
const pol = await ra.getByTestId('completion-policy').innerText();
ok('ui-desktop', 'policy shown: photo + GPS, EO gives final approval (no distance limit for supervisor)', pol.includes('GPS location are required') && !pol.includes('200 m') && pol.includes('final approval'), pol.replace(/\n/g, ' | '));
ok('ui-desktop', 'gallery / file upload offered on PC', await ra.getByRole('button', { name: /Choose from gallery/ }).isVisible(), 'checked');
await ra.locator('textarea[name=description]').fill('Pole straightened and lamp re-fixed');
await ra.getByTestId('record-gallery').setInputFiles({ name: 'after.jpg', mimeType: 'image/jpeg', buffer: JPG });
await s1.page.waitForTimeout(1500);
ok('ui-desktop', 'GPS captured with the photo and distance shown', /from the complaint location/.test(await ra.innerText()), (await ra.getByTestId('completion-distance').innerText().catch(() => '—')));
await ra.getByRole('button', { name: /Save/ }).click();
await s1.page.waitForTimeout(2500);
ok('ui-desktop', 'saved → Verification pending', (await statusOf(D)) === 'VERIFICATION_PENDING', await statusOf(D));
if (opt.shots) await s1.page.screenshot({ path: `${opt.shots}/completion-desktop.png`, fullPage: true });

const E = await file('Street light not working on the main road'); codes.push(E);
expect('flow', 'EO accepts and assigns field.ravi', await act(eo, E, { action: 'record', actionType: 'ACCEPT', description: 'Accepted' }).then(() => act(eo, E, { action: 'assign', assigneeId: RAVI })), 200);
const s2 = await session('field.ravi', true);
await s2.page.goto(`${BASE}/office/complaints/${E}`, { waitUntil: 'networkidle' });
const ta2 = s2.page.getByRole('button', { name: /TAKE ACTION/ });
if ((await ta2.getAttribute('aria-expanded')) !== 'true') await ta2.click();
const ra2 = s2.page.getByTestId('record-action');
await ra2.locator('select[name=actionType]').selectOption('WORK_COMPLETED');
const pol2 = await ra2.getByTestId('completion-policy').innerText();
ok('ui-phone', 'policy shown: within 200 m + live camera photo only', pol2.includes('200 m') && pol2.includes('Live camera photo only'), pol2.replace(/\n/g, ' | '));
ok('ui-phone', 'no gallery option on the phone (camera only)', (await ra2.getByRole('button', { name: /Choose from gallery/ }).count()) === 0 && (await ra2.getByTestId('record-gallery').count()) === 0, 'checked');
ok('ui-phone', 'camera input opens the rear camera (capture=environment)', (await ra2.getByTestId('record-photo').getAttribute('capture')) === 'environment', 'checked');
await ra2.locator('textarea[name=description]').fill('Lamp replaced, working now');
await ra2.getByTestId('record-photo').setInputFiles({ name: 'live.jpg', mimeType: 'image/jpeg', buffer: JPG });
await s2.page.waitForTimeout(1500);
ok('ui-phone', 'distance to the complaint shown (~111 m)', /11\d m from the complaint location/.test(await ra2.innerText()), await ra2.getByTestId('completion-distance').innerText().catch(() => '—'));
await ra2.getByRole('button', { name: /Save/ }).click();
await s2.page.waitForTimeout(2500);
ok('ui-phone', 'live photo within 200 m saved → Verification pending', (await statusOf(E)) === 'VERIFICATION_PENDING', await statusOf(E));
ok('ui-phone', 'no horizontal scroll at 390 px', (await s2.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'checked');
if (opt.shots) await s2.page.screenshot({ path: `${opt.shots}/completion-phone.png`, fullPage: true });
ok('ui', 'no JavaScript errors on the pages', jsErrors.length === 0, jsErrors.join(' | ') || 'none');
await browser.close();

// ============================================================ cleanup: test complaints closed, citizen deactivated
for (const code of [D, E]) await act(eo, code, { action: 'verify_completion', decision: 'approve', notes: `Approved (${TAG})` });
ok('cleanup', 'all TEST complaints closed', (await Promise.all(codes.map(statusOf))).every((s) => s === 'CLOSED'), (await Promise.all(codes.map(statusOf))).join(','));
const citId = findDeep((await sa.req(`/api/admin/citizens?portal=ADMIN&q=${encodeURIComponent(TAG)}`)).json, (o) => typeof o.full_name === 'string' && o.full_name.includes(TAG))?.id;
const deact = citId ? await sa.req(`/api/admin/citizens/${citId}?portal=ADMIN`, { method: 'PATCH', body: { status: 'INACTIVE', reason: `${TAG} automated test cleanup` } }) : { status: 'not found' };
ok('cleanup', 'TEST citizen deactivated', deact.status === 200, deact.status);

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed · tag ${TAG} · complaints ${codes.join(', ')}`);
if (opt.shots) writeFileSync(`${opt.shots}/completion-${TAG}.json`, JSON.stringify(results, null, 2));
if (passed !== results.length) process.exitCode = 1;
