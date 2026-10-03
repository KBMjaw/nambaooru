import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';

const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export const GET = route(async () => {
  const u = await requireApiUser('ADMIN', 'location.manage');
  const rows = await sql`
    SELECT p.place_name, p.pincode, p.district_name, d.name_en AS district_normalised, t.name_en AS taluk, p.status, s.name AS source,
           (SELECT string_agg(lb.name_en || COALESCE(' / Ward ' || w.ward_number, '') || ' [' || j.confidence || ']', '; ')
              FROM postal_location_jurisdictions j JOIN local_bodies lb ON lb.id = j.local_body_id LEFT JOIN wards w ON w.id = j.ward_id
             WHERE j.postal_location_id = p.id AND j.status = 'ACTIVE') AS mapped_local_bodies
    FROM postal_locations p LEFT JOIN districts d ON d.id = p.district_id LEFT JOIN taluks t ON t.id = p.taluk_id LEFT JOIN data_sources s ON s.id = p.source_id
    ORDER BY p.district_name, p.place_name`;
  const header = ['Place', 'Pincode', 'District', 'District (normalised)', 'Taluk', 'Status', 'Source', 'Mapped local bodies'];
  const csv = [header.join(','), ...rows.map((r) => [r.place_name, r.pincode, r.district_name, r.district_normalised, r.taluk, r.status, r.source, r.mapped_local_bodies].map(esc).join(','))].join('\n');
  await audit(u, { action: 'POSTAL_EXPORT', entityType: 'postal_locations', newValue: { rows: rows.length } });
  return new Response('﻿' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tn_postal_locations_export.csv"' } });
});
