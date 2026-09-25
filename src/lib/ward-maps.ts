import 'server-only';
import { z } from 'zod';
import { sql } from './db';
import { has, type AuthUser } from './auth';
import { audit } from './audit';
import { badRequest, forbidden, notFound } from './errors';
import { assertWard, complaintScope } from './scope';

/*
 * Ward map features stored as GeoJSON geometry (RFC 7946, [lng, lat]) with a bounding box for fast
 * lookup. Circles are stored as a Point + radius. Everything is validated on the server; users can
 * only read / edit wards inside their jurisdiction.
 */
export const FEATURE_TYPES = ['BOUNDARY', 'STREET', 'DRAINAGE', 'STREETLIGHT', 'WORK_ZONE', 'PUBLIC_ASSET', 'PROBLEM_ZONE', 'OTHER'] as const;
const MAX_POINTS = 5000;

type Pos = [number, number];
const pos = (p: unknown): Pos => {
  if (!Array.isArray(p) || p.length < 2) throw badRequest('Invalid coordinate');
  const [lng, lat] = p.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) throw badRequest('Coordinate out of range');
  return [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
};

/** Validate + normalise a geometry; returns the clean geometry and its bounding box. */
export function cleanGeometry(kind: string, g: unknown, radius?: number | null) {
  const geo = g as { type?: string; coordinates?: unknown };
  let clean: { type: string; coordinates: unknown };
  let pts: Pos[];
  switch (kind) {
    case 'Point':
    case 'Circle': {
      if (geo?.type !== 'Point') throw badRequest('Expected a Point geometry');
      const p = pos(geo.coordinates);
      clean = { type: 'Point', coordinates: p }; pts = [p];
      if (kind === 'Circle' && !(radius && radius > 0 && radius <= 20000)) throw badRequest('Circle radius must be between 1 m and 20 km');
      break;
    }
    case 'LineString': {
      if (geo?.type !== 'LineString' || !Array.isArray(geo.coordinates)) throw badRequest('Expected a LineString geometry');
      pts = (geo.coordinates as unknown[]).map(pos);
      if (pts.length < 2) throw badRequest('A line needs at least two points');
      clean = { type: 'LineString', coordinates: pts };
      break;
    }
    case 'Polygon': {
      if (geo?.type !== 'Polygon' || !Array.isArray(geo.coordinates)) throw badRequest('Expected a Polygon geometry');
      const rings = (geo.coordinates as unknown[]).slice(0, 20).map((r) => (Array.isArray(r) ? r.map(pos) : []));
      for (const r of rings) {
        if (r.length < 3) throw badRequest('A polygon needs at least three points');
        const [a, b] = [r[0], r[r.length - 1]];
        if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]); // close the ring
      }
      pts = rings.flat();
      clean = { type: 'Polygon', coordinates: rings };
      break;
    }
    default: throw badRequest('Unsupported geometry type');
  }
  if (pts.length > MAX_POINTS) throw badRequest(`Too many points (max ${MAX_POINTS})`);
  const lats = pts.map((p) => p[1]); const lngs = pts.map((p) => p[0]);
  return { geometry: clean, bbox: { min_lat: Math.min(...lats), max_lat: Math.max(...lats), min_lng: Math.min(...lngs), max_lng: Math.max(...lngs) } };
}

export const FeatureInput = z.object({
  wardId: z.coerce.number().int().positive(),
  featureType: z.enum(FEATURE_TYPES),
  geometryType: z.enum(['Polygon', 'LineString', 'Point', 'Circle']),
  geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
  radiusM: z.coerce.number().positive().max(20000).nullable().optional(),
  name: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

export async function wardMapData(u: AuthUser, wardId: number) {
  if (!has(u, 'wardmap.view') && !has(u, 'wardmap.edit')) throw forbidden();
  await assertWard(u, wardId);
  const [ward] = await sql`
    SELECT w.*, lb.name_en AS lb_en, lb.name_ta AS lb_ta, lb.center_lat AS lb_lat, lb.center_lng AS lb_lng, lb.id AS lb_id, d.name_en AS district_en, tk.name_en AS taluk_en
    FROM wards w JOIN local_bodies lb ON lb.id = w.local_body_id JOIN districts d ON d.id = lb.district_id LEFT JOIN taluks tk ON tk.id = lb.taluk_id WHERE w.id = ${wardId}`;
  if (!ward) throw notFound();
  const [features, complaints, streets] = await Promise.all([
    sql`SELECT m.id, m.feature_type, m.geometry_type, m.geometry, m.radius_m, m.name, m.description, m.updated_at, u.full_name AS updated_by_name
        FROM ward_maps m LEFT JOIN users u ON u.id = COALESCE(m.updated_by, m.created_by) WHERE m.ward_id = ${wardId} AND m.status = 'ACTIVE' ORDER BY m.feature_type, m.id`,
    sql`SELECT c.code, c.status, c.priority, c.latitude, c.longitude, c.title_en, c.title_ta, cat.icon FROM complaints c LEFT JOIN complaint_categories cat ON cat.id = c.category_id
        WHERE c.ward_id = ${wardId} AND c.latitude IS NOT NULL AND (${complaintScope(u)}) ORDER BY c.created_at DESC LIMIT 500`,
    sql`SELECT id, name_en, name_ta, status FROM streets WHERE ward_id = ${wardId} ORDER BY name_en`,
  ]);
  return { ward, features: [...features], complaints: [...complaints], streets: [...streets] };
}

async function editGuard(u: AuthUser, wardId: number) {
  if (!has(u, 'wardmap.edit')) throw forbidden();
  await assertWard(u, wardId);
}

export async function createFeature(u: AuthUser, d: z.infer<typeof FeatureInput>) {
  await editGuard(u, d.wardId);
  const [w] = await sql`SELECT local_body_id FROM wards WHERE id = ${d.wardId}`;
  if (!w) throw notFound();
  const { geometry, bbox } = cleanGeometry(d.geometryType, d.geometry, d.radiusM);
  const [row] = await sql`
    INSERT INTO ward_maps (ward_id, local_body_id, feature_type, geometry_type, geometry, radius_m, name, description, min_lat, min_lng, max_lat, max_lng, created_by)
    VALUES (${d.wardId}, ${w.local_body_id}, ${d.featureType}, ${d.geometryType}, ${sql.json(geometry as never)}, ${d.geometryType === 'Circle' ? d.radiusM ?? null : null},
            ${d.name ?? null}, ${d.description ?? null}, ${bbox.min_lat}, ${bbox.min_lng}, ${bbox.max_lat}, ${bbox.max_lng}, ${u.id}) RETURNING id`;
  await audit(u, { action: 'WARD_MAP_CREATED', entityType: 'ward_maps', entityId: row.id as number, newValue: { wardId: d.wardId, type: d.featureType, geometry: d.geometryType, name: d.name ?? null } });
  return { ok: true, id: row.id as number };
}

export const FeatureUpdate = FeatureInput.omit({ wardId: true }).partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional(), reason: z.string().trim().max(500).nullable().optional() });

export async function updateFeature(u: AuthUser, id: number, d: z.infer<typeof FeatureUpdate>) {
  const [f] = await sql`SELECT * FROM ward_maps WHERE id = ${id}`;
  if (!f) throw notFound();
  await editGuard(u, f.ward_id as number);
  const set: Record<string, unknown> = {};
  if (d.geometry) {
    const kind = d.geometryType ?? (f.geometry_type as string);
    const { geometry, bbox } = cleanGeometry(kind, d.geometry, d.radiusM ?? (f.radius_m as number | null));
    Object.assign(set, { geometry: sql.json(geometry as never), geometry_type: kind, ...bbox, radius_m: kind === 'Circle' ? d.radiusM ?? f.radius_m : null });
  }
  if (d.featureType) set.feature_type = d.featureType;
  if (d.name !== undefined) set.name = d.name;
  if (d.description !== undefined) set.description = d.description;
  if (d.status) set.status = d.status;
  if (!Object.keys(set).length) return { ok: true };
  await sql`UPDATE ward_maps SET ${sql({ ...set, updated_by: u.id, updated_at: new Date() })} WHERE id = ${id}`;
  const archived = d.status === 'INACTIVE' && f.status === 'ACTIVE';
  await audit(u, { action: archived ? 'WARD_MAP_ARCHIVED' : 'WARD_MAP_UPDATED', entityType: 'ward_maps', entityId: id, reason: d.reason ?? null,
    oldValue: { type: f.feature_type, name: f.name, status: f.status, geometryChanged: !!d.geometry ? 'yes' : 'no' }, newValue: { type: d.featureType ?? f.feature_type, name: d.name ?? f.name, status: d.status ?? f.status } });
  return { ok: true };
}
