import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { badRequest } from '@/lib/errors';

/**
 * Pincode lookup. A pincode is only a narrowing aid: it may span several post offices,
 * villages and local bodies, so we return every candidate and let the citizen choose.
 */
export const GET = route<{ params: Promise<{ pin: string }> }>(async (_req, { params }) => {
  const { pin } = await params;
  if (!/^[1-9]\d{5}$/.test(pin)) throw badRequest('err.pincode');
  const places = await sql`
    SELECT p.id, p.place_name, p.district_name, p.district_id, d.name_en AS district_en, d.name_ta AS district_ta, p.taluk_id
    FROM postal_locations p LEFT JOIN districts d ON d.id = p.district_id
    WHERE p.pincode = ${pin} AND p.status = 'ACTIVE' ORDER BY p.place_name`;
  const districtIds = [...new Set(places.map((p) => p.district_id).filter(Boolean))] as number[];
  const localBodies = districtIds.length
    ? await sql`
        SELECT lb.id, lb.name_en, lb.name_ta, lb.district_id, lb.taluk_id, t.code AS type_code, t.name_en AS type_en, t.name_ta AS type_ta,
               EXISTS (SELECT 1 FROM postal_location_jurisdictions j JOIN postal_locations p ON p.id = j.postal_location_id
                       WHERE j.local_body_id = lb.id AND p.pincode = ${pin} AND j.status = 'ACTIVE') AS mapped,
               (SELECT array_agg(j.postal_location_id) FROM postal_location_jurisdictions j WHERE j.local_body_id = lb.id AND j.status = 'ACTIVE') AS postal_ids
        FROM local_bodies lb JOIN local_body_types t ON t.id = lb.type_id
        WHERE lb.district_id IN ${sql(districtIds)} AND lb.status = 'ACTIVE'
        ORDER BY mapped DESC, lb.name_en`
    : [];
  return { pincode: pin, places, localBodies };
});
