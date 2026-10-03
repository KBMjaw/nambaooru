import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { rateLimit } from './ratelimit';

/** Calendar day in India, used for "today / this week / this month". */
const TODAY = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;

const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|node-fetch|axios|go-http/i;

/**
 * Count one public page view. The visitor is identified only by a hash of (IP, user agent) with a
 * random salt that changes every day and is deleted after two days; the IP and user agent themselves
 * are never stored.
 */
export async function recordPageView(path: string, ip: string | null, userAgent: string | null) {
  if (!ip || !userAgent || BOT_UA.test(userAgent)) return;
  await sql`INSERT INTO site_analytics_salts (day, salt) VALUES (${TODAY}, ${randomBytes(32)}) ON CONFLICT (day) DO NOTHING`;
  const [s] = await sql`SELECT salt FROM site_analytics_salts WHERE day = ${TODAY}`;
  const visitor = createHash('sha256').update(s.salt as Buffer).update(ip).update('\n').update(userAgent).digest('hex').slice(0, 32);
  await rateLimit(`pv:${visitor}`, 300, 600);
  await sql`
    INSERT INTO site_page_views (day, path, visitor_hash) VALUES (${TODAY}, ${path}, ${visitor})
    ON CONFLICT (day, path, visitor_hash) DO UPDATE SET views = LEAST(site_page_views.views + 1, 1000)`;
  await sql`DELETE FROM site_analytics_salts WHERE day < ${TODAY} - 1`;
}

export interface SiteAnalyticsSummary {
  visitors: { today: number; week: number; month: number; total: number };
  pageViews: { today: number; week: number; month: number; total: number };
  topPages: { path: string; views: number; visitors: number }[];
  since: string | null;
}

/** Aggregate counts for the Admin / Super Admin dashboard. Visitors are unique per day, summed over the period. */
export async function siteAnalyticsSummary(): Promise<SiteAnalyticsSummary> {
  const [[t], topPages] = await Promise.all([
    sql`
      WITH d AS (
        SELECT day, count(DISTINCT visitor_hash)::int AS visitors, sum(views)::int AS views FROM site_page_views GROUP BY day
      )
      SELECT COALESCE(sum(visitors) FILTER (WHERE day = ${TODAY}), 0)::int AS v_today,
             COALESCE(sum(visitors) FILTER (WHERE day >= date_trunc('week', ${TODAY})::date), 0)::int AS v_week,
             COALESCE(sum(visitors) FILTER (WHERE day >= date_trunc('month', ${TODAY})::date), 0)::int AS v_month,
             COALESCE(sum(visitors), 0)::int AS v_total,
             COALESCE(sum(views) FILTER (WHERE day = ${TODAY}), 0)::int AS p_today,
             COALESCE(sum(views) FILTER (WHERE day >= date_trunc('week', ${TODAY})::date), 0)::int AS p_week,
             COALESCE(sum(views) FILTER (WHERE day >= date_trunc('month', ${TODAY})::date), 0)::int AS p_month,
             COALESCE(sum(views), 0)::int AS p_total,
             to_char(min(day), 'YYYY-MM-DD') AS since
      FROM d`,
    sql<{ path: string; views: number; visitors: number }[]>`
      SELECT path, sum(views)::int AS views, count(*)::int AS visitors
      FROM site_page_views WHERE day > ${TODAY} - 30 GROUP BY path ORDER BY views DESC LIMIT 8`,
  ]);
  return {
    visitors: { today: t.v_today, week: t.v_week, month: t.v_month, total: t.v_total },
    pageViews: { today: t.p_today, week: t.p_week, month: t.p_month, total: t.p_total },
    topPages: [...topPages],
    since: t.since as string | null,
  };
}
