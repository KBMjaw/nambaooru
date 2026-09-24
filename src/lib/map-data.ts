import 'server-only';
import { sql } from './db';
import type { AuthUser } from './auth';
import { complaintScope } from './scope';
import { filterSql, type Filters } from './office-queries';

export async function mapComplaints(u: AuthUser, f: Filters = {}, openOnly = false) {
  const rows = await sql`
    SELECT c.code, c.status, c.priority, cat.icon, cat.name_en AS category_en, cat.name_ta AS category_ta, w.ward_number,
           COALESCE(c.latitude, w.center_lat + ((c.id % 7) - 3) * 0.0004, lb.center_lat) AS lat,
           COALESCE(c.longitude, w.center_lng + ((c.id % 5) - 2) * 0.0004, lb.center_lng) AS lng,
           (c.latitude IS NULL) AS approx
    FROM complaints c
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    LEFT JOIN wards w ON w.id = c.ward_id
    LEFT JOIN streets s ON s.id = c.street_id
    JOIN local_bodies lb ON lb.id = c.local_body_id
    WHERE (${complaintScope(u)}) AND ${filterSql(f)} ${openOnly ? sql`AND c.status NOT IN ('CLOSED','REJECTED','DUPLICATE')` : sql``}
    ORDER BY c.created_at DESC LIMIT 1000`;
  return rows.filter((r) => r.lat != null).map((r) => ({
    code: r.code as string, status: r.status as string, priority: r.priority as string, icon: r.icon as string, category_en: r.category_en as string,
    category_ta: r.category_ta as string, ward_number: r.ward_number as number | null, lat: Number(r.lat), lng: Number(r.lng), approx: r.approx as boolean,
  }));
}
