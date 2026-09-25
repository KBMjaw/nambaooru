import 'server-only';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { body } from './api';
import { sql } from './db';
import { requireApiUser, isSystemScope, type Portal } from './auth';
import { rateLimit } from './ratelimit';
import { badRequest } from './errors';
import { localBodyScope } from './scope';
import {
  CreateUser, createUser, listUsers, manageableRoles, UpdateUser, updateUser, userDetail, ResetPassword, resetPassword,
  JurisdictionInput, addJurisdiction, revokeJurisdiction, PermissionOverride, setPermissionOverride,
} from './users';

/*
 * Shared user-management handlers for the Admin (/api/admin/users) and Officer (/api/office/users)
 * portals. The portal only selects which session cookie is accepted; every permission, hierarchy
 * and jurisdiction rule is enforced inside lib/users.ts from the database.
 */
const VIEW = ['user.view', 'user.manage', 'user.manage.all'];
const MANAGE = ['user.manage', 'user.manage.all'];
const uuid = (v: string) => z.string().uuid().parse(v);

export function userHandlers(portal: Exclude<Portal, 'PUBLIC'>) {
  return {
    list: async (req: NextRequest) => {
      const u = await requireApiUser(portal, VIEW);
      const sp = Object.fromEntries(req.nextUrl.searchParams);
      const r = await listUsers(u, sp);
      return { ...r, items: r.rows, manageableRoles: (await manageableRoles(u)).map((x) => x.code) };
    },
    create: async (req: NextRequest) => {
      const u = await requireApiUser(portal, MANAGE);
      await rateLimit(`users:create:${u.id}`, 60, 3600);
      return createUser(u, await body(req, CreateUser));
    },
    detail: async (id: string) => {
      const u = await requireApiUser(portal, VIEW);
      return userDetail(u, uuid(id));
    },
    update: async (req: NextRequest, id: string) => {
      const u = await requireApiUser(portal, MANAGE);
      return updateUser(u, uuid(id), await body(req, UpdateUser));
    },
    password: async (req: NextRequest, id: string) => {
      const u = await requireApiUser(portal, ['user.password_reset', 'user.manage.all']);
      await rateLimit(`pwreset:${u.id}`, 30, 3600);
      return resetPassword(u, uuid(id), await body(req, ResetPassword));
    },
    jurisdictions: async (req: NextRequest, id: string) => {
      const u = await requireApiUser(portal, MANAGE);
      const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (raw.op === 'revoke') {
        const d = z.object({ jurisdictionId: z.coerce.number().int().positive(), reason: z.string().trim().min(3, 'err.reasonRequired').max(500) }).parse(raw);
        return revokeJurisdiction(u, uuid(id), d.jurisdictionId, d.reason);
      }
      return addJurisdiction(u, uuid(id), JurisdictionInput.parse(raw));
    },
    permissions: async (req: NextRequest, id: string) => {
      const u = await requireApiUser(portal, ['permission.manage', 'user.manage.all']);
      return setPermissionOverride(u, uuid(id), await body(req, PermissionOverride));
    },
    /** Form options inside the actor's jurisdiction: local bodies, departments, wards, supervisors. */
    options: async (req: NextRequest) => {
      const u = await requireApiUser(portal, VIEW);
      const lb = Number(req.nextUrl.searchParams.get('lb') ?? 0) || null;
      const [lbs] = await Promise.all([
        sql`SELECT lb.id, lb.name_en, lb.name_ta, lb.district_id, lb.taluk_id, d.name_en AS district_en FROM local_bodies lb JOIN districts d ON d.id = lb.district_id
            WHERE lb.status = 'ACTIVE' AND (${localBodyScope(u)}) ORDER BY d.name_en, lb.name_en`,
      ]);
      if (lb && !lbs.some((x) => x.id === lb)) throw badRequest('Outside your jurisdiction');
      const [depts, wards, sups] = lb ? await Promise.all([
        sql`SELECT id, code, name_en, name_ta FROM departments WHERE local_body_id = ${lb} AND status = 'ACTIVE' ORDER BY name_en`,
        sql`SELECT id, ward_number, name_en FROM wards WHERE local_body_id = ${lb} AND status = 'ACTIVE' ORDER BY ward_number`,
        sql`SELECT usr.id, usr.full_name, usr.username, r.code AS role, r.name_en AS role_en, r.rank FROM users usr JOIN roles r ON r.id = usr.role_id JOIN officials o ON o.user_id = usr.id
            WHERE o.local_body_id = ${lb} AND usr.status = 'ACTIVE' AND r.default_scope IN ('LOCAL_BODY','DEPARTMENT','WARD') ORDER BY r.rank DESC, usr.full_name`,
      ]) : [[], [], []];
      const districts = isSystemScope(u) ? await sql`SELECT id, name_en, name_ta FROM districts WHERE status = 'ACTIVE' ORDER BY name_en` : [];
      return { localBodies: [...lbs], departments: [...depts], wards: [...wards], supervisors: [...sups], districts: [...districts],
        roles: (await manageableRoles(u)).map((r) => ({ code: r.code, name_en: r.name_en, name_ta: r.name_ta, default_scope: r.default_scope, rank: r.rank, department_code: r.department_code })) };
    },
  };
}
