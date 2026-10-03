import postgres from 'postgres';
import { waitUntil } from '@vercel/functions';

type Sql = postgres.Sql<Record<string, unknown>>;

const g = globalThis as unknown as { __nuSql?: Sql };

// Seconds an idle connection stays open before postgres.js closes it.
const IDLE_SECONDS = process.env.VERCEL ? 5 : 20;

function create(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return postgres(url, {
    // Use the pooler in *session* mode (port 5432): transaction-mode multiplexing was observed to
    // desync extended-protocol queries under concurrency. In session mode every open client connection
    // holds one pooler slot, so keep the per-instance pool small and close idle sessions quickly
    // (see keepAliveUntilIdle for why "quickly" needs help on Vercel).
    max: process.env.VERCEL ? 2 : 10,
    idle_timeout: IDLE_SECONDS,
    max_lifetime: 60 * 5,
    connect_timeout: 15,
    prepare: false, // safe with any pooler mode
    ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
    transform: { undefined: null },
    // BIGSERIAL ids/counts as JS numbers (all values are far below 2^53)
    types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number | bigint) => x.toString() } } as unknown as Record<string, postgres.PostgresType>,
  });
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleResolve: (() => void) | null = null;
/**
 * Vercel suspends a function instance once its response is sent. A suspended instance cannot run
 * postgres.js's idle timer, so its connections stayed open and kept holding pooler slots; with several
 * warm instances this exhausted the Supavisor session pool (EMAXCONNSESSION) during bursts.
 * Every database use (re)arms a timer that outlives idle_timeout and hands it to waitUntil, so the
 * instance stays alive until the idle connections are really closed (same approach as Vercel's
 * attachDatabasePool, which does not support postgres.js). No-op outside Vercel.
 */
function keepAliveUntilIdle() {
  if (!process.env.VERCEL) return;
  if (idleTimer) { clearTimeout(idleTimer); idleResolve?.(); }
  const p = new Promise<void>((resolve) => { idleResolve = resolve; });
  idleTimer = setTimeout(() => { idleTimer = null; idleResolve?.(); }, (IDLE_SECONDS + 1) * 1000);
  try { waitUntil(p); } catch { /* outside a request (e.g. build) */ }
}

/** Lazily-initialised shared connection pool (safe during `next build`). */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  get(_t, prop) {
    g.__nuSql ??= create();
    keepAliveUntilIdle();
    const v = (g.__nuSql as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === 'function' ? (v as Function).bind(g.__nuSql) : v;
  },
  apply(_t, _this, args) {
    g.__nuSql ??= create();
    keepAliveUntilIdle();
    return (g.__nuSql as unknown as (...a: unknown[]) => unknown)(...args);
  },
});

export type { Sql };
