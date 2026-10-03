'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Analytics, type BeforeSend } from '@vercel/analytics/next';
import { publicAnalyticsPath } from '@/lib/site-analytics-path';

/**
 * Only the normalised public route is ever sent: no query string, hash or complaint code, and
 * nothing at all for /admin, /office or /api. No custom events or properties are used.
 */
const beforeSend: BeforeSend = (event) => {
  const url = new URL(event.url);
  const path = publicAnalyticsPath(url.pathname);
  return path ? { ...event, url: url.origin + path } : null;
};

/** Public-site visitor analytics: Vercel Web Analytics plus the first-party aggregate counter shown to admins. */
export function SiteAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    const p = publicAnalyticsPath(pathname);
    if (!p) return;
    const body = JSON.stringify({ p });
    try {
      if (!navigator.sendBeacon?.('/api/site-analytics', new Blob([body], { type: 'application/json' }))) {
        void fetch('/api/site-analytics', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
      }
    } catch { /* analytics must never break the page */ }
  }, [pathname]);
  return <Analytics beforeSend={beforeSend} />;
}
