// Security regression suite for the four fixes of the security phase:
//   1. ward-map stored XSS (server validation)      2. cross-citizen complaint / evidence access (IDOR)
//   3. logout invalidates the session server-side   4. evidence upload + delivery hardening
// Creates controlled test records tagged SEC-<ts> (two citizens, their complaints, map features that are archived).
//
//   node tests/security-e2e.mjs <baseUrl> <credentials.json>
//
// credentials.json maps usernames to passwords for eo.chennimalai, eo.perundurai, superadmin (never commit it).
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
const TS = String(Date.now()).slice(-6);
const TAG = `SEC-${TS}`;
const results = [];
const ok = (area, test, pass, actual) => { results.push({ area, test, pass: !!pass, actual: String(actual) }); console.log(`${pass ? '✔' : '✘'} [${area}] ${test} — ${actual}`); };

// Tiny valid images (16x12)
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCtRRRXzh9ef//Z', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGPUqDjBQApgIkn1qIYRpAEAVXkBgP+C6V0AAAAASUVORK5CYII=', 'base64');

class Client {
  cookies = {};
  async req(path, { method, body, form, headers: extra = {} } = {}) {
    const headers = { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method: method ?? (body || form ? 'POST' : 'GET'), headers, body: form ?? (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';'); const [k, ...v] = kv.split('=');
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c)) delete this.cookies[k]; else this.cookies[k] = v.join('=');
    }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text, headers: res.headers, location: res.headers.get('location') };
  }
}
const staff = async (portal, username) => { const c = new Client(); c.cookies.nu_lang = 'en'; const r = await c.req('/api/auth/login', { body: { portal, identifier: username, password: creds[username] } }); if (r.status !== 200) throw new Error(`login ${username}: ${r.status}`); return c; };

// ---------------------------------------------------------------- setup: two citizens in Chennimalai
const pub = new Client();
const pin = (await pub.req('/api/locations/pincode/638051')).json;
const lb = pin.localBodies.find((l) => l.name_en === 'Chennimalai');
const wards = (await pub.req(`/api/locations?type=wards&parent=${lb.id}`)).json.items;
const w10 = wards.find((w) => w.ward_number === 10) ?? wards[0];
const w5 = wards.find((w) => w.ward_number === 5) ?? wards[1];
const streets = (await pub.req(`/api/locations?type=streets&parent=${w10.id}`)).json.items;
const GPS = { latitude: 11.1650, longitude: 77.6040, accuracy: 12 };

async function citizen(label, ward, suffix) {
  const c = new Client(); c.cookies.nu_lang = 'en';
  const mobile = `8${suffix}${TS}`.slice(0, 10).padEnd(10, '3');
  const password = `Sec${TS}${suffix}x`;
  const r = await c.req('/api/auth/register', { body: { fullName: `${TAG} Citizen ${label}`, dob: '1990-05-01', mobile, pincode: '638051', districtId: lb.district_id, localBodyId: lb.id, wardId: ward.id, address: `${label} Test Street`, password, consent: true } });
  if (r.status !== 200) throw new Error(`register ${label}: ${r.status} ${r.text.slice(0, 120)}`);
  return { c, mobile, password };
}
const complaintForm = (text, ward, streetId, files) => {
  const fd = new FormData();
  fd.set('payload', JSON.stringify({ text, inputMode: 'TEXT', categoryCode: 'STREET_LIGHT', localBodyId: lb.id, wardId: ward.id, streetId, streetText: streetId ? null : `${TAG} road`, landmark: `${TAG} private landmark`, ...GPS, gpsAt: new Date().toISOString(), duplicateOverride: true }));
  fd.set('evidenceMeta', JSON.stringify(files.map(() => ({ ...GPS, capturedAt: new Date().toISOString(), source: 'CAMERA' }))));
  for (const f of files) fd.append('evidence', new Blob([f.data], { type: f.type }), f.name);
  return fd;
};
const A = await citizen('A', w10, '1');
const B = await citizen('B', w5, '2');
const secretA = `${TAG} my name is Alpha, call me on ${A.mobile}`;
const secretB = `${TAG} my name is Bravo, the street light near my house is broken`;
const cA = await A.c.req('/api/complaints', { form: complaintForm(`Street light not working. ${secretA}`, w10, streets[0]?.id ?? null, [{ data: JPG, type: 'image/jpeg', name: 'a.jpg' }]) });
const cB = await B.c.req('/api/complaints', { form: complaintForm(`Street light not working. ${secretB}`, w5, null, [{ data: PNG, type: 'image/png', name: 'b.png' }]) });
const codeA = cA.json?.code; const codeB = cB.json?.code;
ok('setup', 'citizens A and B each file a complaint with a photo (JPG / PNG)', codeA && codeB, `${cA.status} ${codeA} / ${cB.status} ${codeB}`);
const evid = async (c, code) => [...new Set(((await c.req(`/complaints/${code}`)).text.match(/\/api\/evidence\/\d+/g) ?? []))];
const evA = (await evid(A.c, codeA))[0]; const evB = (await evid(B.c, codeB))[0];
ok('setup', 'owners see their own complaint page and photo', evA && evB, `${evA} ${evB}`);

// ---------------------------------------------------------------- 2. IDOR in both directions
for (const [me, other, otherCode, otherEv, otherSecret, name] of [[A, B, codeB, evB, secretB, 'A→B'], [B, A, codeA, evA, secretA, 'B→A']]) {
  const page = await me.c.req(`/complaints/${otherCode}`);
  ok('IDOR', `${name}: complaint page (timeline, details) denied`, page.status === 404 && !page.text.includes(otherSecret), `${page.status}`);
  const track = await me.c.req(`/track?code=${otherCode}`);
  ok('IDOR', `${name}: /track does not open the other complaint`, !(track.location ?? '').includes(otherCode) && !track.text.includes(otherSecret), `${track.status} ${track.location ?? ''}`);
  const photo = await me.c.req(otherEv);
  ok('IDOR', `${name}: photo / evidence denied`, photo.status === 403, photo.status);
  const sup0 = await me.c.req(`/api/complaints/${otherCode}/support`, { body: {} });
  ok('IDOR', `${name}: support without an offer token denied`, sup0.status === 403, sup0.status);
  const sup1 = await me.c.req(`/api/complaints/${otherCode}/support`, { body: { token: `${Math.floor(Date.now() / 1000) + 3600}.forgedsignature` } });
  ok('IDOR', `${name}: support with a forged token denied`, sup1.status === 403, sup1.status);
  const ap = new FormData(); ap.set('reason', 'Please reopen this complaint'); ap.set('inputMode', 'TEXT');
  const appeal = await me.c.req(`/api/complaints/${otherCode}/appeal`, { form: ap });
  ok('IDOR', `${name}: appeal / reconsideration denied`, [403, 404].includes(appeal.status), appeal.status);
  const act = await me.c.req(`/api/office/complaints/${otherCode}/action`, { body: { action: 'reopen', note: 'x' } });
  ok('IDOR', `${name}: officer action (reopen / close) API denied`, [401, 403].includes(act.status), act.status);
  const actions = await me.c.req(`/api/complaints/${otherCode}/actions`);
  ok('IDOR', `${name}: work-actions API denied`, [401, 403].includes(actions.status), actions.status);
  const office = await me.c.req(`/office/complaints/${otherCode}`);
  ok('IDOR', `${name}: officer complaint page with citizen cookie redirected to login`, office.status === 307 && (office.location ?? '').includes('/office/login'), `${office.status} ${office.location ?? ''}`);
  const list = await me.c.req('/complaints');
  ok('IDOR', `${name}: other complaint not in "My complaints"`, !list.text.includes(otherCode), 'checked');
  const anon = await new Client().req(otherEv);
  ok('IDOR', `${name.slice(-1)}'s photo without login → 401`, anon.status === 401, anon.status);
}
// A token issued to A for complaint B cannot be used by anyone else, or for another complaint
const dups = await A.c.req('/api/complaints/duplicates', { body: { categoryCode: 'STREET_LIGHT', localBodyId: lb.id, wardId: w5.id, streetId: null, latitude: GPS.latitude, longitude: GPS.longitude, text: 'street light not working', imageHash: null } });
const offer = (dups.json?.candidates ?? []).find((x) => x.code === codeB);
ok('IDOR', 'duplicate check offers B to A with a support token (no reporter details in the offer)', offer?.supportToken && !JSON.stringify(offer).includes('Bravo') && !JSON.stringify(offer).includes(B.mobile), offer ? Object.keys(offer).join(',') : `not offered (${dups.status})`);
if (offer) {
  const C = await citizen('C', w10, '3');
  const stolen = await C.c.req(`/api/complaints/${codeB}/support`, { body: { token: offer.supportToken } });
  ok('IDOR', "A's support token used by another citizen denied", stolen.status === 403, stolen.status);
  const wrong = await A.c.req(`/api/complaints/${codeA}/support`, { body: { token: offer.supportToken } });
  ok('IDOR', "token for B does not apply to another complaint (own complaint is a no-op)", wrong.status === 200 && (await A.c.req(`/complaints/${codeA}`)).status === 200, wrong.status);
  const good = await A.c.req(`/api/complaints/${codeB}/support`, { body: { token: offer.supportToken } });
  ok('IDOR', 'A joins B via the offered token (legitimate "same problem" flow)', good.status === 200, good.status);
  const pubView = await A.c.req(`/complaints/${codeB}`);
  const leaks = ['Bravo', secretB, B.mobile, `${TAG} private landmark`, '/api/evidence/', 'Assigned officer', 'Original complaint'].filter((s) => pubView.text.includes(s));
  ok('IDOR', 'supporter sees PUBLIC summary only (no reporter words, name, mobile, landmark, photos, officer)', pubView.status === 200 && pubView.text.includes(codeB) && leaks.length === 0, `${pubView.status}; leaks: ${leaks.join(', ') || 'none'}`);
  const photo = await A.c.req(evB);
  ok('IDOR', 'supporter still cannot fetch the reporter\'s photo', photo.status === 403, photo.status);
}

// ---------------------------------------------------------------- 1. ward-map XSS (server side)
const eo = await staff('OFFICE', 'eo.chennimalai');
const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', 'javascript:alert(1)', 'Road onmouseover=alert(1)', 'x\u0000y'];
const created = [];
for (const p of payloads) {
  const r = await eo.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'OTHER', geometryType: 'Point', geometry: { type: 'Point', coordinates: [77.604, 11.165] }, name: p } });
  if (r.json?.id) created.push(r.json.id);
  ok('XSS', `map feature name rejected: ${JSON.stringify(p)}`, r.status === 400, r.status);
}
const desc = await eo.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'OTHER', geometryType: 'Point', geometry: { type: 'Point', coordinates: [77.604, 11.165] }, name: `${TAG} ok`, description: '<img src=x onerror=alert(1)>' } });
if (desc.json?.id) created.push(desc.json.id);
ok('XSS', 'map feature description with HTML rejected', desc.status === 400, desc.status);
for (const name of [`${TAG} Pole 12 near temple`, `${TAG} தெரு விளக்கு கம்பம் #4 (Kothangadu) & drain`]) {
  const r = await eo.req('/api/ward-maps?portal=OFFICE', { body: { wardId: w10.id, featureType: 'STREETLIGHT', geometryType: 'Point', geometry: { type: 'Point', coordinates: [77.6041, 11.1651] }, name } });
  if (r.json?.id) created.push(r.json.id);
  ok('XSS', `legitimate name accepted: ${name}`, r.status === 200, r.status);
}
if (created[created.length - 1]) {
  const r = await eo.req(`/api/ward-maps/${created[created.length - 1]}?portal=OFFICE`, { method: 'PATCH', body: { name: '<script>alert(1)</script>' } });
  ok('XSS', 'renaming a feature to HTML rejected', r.status === 400, r.status);
}
for (const id of created) await eo.req(`/api/ward-maps/${id}?portal=OFFICE`, { method: 'PATCH', body: { status: 'INACTIVE', reason: `${TAG} cleanup` } });

// ---------------------------------------------------------------- 3. logout invalidates the session
async function logoutCheck(label, portal, loginAs, page, api) {
  const c = loginAs.c ?? new Client();
  if (!loginAs.c) { const r = await c.req('/api/auth/login', { body: { portal, identifier: loginAs.id, password: loginAs.pw } }); if (r.status !== 200) throw new Error(`login ${label}`); }
  const before = [(await c.req(page)).status, (await c.req(api)).status];
  const saved = { ...c.cookies };
  const out = await c.req('/api/auth/logout', { body: { portal } });
  const replay = new Client(); replay.cookies = saved;
  const p = await replay.req(page); const a = await replay.req(api);
  const again = await replay.req(page);
  ok('Session', `${label}: before logout page/API ${before.join('/')}; logout ${out.status}; replayed old cookie → page ${p.status} ${p.location ?? ''}, API ${a.status}, refresh ${again.status}`,
    before[0] === 200 && before[1] === 200 && out.status === 200 && p.status === 307 && [401, 403].includes(a.status) && again.status === 307, 'checked');
  const fresh = new Client(); const l = await fresh.req('/api/auth/login', { body: { portal, identifier: loginAs.id ?? loginAs.mobile, password: loginAs.pw ?? loginAs.password } });
  ok('Session', `${label}: logging in again works`, l.status === 200 && (await fresh.req(page)).status === 200, l.status);
}
await logoutCheck('EO (office)', 'OFFICE', { id: 'eo.chennimalai', pw: creds['eo.chennimalai'] }, '/office/complaints', '/api/office/users');
await logoutCheck('Super Admin (admin)', 'ADMIN', { id: 'superadmin', pw: creds.superadmin }, '/admin/users', '/api/admin/users');
const cz = new Client(); await cz.req('/api/auth/login', { body: { portal: 'PUBLIC', identifier: A.mobile, password: A.password } });
await logoutCheck('Citizen A (public)', 'PUBLIC', { c: cz, id: A.mobile, pw: A.password }, '/complaints', '/api/notifications?portal=PUBLIC');

// ---------------------------------------------------------------- 4. evidence upload + delivery
const up = async (files, label, want) => {
  const r = await B.c.req('/api/complaints', { form: complaintForm(`Street light not working near ${TAG} (${label})`, w5, null, files) });
  ok('Evidence', `upload ${label} → ${want}`, r.status === want, `${r.status} ${r.json?.message ?? ''}`);
  return r;
};
await up([{ data: Buffer.from('<html><body><script>alert(1)</script></body></html>'), type: 'text/html', name: 'page.html' }], 'HTML file', 400);
await up([{ data: Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), type: 'image/svg+xml', name: 'x.svg' }], 'SVG', 400);
await up([{ data: Buffer.from('alert(document.cookie)'), type: 'application/javascript', name: 'x.js' }], 'JavaScript file', 400);
await up([{ data: JPG, type: 'image/jpeg', name: 'photo.html' }], 'real JPG with .html extension', 400);
await up([{ data: JPG, type: 'text/html', name: 'photo.jpg' }], 'real JPG declared as text/html', 400);
await up([{ data: Buffer.concat([JPG, Buffer.from('<script>alert(1)</script>')]), type: 'image/jpeg', name: 'poly.jpg' }], 'JPG with embedded <script> (polyglot)', 400);
await up([{ data: Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff'), type: 'application/x-msdownload', name: 'x.exe' }], 'Windows executable', 400);
const big = Buffer.alloc(Math.ceil(3.2 * 1024 * 1024)); JPG.copy(big);
await up([{ data: big, type: 'image/jpeg', name: 'big.jpg' }], '3.2 MB photo (over 3 MB limit)', 400);
const r = await A.c.req(evA);
ok('Evidence', 'owner can view JPG with safe headers', r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && r.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(r.headers.get('content-security-policy') ?? '') && /^inline; filename="evidence-\d+\.jpg"$/.test(r.headers.get('content-disposition') ?? '') && /no-store/.test(r.headers.get('cache-control') ?? ''),
  `${r.status} | ${r.headers.get('content-type')} | ${r.headers.get('content-disposition')} | ${r.headers.get('cache-control')} | csp: ${r.headers.get('content-security-policy')}`);
const rp = await B.c.req(evB);
ok('Evidence', 'owner can view PNG', rp.status === 200 && rp.headers.get('content-type') === 'image/png', `${rp.status} ${rp.headers.get('content-type')}`);
const eoView = await eo.req(evA);
ok('Evidence', 'EO of the same local body can view the photo', eoView.status === 200, eoView.status);
const eo2 = await staff('OFFICE', 'eo.perundurai');
const eo2View = await eo2.req(evA);
ok('Evidence', 'EO of another local body cannot view the photo', eo2View.status === 403, eo2View.status);
const traversal = await A.c.req('/api/evidence/..%2F..%2Fetc%2Fpasswd');
ok('Evidence', 'path traversal on evidence id → 404', traversal.status === 404, traversal.status);

const failed = results.filter((x) => !x.pass);
writeFileSync(`security-results-${TS}.json`, JSON.stringify({ base: BASE, tag: TAG, codes: [codeA, codeB], results }, null, 1));
console.log(`\nSECURITY SUMMARY ${results.length - failed.length}/${results.length} passed; tag ${TAG}; complaints ${codeA} ${codeB}`);
process.exit(failed.length ? 1 : 0);
