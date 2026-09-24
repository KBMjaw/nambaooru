// Renders every page per role and checks HTTP status: node tests/smoke-pages.mjs [baseUrl]
import { readFileSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://localhost:3000';
const creds = JSON.parse(readFileSync(process.argv[3] ?? 'scripts/.credentials.json', 'utf8'));
let fail = 0;
async function login(portal, id, pw) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal, identifier: id, password: pw }) });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
async function check(cookie, path, expect, label) {
  const r = await fetch(BASE + path, { headers: { cookie }, redirect: 'manual' });
  const good = Array.isArray(expect) ? expect.includes(r.status) : r.status === expect;
  const body = r.status === 200 ? await r.text() : '';
  const err = body.includes('Application error') || body.includes('__next_error__');
  console.log(`${good && !err ? '✔' : '✘'} [${label}] ${path} → ${r.status}${err ? ' (error page)' : ''}`);
  if (!good || err) fail++;
}
const code = process.env.CODE;
const sa = await login('ADMIN', 'superadmin', creds.superadmin);
for (const p of ['/admin', '/admin/complaints', '/admin/users', '/admin/roles', '/admin/locations', '/admin/locations?tab=wards', '/admin/postal', '/admin/postal?tab=sources', '/admin/postal?tab=postal_location_jurisdictions', '/admin/departments', '/admin/categories', '/admin/sla', '/admin/routing', '/admin/templates', '/admin/settings', '/admin/audit', '/admin/profile', ...(code ? [`/admin/complaints/${code}`] : [])]) await check(sa, p, 200, 'superadmin');
for (const p of ['/api/admin/master/districts?refs=1', '/api/admin/master/local_bodies?refs=1', '/api/admin/master/postal_locations?q=638051', '/api/admin/postal/export']) await check(sa, p, 200, 'superadmin api');
const sys = await login('ADMIN', 'sysadmin', creds.sysadmin);
await check(sys, '/admin/roles', 307, 'sysadmin (no role.manage)');
await check(sys, '/admin/locations', 200, 'sysadmin');
const eo = await login('OFFICE', 'eo.chennimalai', creds['eo.chennimalai']);
for (const p of ['/office', '/office/complaints', '/office/complaints?view=map', '/office/complaints?bucket=overdue', '/office/map', '/office/analytics', '/office/appeals', '/office/users', '/office/notifications', '/office/profile', ...(code ? [`/office/complaints/${code}`] : [])]) await check(eo, p, 200, 'EO');
await check(eo, '/admin', 307, 'EO→admin');
await check(eo, '/api/admin/master/districts', 401, 'EO→admin api');
const ward = await login('OFFICE', 'ward10.member', creds['ward10.member']);
for (const p of ['/office', '/office/complaints', '/office/map']) await check(ward, p, 200, 'ward member');
await check(ward, '/office/users', 307, 'ward member→users');
await check(ward, '/office/analytics', 307, 'ward member→analytics');
const fs = await login('OFFICE', 'field.ravi', creds['field.ravi']);
await check(fs, '/office', 200, 'field staff');
await check(fs, '/office/analytics', 307, 'field→analytics');
await check(fs, '/office/users', 307, 'field→users');
const sup = await login('OFFICE', 'sup.electrical', creds['sup.electrical']);
for (const p of ['/office', '/office/complaints', '/office/analytics', '/office/users']) await check(sup, p, 200, 'supervisor');
await check('', '/admin/users', 307, 'anon→admin');
await check('', '/api/cron/sla', 401, 'anon→cron');
console.log(fail ? `\n${fail} FAILED` : '\nALL PAGES OK');
process.exit(fail ? 1 : 0);
