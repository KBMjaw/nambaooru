import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAnalyticsPath } from '../src/lib/site-analytics-path.ts';

test('internal portals and APIs are never tracked', () => {
  for (const p of ['/admin', '/admin/', '/admin/users/42', '/office', '/office/complaints?q=x', '/api/complaints', '/_next/static/x.js', '/_vercel/insights/view', '/ADMIN/audit']) {
    assert.equal(publicAnalyticsPath(p), null, p);
  }
});

test('public pages keep their route, without query string or hash', () => {
  assert.equal(publicAnalyticsPath('/'), '/');
  assert.equal(publicAnalyticsPath('/report'), '/report');
  assert.equal(publicAnalyticsPath('/track?code=NU-2026-000123'), '/track');
  assert.equal(publicAnalyticsPath('/login?next=/report#top'), '/login');
  assert.equal(publicAnalyticsPath('/register/'), '/register');
});

test('complaint codes and unknown paths are masked', () => {
  assert.equal(publicAnalyticsPath('/complaints/NU-2026-000123'), '/complaints/[code]');
  assert.equal(publicAnalyticsPath('/complaints/NU-2026-000123/evidence'), '/complaints/[code]');
  assert.equal(publicAnalyticsPath('/complaints'), '/complaints');
  assert.equal(publicAnalyticsPath('/9876543210'), '/other');
  assert.equal(publicAnalyticsPath('/someone@example.com'), '/other');
});
