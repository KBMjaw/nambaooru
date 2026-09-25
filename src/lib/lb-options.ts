import 'server-only';
import { sql } from './db';
import { CONTROLLING_AUTHORITIES } from './locations-admin';
import type { LbOptions } from '@/components/admin/LocalBodyForm';

/** Everything the local-body form needs, all from the database. */
export async function lbOptions(): Promise<LbOptions> {
  const [districts, taluks, types, departments, officers] = await Promise.all([
    sql`SELECT id, name_en FROM districts WHERE status = 'ACTIVE' ORDER BY name_en`,
    sql`SELECT id, district_id, name_en FROM taluks WHERE status = 'ACTIVE' ORDER BY name_en`,
    sql`SELECT id, code, category, name_en, name_ta FROM local_body_types ORDER BY id`,
    sql`SELECT DISTINCT ON (code) code, name_en FROM departments WHERE status = 'ACTIVE' ORDER BY code, name_en`,
    sql`SELECT u.id, u.full_name, r.name_en AS role_en, o.local_body_id FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN officials o ON o.user_id = u.id
        WHERE u.status = 'ACTIVE' AND r.portal = 'OFFICE' AND r.default_scope IN ('LOCAL_BODY','DISTRICT') ORDER BY u.full_name`,
  ]);
  return { districts, taluks, types, departments, officers, authorities: [...CONTROLLING_AUTHORITIES] } as unknown as LbOptions;
}

export async function wardRows(localBodyId: number) {
  return sql`
    SELECT w.id, w.ward_number, w.name_en, w.name_ta, w.population, w.description, w.street_count, w.status,
           (SELECT count(*) FROM streets s WHERE s.ward_id = w.id AND s.status = 'ACTIVE')::int AS streets_defined,
           (SELECT count(*) FROM complaints c WHERE c.ward_id = w.id)::int AS complaints,
           (SELECT count(*) FROM ward_maps m WHERE m.ward_id = w.id AND m.status = 'ACTIVE')::int AS features
    FROM wards w WHERE w.local_body_id = ${localBodyId} ORDER BY w.ward_number`;
}
