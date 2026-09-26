import 'server-only';
import type { PendingQuery } from 'postgres';
import { sql } from './db';
import { has, isSystemScope, type AuthUser, type Jurisdiction } from './auth';
import { forbidden } from './errors';

/*
 * Jurisdiction enforcement. Every query that returns operational data is filtered here, on the
 * server, from the user's DB-loaded role scope, permissions and jurisdiction grants — never from
 * anything the browser sends.
 *
 *   USER → ROLE (+ per-user overrides) → PERMISSIONS → JURISDICTION (user_jurisdictions rows)
 *
 * A jurisdiction row matches when every non-null column matches: district → taluk → local body
 * → ward, optionally narrowed to a department.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Frag = PendingQuery<any>;
const or = (parts: Frag[]) => (parts.length ? parts.reduce((a, b) => sql`${a} OR ${b}`) : sql`FALSE`);

/** Area match for a local-body id expression (ignores ward / department). */
function areaMatch(j: Jurisdiction, lbCol: Frag): Frag {
  if (j.localBodyId) return sql`${lbCol} = ${j.localBodyId}`;
  if (j.talukId) return sql`${lbCol} IN (SELECT id FROM local_bodies WHERE taluk_id = ${j.talukId})`;
  if (j.districtId) return sql`${lbCol} IN (SELECT id FROM local_bodies WHERE district_id = ${j.districtId})`;
  return sql`TRUE`; // state-wide grant (only Super Admin can create one)
}

/** Local bodies the user can reach. `lbCol` is the SQL expression holding a local_body id. */
export function localBodyScope(u: AuthUser, lbCol: Frag = sql`lb.id`): Frag {
  if (isSystemScope(u)) return sql`TRUE`;
  return or(u.jurisdictions.map((j) => areaMatch(j, lbCol)));
}

/** Wards the user can reach (a ward-restricted grant only reaches that ward). */
export function wardScope(u: AuthUser, wardCol: Frag = sql`w.id`, lbCol: Frag = sql`w.local_body_id`): Frag {
  if (isSystemScope(u)) return sql`TRUE`;
  return or(u.jurisdictions.map((j) => (j.wardId ? sql`${wardCol} = ${j.wardId}` : areaMatch(j, lbCol))));
}

/** Work assigned to the user — inspection, primary/supporting assignment or a complaint action. */
function assignedToMe(u: AuthUser): Frag {
  return sql`(c.assigned_to = ${u.id} OR c.inspector_id = ${u.id}
              OR EXISTS (SELECT 1 FROM assignments a WHERE a.complaint_id = c.id AND a.assigned_to = ${u.id})
              OR EXISTS (SELECT 1 FROM complaint_actions ca JOIN complaint_action_assignees caa ON caa.action_id = ca.id
                         WHERE ca.complaint_id = c.id AND caa.user_id = ${u.id} AND caa.removed_at IS NULL))`;
}

/**
 * Row-level visibility of complaints for an official — enforced in every query. Use with table alias `c`.
 *   complaint.view.all        → everything
 *   complaint.view.localbody  → whole local body / taluk / district of each grant
 *   complaint.view.department → grant area, narrowed to the grant's department and ward
 *   complaint.view.ward       → the grant's ward
 *   always                    → work assigned to the user
 */
export function complaintScope(u: AuthUser): Frag {
  const p = u.permissions;
  if (p.has('complaint.view.all')) return sql`TRUE`;
  if (u.portal === 'PUBLIC') return sql`c.citizen_id = ${u.id}`;
  const parts: Frag[] = [];
  for (const j of u.jurisdictions) {
    const area = areaMatch(j, sql`c.local_body_id`);
    if (p.has('complaint.view.localbody')) parts.push(area);
    if (p.has('complaint.view.department')) {
      parts.push(sql`(${area} ${j.departmentId ? sql`AND c.department_id = ${j.departmentId}` : sql``} ${j.wardId ? sql`AND c.ward_id = ${j.wardId}` : sql``})`);
    }
    if (p.has('complaint.view.ward') && j.wardId) parts.push(sql`c.ward_id = ${j.wardId}`);
  }
  parts.push(assignedToMe(u));
  return sql`(${or(parts)})`;
}

/**
 * Users an official may assign work to: active operational (department / worker level) users,
 * below the actor in rank, inside the complaint's local body. Department-level actors are further
 * limited to their department or the people they supervise. Use with aliases usr / r / o.
 */
export function assignableScope(u: AuthUser, complaintLocalBodyId?: number | null): Frag {
  const base = sql`usr.status = 'ACTIVE' AND r.status = 'ACTIVE' AND r.portal = 'OFFICE' AND r.rank < ${u.roleRank}
                   AND r.default_scope IN ('DEPARTMENT','ASSIGNED')`;
  const lb = complaintLocalBodyId ? sql`AND o.local_body_id = ${complaintLocalBodyId}` : sql``;
  if (isSystemScope(u)) return complaintLocalBodyId ? sql`${base} ${lb}` : sql`${base}`;
  const reach = sql`AND (${localBodyScope(u, sql`o.local_body_id`)}) ${lb}`;
  if (u.scope === 'DEPARTMENT') {
    const depts = u.jurisdictions.map((j) => j.departmentId).filter((d): d is number => !!d);
    const dept = depts.length ? sql`o.department_id IN ${sql(depts)}` : sql`FALSE`;
    return sql`${base} ${reach} AND (${dept} OR o.supervisor_id = ${u.id})`;
  }
  if (u.scope === 'LOCAL_BODY' || u.scope === 'DISTRICT') return sql`${base} ${reach}`;
  return sql`FALSE`;
}

/** Throw 403 unless the local body is inside the user's jurisdiction. */
export async function assertLocalBody(u: AuthUser, localBodyId: number | null | undefined) {
  if (isSystemScope(u)) return;
  if (!localBodyId) throw forbidden('Outside your jurisdiction');
  const [ok] = await sql`SELECT 1 FROM local_bodies lb WHERE lb.id = ${localBodyId} AND (${localBodyScope(u)})`;
  if (!ok) throw forbidden('Outside your jurisdiction');
}

/** Throw 403 unless the ward is inside the user's jurisdiction. */
export async function assertWard(u: AuthUser, wardId: number) {
  if (isSystemScope(u)) return;
  const [ok] = await sql`SELECT 1 FROM wards w WHERE w.id = ${wardId} AND (${wardScope(u)})`;
  if (!ok) throw forbidden('Outside your jurisdiction');
}

/** Primary local body of an official (for defaults in forms). */
export function primaryLocalBody(u: AuthUser): number | null {
  return u.jurisdictions.find((j) => j.isPrimary)?.localBodyId ?? u.localBodyId ?? null;
}

export const canSeeAll = (u: AuthUser) => isSystemScope(u) || has(u, 'complaint.view.all');
