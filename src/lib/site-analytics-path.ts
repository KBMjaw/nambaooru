// Shared by the browser (Vercel Analytics beforeSend + page-view beacon) and the server (recorder).
// Only public citizen pages are counted; internal portals and APIs are never tracked.

const PUBLIC_ROUTES = new Set(['/', '/login', '/register', '/report', '/track', '/complaints', '/notifications', '/profile', '/password']);

/**
 * Map a pathname to the route recorded for analytics, or null when it must not be tracked.
 * Query strings and hashes are dropped and complaint codes are replaced by a placeholder, so no
 * complaint identifier, search term or redirect target ever reaches an analytics store.
 */
export function publicAnalyticsPath(pathname: string): string | null {
  const p = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (/^\/(admin|office|api|_next|_vercel)(\/|$)/i.test(p)) return null;
  if (/^\/complaints\/[^/]+/.test(p)) return '/complaints/[code]';
  return PUBLIC_ROUTES.has(p) ? p : '/other';
}
