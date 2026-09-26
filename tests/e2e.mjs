// End-to-end workflow + security test against a running server: node tests/e2e.mjs [baseUrl] [credentials.json]
import { readFileSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
const IMG = process.env.IMG_DIR ?? '.';
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };

class Client {
  cookies = {};
  async req(path, { method, body, form } = {}) {
    const headers = { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method: method ?? (body || form ? 'POST' : 'GET'), headers, body: form ?? (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); this.cookies[k] = v.join('='); }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, location: res.headers.get('location') };
  }
}
const photo = (name) => new Blob([readFileSync(`${IMG}/${name}.jpg`)], { type: 'image/jpeg' });
const staff = async (portal, username) => { const c = new Client(); const r = await c.req('/api/auth/login', { body: { portal, identifier: username, password: creds[username] } }); ok(r.status === 200, `login ${username} (${portal})`); return c; };
const act = (c, code, data, file) => {
  if (!file) return c.req(`/api/office/complaints/${code}/action`, { body: data });
  const fd = new FormData(); fd.set('data', JSON.stringify(data)); fd.set('photo', photo(file), `${file}.jpg`);
  return c.req(`/api/office/complaints/${code}/action`, { form: fd });
};
const GPS = { latitude: 11.1650, longitude: 77.6040, accuracy: 12 };

// ---------- citizen registration ----------
const citizen = new Client();
const mobile = `9${String(Date.now()).slice(-9)}`;
const lbs = await citizen.req('/api/locations/pincode/638051');
ok(lbs.status === 200 && lbs.json.places.length >= 3, `pincode 638051 → ${lbs.json?.places.length} places (${lbs.json?.places.map((p) => p.place_name).join(', ')})`);
const lb = lbs.json.localBodies.find((l) => l.name_en === 'Chennimalai');
ok(lb?.mapped === true, 'Chennimalai TP suggested as mapped local body for 638051');
const wards = await citizen.req(`/api/locations?type=wards&parent=${lb.id}`);
const w10 = wards.json.items.find((w) => w.ward_number === 10);
const streets = await citizen.req(`/api/locations?type=streets&parent=${w10.id}`);
const st = streets.json.items.find((s) => s.name_en === 'Kothangadu 2nd Street');
const reg = await citizen.req('/api/auth/register', { body: {
  fullName: 'Navin Test', dob: '1990-05-01', mobile, email: '', pincode: '638051', postalLocationId: lbs.json.places.find((p) => p.place_name === 'Chennimalai').id,
  districtId: lb.district_id, localBodyId: lb.id, wardId: w10.id, streetId: st.id, address: '12A', landmark: 'Near temple', password: 'Test1234', consent: true, lang: 'ta' } });
ok(reg.status === 200, `citizen registered (${reg.status} ${reg.json?.message ?? ''})`);
ok((await citizen.req('/api/auth/register', { body: { fullName: 'Another Person', dob: '1990-01-01', mobile, pincode: '638051', districtId: lb.district_id, address: 'x', password: 'Test1234', consent: true } })).status === 409, 'duplicate mobile rejected');

// ---------- AI understanding ----------
const text = 'Vanakkam, naan Navin. Chennimalai 10th ward Kothangadu 2nd street la irukken. Enga street light romba naala eriyala. Night time la romba dark ah irukku. Rendu per keela vizhundhirukanga.';
const an = await citizen.req('/api/nlp/analyze', { body: { text } });
ok(an.json?.analysis?.category === 'STREET_LIGHT' && an.json.analysis.location.streetId === st.id && an.json.analysis.location.wardId === w10.id, `AI: ${an.json?.analysis?.confirm_en}`);
ok(an.json?.department?.name_en?.includes('Street Lighting'), `routed department suggestion: ${an.json?.department?.name_en}`);

// Evidence required
const mk = (extra = {}, files = ['before']) => {
  const fd = new FormData();
  fd.set('payload', JSON.stringify({ text, inputMode: 'VOICE', categoryCode: 'STREET_LIGHT', localBodyId: lb.id, wardId: w10.id, streetId: st.id, streetText: null, landmark: null, ...GPS, gpsAt: new Date().toISOString(), duplicateOverride: false, ...extra }));
  fd.set('evidenceMeta', JSON.stringify(files.map(() => ({ ...GPS, capturedAt: new Date().toISOString(), source: 'CAMERA', imageHash: 'ffff0000ffff0000' }))));
  files.forEach((f) => fd.append('evidence', photo(f), `${f}.jpg`));
  return fd;
};
ok((await citizen.req('/api/complaints', { form: mk({}, []) })).status === 400, 'street-light complaint without photo is rejected (evidence mandatory)');
const bad = new FormData(); bad.set('payload', mk().get('payload')); bad.set('evidenceMeta', '[]'); bad.append('evidence', new Blob(['<html><script>alert(1)</script>xxxxxxxxxxxxxx'], { type: 'image/jpeg' }), 'x.jpg');
ok((await citizen.req('/api/complaints', { form: bad })).status === 400, 'fake image (HTML payload) rejected by magic-byte validation');
const created = await citizen.req('/api/complaints', { form: mk() });
ok(created.status === 200, `complaint created ${created.json?.code ?? created.text.slice(0, 200)}`);
const code = created.json.code;

// Duplicate detection for a second similar report
const dup = await citizen.req('/api/complaints/duplicates', { body: { categoryCode: 'STREET_LIGHT', localBodyId: lb.id, wardId: w10.id, streetId: st.id, latitude: GPS.latitude, longitude: GPS.longitude, text: 'street light not working kothangadu', imageHash: 'ffff0000ffff0001' } });
ok(dup.json?.candidates?.[0]?.code === code, `duplicate detection finds ${code} (score ${dup.json?.candidates?.[0]?.score}, ${dup.json?.candidates?.[0]?.reasons})`);

// ---------- security: citizen cannot reach office/admin ----------
ok((await citizen.req(`/api/office/complaints/${code}/action`, { body: { action: 'review' } })).status === 401, 'citizen session → office action API: 401');
ok((await citizen.req('/api/admin/users')).status === 401, 'citizen session → admin users API: 401');
ok((await citizen.req('/office')).status === 307, 'citizen visiting /office is redirected to officer login');
ok((await citizen.req('/api/auth/login', { body: { portal: 'OFFICE', identifier: mobile, password: 'Test1234' } })).status === 401, 'citizen credentials cannot log into office portal');

// ---------- workflow ----------
const sup = await staff('OFFICE', 'sup.electrical');
const eo = await staff('OFFICE', 'eo.chennimalai');
const ravi = await staff('OFFICE', 'field.ravi');
const eo2 = await staff('OFFICE', 'eo.perundurai');
const muthu = await staff('OFFICE', 'field.muthu');
ok((await eo2.req(`/office/complaints/${code}`)).status === 404, 'EO of another local body cannot open this complaint (404)');
ok((await eo2.req(`/api/office/complaints/${code}/action`, { body: { action: 'review' } })).status === 404, 'EO of another local body cannot act on it');
ok((await muthu.req(`/api/office/complaints/${code}/action`, { body: { action: 'review' } })).status === 404, 'unrelated field staff cannot see complaint');
ok((await ravi.req(`/api/office/complaints/${code}/action`, { body: { action: 'review' } })).status === 404, 'field staff not yet assigned cannot see it');

let r = await act(sup, code, { action: 'assign', assigneeId: '00000000-0000-0000-0000-000000000000' });
ok(r.status === 409, 'cannot assign before verification (state machine)');
r = await act(sup, code, { action: 'review', note: 'Looks genuine' }); ok(r.status === 200, 'supervisor: initial review');
const staffList = await sup.req('/api/office/users');
const raviId = staffList.json.items.find((x) => x.username === 'field.ravi').id;
r = await act(sup, code, { action: 'schedule_inspection', inspectorId: raviId, note: 'Please check pole' }); ok(r.status === 200, `schedule inspection → ravi (${r.json?.message ?? ''})`);
r = await act(ravi, code, { action: 'inspect', outcome: 'VERIFIED', notes: 'Bulb fused' }); ok(r.status === 400, 'inspection without photo/GPS rejected');
r = await act(ravi, code, { action: 'inspect', outcome: 'VERIFIED', notes: 'Bulb fused, pole OK', ...GPS }, 'insp'); ok(r.status === 200, `field staff inspection recorded (${r.json?.message ?? ''})`);
r = await act(ravi, code, { action: 'assign', assigneeId: raviId }); ok(r.status === 403, 'field staff cannot assign (403)');
r = await act(sup, code, { action: 'assign', assigneeId: raviId, priority: 'HIGH', note: 'Replace bulb' }); ok(r.status === 200, `supervisor assigns work (${r.json?.message ?? ''})`);
r = await act(muthu, code, { action: 'start' }); ok(r.status === 404, 'other field staff cannot start the work');
r = await act(ravi, code, { action: 'accept' }); ok(r.status === 200, 'field staff accepts');
r = await act(ravi, code, { action: 'start', ...GPS }); ok(r.status === 200, 'field staff starts work');
r = await act(ravi, code, { action: 'progress', notes: 'New LED fitted', progress: 70, ...GPS }); ok(r.status === 200, 'progress update');
r = await act(ravi, code, { action: 'complete', notes: 'Done' }); ok(r.status === 400, 'completion without photo rejected');
r = await act(ravi, code, { action: 'complete', notes: 'LED installed and tested', ...GPS }, 'after'); ok(r.status === 200, `completion with photo+GPS (${r.json?.message ?? ''})`);
r = await act(ravi, code, { action: 'verify_completion', decision: 'approve' }); ok(r.status === 403, 'field staff cannot verify own work');
r = await act(eo, code, { action: 'verify_completion', decision: 'approve', close: true, notes: 'Checked on site' }); ok(r.status === 200, `EO verifies & closes (${r.json?.message ?? ''})`);

const page = await citizen.req(`/complaints/${code}`);
ok(page.status === 200 && page.text.includes(code), 'citizen tracking page renders');
const notifs = await citizen.req('/api/notifications?portal=PUBLIC');
ok(notifs.json.items.length >= 6, `citizen received ${notifs.json.items.length} notifications`);
const ev = await citizen.req(`/complaints/${code}`);
const evIds = [...ev.text.matchAll(/\/api\/evidence\/(\d+)/g)].map((m) => m[1]);
ok(evIds.length >= 2, `before/after evidence shown (${evIds.length} media)`);
ok((await citizen.req(`/api/evidence/${evIds[0]}`)).status === 200, 'citizen can view own evidence');
const stranger = new Client();
ok((await stranger.req(`/api/evidence/${evIds[0]}`)).status === 401, 'anonymous cannot view evidence');
ok((await eo2.req(`/api/evidence/${evIds[0]}`)).status === 403, 'other-jurisdiction EO cannot view evidence');

// ---------- rejection + appeal ----------
const c2 = await citizen.req('/api/complaints', { form: mk({ duplicateOverride: true, possibleDuplicateOf: null }) });
const code2 = c2.json.code;
r = await act(sup, code2, { action: 'reject', reason: 'INVALID' }); ok(r.status === 400, 'rejection without notes refused');
r = await act(sup, code2, { action: 'reject', reason: 'NOT_FOUND', notes: 'Light working during night check' }); ok(r.status === 200, 'rejected with reason');
const p2 = await citizen.req(`/complaints/${code2}`);
ok(p2.text.includes('Light working during night check'), 'citizen sees rejection reason & notes');
const afd = new FormData(); afd.set('reason', 'Still not working, checked again tonight'); afd.set('inputMode', 'TEXT');
r = await citizen.req(`/api/complaints/${code2}/appeal`, { form: afd }); ok(r.status === 200, 'citizen requests reconsideration');
r = await citizen.req(`/api/complaints/${code2}/appeal`, { form: afd }); ok(r.status === 409, 'second pending appeal refused');
const det = await eo.req(`/office/complaints/${code2}`);
ok(det.status === 200, 'EO opens appealed complaint');
const appealId = (await eo.req('/office/appeals')).status === 200;
ok(appealId, 'EO appeals page');

// ---------- user management guards ----------
r = await eo.req('/api/office/users', { body: { username: 'evil.admin', fullName: 'Evil', mobile: '9111111111', email: 'e@x.in', role: 'SUPER_ADMIN' } });
ok(r.status === 403 || r.status === 400, `EO cannot create Super Admin (${r.status})`);
r = await eo.req('/api/office/users', { body: { username: `fs.${Date.now() % 100000}`, fullName: 'New Worker', mobile: '9222222222', email: 'w@x.in', role: 'FIELD_STAFF' } });
ok(r.status === 400, 'field staff without dept/supervisor/ward rejected');
const allUsers = await (await staff('ADMIN', 'superadmin')).req('/api/admin/users');
const saId = allUsers.json.items.find((x) => x.username === 'superadmin').id;
r = await eo.req(`/api/office/users/${saId}`, { method: 'PATCH', body: { status: 'INACTIVE' } }); ok(r.status === 404 || r.status === 403, `EO cannot deactivate Super Admin (${r.status})`);
ok(!(await eo.req('/api/office/users')).json.items.some((x) => x.role === 'SUPER_ADMIN'), 'EO user list never shows Super Admin');
ok((await eo.req('/api/admin/users')).status === 401, 'EO office session cannot call admin API');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
