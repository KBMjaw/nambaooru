import postgres from 'postgres';

type Sql = postgres.Sql<Record<string, unknown>>;

const g = globalThis as unknown as { __nuSql?: Sql };

function create(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return postgres(url, {
    max: process.env.VERCEL ? 5 : 10,
    // Supavisor/PgBouncer transaction pooling does not reliably support pipelined queries:
    // keep exactly one in-flight query per connection.
    ...({ max_pipeline: 1 } as object),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // required for PgBouncer / Supavisor transaction pooling
    ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
    transform: { undefined: null },
    // BIGSERIAL ids/counts as JS numbers (all values are far below 2^53)
    types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number | bigint) => x.toString() } } as unknown as Record<string, postgres.PostgresType>,
  });
}

/** Lazily-initialised shared connection pool (safe during `next build`). */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  get(_t, prop) {
    g.__nuSql ??= create();
    const v = (g.__nuSql as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === 'function' ? (v as Function).bind(g.__nuSql) : v;
  },
  apply(_t, _this, args) {
    g.__nuSql ??= create();
    return (g.__nuSql as unknown as (...a: unknown[]) => unknown)(...args);
  },
});

export type { Sql };
