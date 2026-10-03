import { sql } from './db';
import { HttpError } from './errors';

/** Fixed-window rate limiter backed by Postgres (works across serverless instances). */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  const rows = await sql`
    INSERT INTO rate_limits (bucket, window_start, hits) VALUES (${bucket}, now(), 1)
    ON CONFLICT (bucket) DO UPDATE SET
      hits = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE rate_limits.hits + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE rate_limits.window_start END
    RETURNING hits`;
  if ((rows[0].hits as number) > limit) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.');
  }
}
