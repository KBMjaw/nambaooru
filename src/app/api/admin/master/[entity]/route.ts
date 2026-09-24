import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser, has } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { badRequest, forbidden, notFound, conflict } from '@/lib/errors';
import { ENTITIES, type Col, type Entity } from '@/lib/master';

type Ctx = { params: Promise<{ entity: string }> };

async function ctx(req: Request, params: Ctx['params'], write: boolean) {
  const u = await requireApiUser('ADMIN');
  const name = (await params).entity;
  const e = ENTITIES[name];
  if (!e) throw notFound();
  if (!has(u, e.perm) && !(has(u, 'user.manage.all') && !write)) throw forbidden();
  return { u, e, name };
}

function coerce(c: Col, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === '' || v === null) {
    if (c.required) throw badRequest(`${c.label} is required`, { [c.key]: ['Required'] });
    return c.type === 'array' ? [] : c.type === 'bool' ? false : null;
  }
  switch (c.type) {
    case 'number': case 'ref': { const n = Number(v); if (!Number.isFinite(n)) throw badRequest(`${c.label} must be a number`); return Math.trunc(n); }
    case 'float': { const n = Number(v); if (!Number.isFinite(n)) throw badRequest(`${c.label} must be a number`); return n; }
    case 'bool': return v === true || v === 'true' || v === 'on';
    case 'array': return (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 200);
    case 'select': case 'status': { const s = String(v); if (c.options && !c.options.includes(s)) throw badRequest(`Invalid ${c.label}`); return s; }
    default: return String(v).trim().slice(0, 4000);
  }
}

function values(e: Entity, body: Record<string, unknown>, isCreate: boolean) {
  const out: Record<string, unknown> = {};
  for (const c of e.cols) {
    if (!isCreate && c.readOnlyOnEdit) continue;
    if (c.type === 'status') {
      if (body[c.key] !== undefined) {
        const s = String(body[c.key]);
        if (!['ACTIVE', 'INACTIVE'].includes(s)) throw badRequest('Invalid status');
        out[c.key] = s;
      }
      continue;
    }
    const v = coerce(c, body[c.key]);
    if (v !== undefined) out[c.key] = v;
    else if (isCreate && c.required) throw badRequest(`${c.label} is required`, { [c.key]: ['Required'] });
  }
  return out;
}

export const GET = route<Ctx>(async (req, { params }) => {
  const { e } = await ctx(req, params, false);
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim();
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);
  const parent = sp.get('parent');
  const limit = 50;
  const where = [sql`TRUE`];
  if (q && e.search.length) {
    const like = `%${q.slice(0, 60)}%`;
    where.push(e.search.map((k) => sql`${sql(k)}::text ILIKE ${like}`).reduce((a, b) => sql`${a} OR ${b}`));
  }
  if (parent && e.filterBy) where.push(sql`${sql(e.filterBy)} = ${Number(parent)}`);
  const cond = where.reduce((a, b) => sql`(${a}) AND (${b})`);
  const rows = await sql`SELECT *, count(*) OVER()::int AS _total FROM ${sql(e.table)} WHERE ${cond} ORDER BY ${sql.unsafe(e.order)} LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
  let refs: Record<string, { id: unknown; label: string }[]> = {};
  if (sp.get('refs')) {
    for (const c of e.cols.filter((x) => x.type === 'ref')) {
      const re = ENTITIES[c.ref!];
      if (!re?.refLabel) continue;
      refs[c.key] = (await sql`SELECT t.${sql(re.pk)} AS id, ${sql.unsafe(re.refLabel)} AS label FROM ${sql(re.table)} t ORDER BY 2 LIMIT 3000`).map((r) => ({ id: r.id, label: r.label as string }));
    }
  }
  const data = rows.map(({ _total, data: _bin, ...r }) => r);
  return { rows: data, total: (rows[0]?._total as number) ?? 0, page, limit, entity: { title: e.title, pk: e.pk, cols: e.cols, statusCol: e.statusCol, filterBy: e.filterBy }, refs };
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { u, e, name } = await ctx(req, params, true);
  const body = (await req.json()) as Record<string, unknown>;
  const v = values(e, body, true);
  try {
    const [row] = await sql`INSERT INTO ${sql(e.table)} ${sql(v)} RETURNING *`;
    await audit(u, { action: `master.${name}.create`, entityType: name, entityId: String(row[e.pk]), newValue: v });
    return { ok: true, row };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw conflict('A record with the same key already exists');
    if ((err as { code?: string }).code === '23503') throw badRequest('Referenced record does not exist');
    throw err;
  }
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { u, e, name } = await ctx(req, params, true);
  const id = req.nextUrl.searchParams.get('id');
  if (!id) throw badRequest('id required');
  const pk = e.pkType === 'int' ? Number(id) : id;
  const body = (await req.json()) as Record<string, unknown>;
  const v = values(e, body, false);
  if (!Object.keys(v).length) throw badRequest('Nothing to update');
  const [old] = await sql`SELECT * FROM ${sql(e.table)} WHERE ${sql(e.pk)} = ${pk}`;
  if (!old) throw notFound();
  try {
    const [row] = await sql`UPDATE ${sql(e.table)} SET ${sql(v)} WHERE ${sql(e.pk)} = ${pk} RETURNING *`;
    const oldVals = Object.fromEntries(Object.keys(v).map((k) => [k, old[k]]));
    await audit(u, { action: `master.${name}.update`, entityType: name, entityId: String(id), oldValue: oldVals, newValue: v });
    return { ok: true, row };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw conflict('A record with the same key already exists');
    throw err;
  }
});
