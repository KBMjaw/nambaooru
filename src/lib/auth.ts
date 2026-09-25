import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { sql } from './db';
import { HttpError, forbidden, unauthorized } from './errors';

export type Portal = 'PUBLIC' | 'OFFICE' | 'ADMIN';
export type RoleScope = 'SYSTEM' | 'DISTRICT' | 'LOCAL_BODY' | 'DEPARTMENT' | 'WARD' | 'ASSIGNED' | 'OWN';

/** One jurisdiction grant. A null column means "any" at that level (narrowed by the columns above it). */
export interface Jurisdiction {
  id: number;
  districtId: number | null;
  talukId: number | null;
  localBodyId: number | null;
  wardId: number | null;
  departmentId: number | null;
  isPrimary: boolean;
}

export const COOKIE: Record<Portal, string> = {
  PUBLIC: 'nu_citizen',
  OFFICE: 'nu_office',
  ADMIN: 'nu_admin',
};

export const LOGIN_PATH: Record<Portal, string> = {
  PUBLIC: '/login',
  OFFICE: '/office/login',
  ADMIN: '/admin/login',
};

/** Where a user with a temporary / reset password must go before anything else. */
export const PASSWORD_PATH: Record<Portal, string> = {
  PUBLIC: '/password',
  OFFICE: '/office/password',
  ADMIN: '/admin/password',
};

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  mobile: string;
  email: string | null;
  role: string;
  roleNameEn: string;
  roleNameTa: string;
  roleRank: number;
  scope: RoleScope;
  portal: Portal;
  jurisdictions: Jurisdiction[];
  mustChangePassword: boolean;
  permissions: Set<string>;
  localBodyId: number | null;
  departmentId: number | null;
  wardId: number | null;
  supervisorId: string | null;
  lang: string;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (>= 32 chars)');
  return new TextEncoder().encode(s);
}

const SESSION_HOURS = 12;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string, portal: Portal, tokenVersion: number) {
  const token = await new SignJWT({ p: portal, tv: tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .setIssuer('nambaooru')
    .setAudience(portal)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE[portal], token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession(portal: Portal) {
  const jar = await cookies();
  jar.delete(COOKIE[portal]);
}

async function loadUser(userId: string, portal: Portal, tv: number): Promise<AuthUser | null> {
  const rows = await sql`
    SELECT u.id, u.username, u.full_name, u.mobile, u.email, u.status, u.token_version, u.preferred_language, u.must_change_password,
           r.code AS role, r.name_en AS role_en, r.name_ta AS role_ta, r.rank, r.portal, r.default_scope, r.status AS role_status,
           o.local_body_id AS o_lb, o.department_id, o.ward_id AS o_ward, o.supervisor_id,
           c.local_body_id AS c_lb, c.ward_id AS c_ward,
           -- Effective permissions = role permissions + active per-user GRANTs − active per-user DENYs
           COALESCE((SELECT array_agg(x.code) FROM (
                       SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id
                       UNION
                       SELECT p.code FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
                        WHERE up.user_id = u.id AND up.effect = 'GRANT' AND up.revoked_at IS NULL
                       EXCEPT
                       SELECT p.code FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
                        WHERE up.user_id = u.id AND up.effect = 'DENY' AND up.revoked_at IS NULL) x), '{}') AS perms,
           COALESCE((SELECT json_agg(json_build_object('id', j.id, 'districtId', j.district_id, 'talukId', j.taluk_id, 'localBodyId', j.local_body_id,
                                                        'wardId', j.ward_id, 'departmentId', j.department_id, 'isPrimary', j.is_primary) ORDER BY j.is_primary DESC, j.id)
                     FROM user_jurisdictions j WHERE j.user_id = u.id AND j.revoked_at IS NULL), '[]') AS juris
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN officials o ON o.user_id = u.id
    LEFT JOIN citizens c ON c.user_id = u.id
    WHERE u.id = ${userId}`;
  const u = rows[0];
  if (!u) return null;
  // Authorization is derived from the database — never from the URL or the token alone.
  if (u.status !== 'ACTIVE' || u.role_status !== 'ACTIVE' || u.token_version !== tv || u.portal !== portal) return null;
  return {
    id: u.id as string,
    username: u.username as string,
    fullName: u.full_name as string,
    mobile: u.mobile as string,
    email: (u.email as string) ?? null,
    role: u.role as string,
    roleNameEn: u.role_en as string,
    roleNameTa: u.role_ta as string,
    roleRank: u.rank as number,
    scope: u.default_scope as RoleScope,
    portal: u.portal as Portal,
    jurisdictions: (typeof u.juris === 'string' ? JSON.parse(u.juris) : u.juris) as Jurisdiction[],
    mustChangePassword: !!u.must_change_password,
    permissions: new Set(u.perms as string[]),
    localBodyId: (u.o_lb ?? u.c_lb ?? null) as number | null,
    departmentId: (u.department_id ?? null) as number | null,
    wardId: (u.o_ward ?? u.c_ward ?? null) as number | null,
    supervisorId: (u.supervisor_id ?? null) as string | null,
    lang: u.preferred_language as string,
  };
}

/** Resolve the signed-in user for a portal (memoised per request). */
export const getUser = cache(async (portal: Portal): Promise<AuthUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE[portal])?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'nambaooru', audience: portal });
    if (payload.p !== portal || typeof payload.sub !== 'string') return null;
    return await loadUser(payload.sub, portal, Number(payload.tv));
  } catch {
    return null;
  }
});

/** For server components/pages: redirect to the portal login when not signed in. */
export async function requirePageUser(portal: Portal, permission?: string | string[]): Promise<AuthUser> {
  const u = await getUser(portal);
  if (!u) redirect(LOGIN_PATH[portal]);
  // A temporary or reset password must be replaced before the account can be used.
  if (u.mustChangePassword) redirect(PASSWORD_PATH[portal]);
  if (permission && !hasAny(u, permission)) redirect(portal === 'PUBLIC' ? '/' : portal === 'OFFICE' ? '/office' : '/admin');
  return u;
}

const PW_REQUIRED = () => new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'auth.mustChangePassword');

/** For API routes: throw 401/403. */
export async function requireApiUser(portal: Portal, permission?: string | string[]): Promise<AuthUser> {
  const u = await getUser(portal);
  if (!u) throw unauthorized();
  if (u.mustChangePassword) throw PW_REQUIRED();
  if (permission && !hasAny(u, permission)) throw forbidden();
  return u;
}

/** Any authenticated official (office or admin portal). */
export async function requireApiStaff(permission?: string | string[]): Promise<AuthUser> {
  const u = (await getUser('OFFICE')) ?? (await getUser('ADMIN'));
  if (!u) throw unauthorized();
  if (u.mustChangePassword) throw PW_REQUIRED();
  if (permission && !hasAny(u, permission)) throw forbidden();
  return u;
}

/** Staff portal user whose request comes from a given portal cookie (admin portal wins when both are present and allowed). */
export async function requireApiStaffFor(portalHint: string | null, permission?: string | string[]): Promise<AuthUser> {
  const order: Portal[] = portalHint === 'ADMIN' ? ['ADMIN', 'OFFICE'] : ['OFFICE', 'ADMIN'];
  for (const p of order) {
    const u = await getUser(p);
    if (!u) continue;
    if (u.mustChangePassword) throw PW_REQUIRED();
    if (permission && !hasAny(u, permission)) continue;
    return u;
  }
  if ((await getUser('OFFICE')) || (await getUser('ADMIN'))) throw forbidden();
  throw unauthorized();
}

export function isSystemScope(u: AuthUser) {
  return u.scope === 'SYSTEM';
}

export function has(u: AuthUser, perm: string) {
  return u.permissions.has(perm);
}
export function hasAny(u: AuthUser, perms: string | string[]) {
  return (Array.isArray(perms) ? perms : [perms]).some((p) => u.permissions.has(p));
}

export async function requestMeta() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null;
  return { ip, userAgent: h.get('user-agent')?.slice(0, 300) ?? null };
}
