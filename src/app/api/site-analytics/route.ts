import { route } from '@/lib/api';
import { requestMeta } from '@/lib/auth';
import { publicAnalyticsPath } from '@/lib/site-analytics-path';
import { recordPageView } from '@/lib/site-analytics';

/** Page-view beacon from public pages. Accepts only a pathname; nothing else is read or stored. */
export const POST = route(async (req) => {
  const body = (await req.json().catch(() => null)) as { p?: unknown } | null;
  const path = typeof body?.p === 'string' ? publicAnalyticsPath(body.p.slice(0, 200)) : null;
  if (path) {
    const { ip, userAgent } = await requestMeta();
    await recordPageView(path, ip, userAgent);
  }
  return new Response(null, { status: 204 });
});
