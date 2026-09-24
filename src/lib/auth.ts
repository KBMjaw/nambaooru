import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { sql } from './db';
import { forbidden, unauthorized } from './errors';

export type Portal = 'PUBLIC' | 'OFFICE' | 'ADMIN';

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
  portal: Portal;
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
    SELECT u.id, u.username, u.full_name, u.mobile, u.email, u.status, u.token_version, u.preferred_language,
           r.code AS role, r.name_en AS role_en, r.name_ta AS role_ta, r.rank, r.portal,
           o.local_body_id AS o_lb, o.department_id, o.ward_id AS o_ward, o.supervisor_id,
           c.local_body_id AS c_lb, c.ward_id AS c_ward,
           COALESCE((SELECT array_agg(p.code) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                     WHERE rp.role_id = r.id), '{}') AS perms
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN officials o ON o.user_id = u.id
    LEFT JOIN citizens c ON c.user_id = u.id
    WHERE u.id = ${userId}`;
  const u = rows[0];
  if (!u) return null;
  // Authorization is derived from the database — never from the URL or the token alone.
  if (u.status !== 'ACTIVE' || u.token_version !== tv || u.portal !== portal) return null;
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
    portal: u.portal as Portal,
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
  if (permission && !hasAny(u, permission)) redirect(portal === 'PUBLIC' ? '/' : portal === 'OFFICE' ? '/office' : '/admin');
  return u;
}

/** For API routes: throw 401/403. */
export async function requireApiUser(portal: Portal, permission?: string | string[]): Promise<AuthUser> {
  const u = await getUser(portal);
  if (!u) throw unauthorized();
  if (permission && !hasAny(u, permission)) throw forbidden();
  return u;
}

/** Any authenticated official (office or admin portal). */
export async function requireApiStaff(permission?: string | string[]): Promise<AuthUser> {
  const u = (await getUser('OFFICE')) ?? (await getUser('ADMIN'));
  if (!u) throw unauthorized();
  if (permission && !hasAny(u, permission)) throw forbidden();
  return u;
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
