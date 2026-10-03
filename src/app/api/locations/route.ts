import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { badRequest } from '@/lib/errors';

/** Public location master-data lookups (non-sensitive). Location data always comes from the DB. */
export const GET = route(async (req) => {
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type');
  const id = Number(sp.get('parent') ?? 0);
  switch (type) {
    case 'districts':
      return { items: await sql`SELECT id, name_en, name_ta FROM districts WHERE status = 'ACTIVE' ORDER BY name_en` };
    case 'taluks':
      return { items: await sql`SELECT id, name_en, name_ta FROM taluks WHERE district_id = ${id} AND status = 'ACTIVE' ORDER BY name_en` };
    case 'local_bodies':
      return {
        items: await sql`SELECT lb.id, lb.name_en, lb.name_ta, t.name_en AS type_en, t.name_ta AS type_ta, lb.center_lat, lb.center_lng
                         FROM local_bodies lb JOIN local_body_types t ON t.id = lb.type_id
                         WHERE lb.district_id = ${id} AND lb.status = 'ACTIVE' ORDER BY lb.name_en`,
      };
    case 'wards':
      return { items: await sql`SELECT id, ward_number, name_en, name_ta, center_lat, center_lng FROM wards WHERE local_body_id = ${id} AND status = 'ACTIVE' ORDER BY ward_number` };
    case 'streets':
      return { items: await sql`SELECT id, name_en, name_ta FROM streets WHERE ward_id = ${id} AND status = 'ACTIVE' ORDER BY name_en` };
    case 'departments':
      return { items: await sql`SELECT id, code, name_en, name_ta FROM departments WHERE local_body_id = ${id} AND status = 'ACTIVE' ORDER BY name_en` };
    case 'all_local_bodies':
      return { items: await sql`SELECT lb.id, lb.name_en, lb.name_ta, d.name_en AS district_en FROM local_bodies lb JOIN districts d ON d.id = lb.district_id WHERE lb.status = 'ACTIVE' ORDER BY d.name_en, lb.name_en` };
    default:
      throw badRequest('Unknown lookup type');
  }
});
