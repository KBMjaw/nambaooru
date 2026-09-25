import 'server-only';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { body } from './api';
import { requireApiUser, type Portal } from './auth';
import { rateLimit } from './ratelimit';
import { listCitizens, getCitizen, createCitizen, updateCitizen, CitizenInput, CitizenUpdate } from './citizens';
import { resetPassword, ResetPassword } from './users';

const VIEW = ['citizen.view', 'citizen.manage'];
const uuid = (v: string) => z.string().uuid().parse(v);

/** Citizen-record handlers shared by /api/admin/citizens and /api/office/citizens. */
export function citizenHandlers(portal: Exclude<Portal, 'PUBLIC'>) {
  return {
    list: async (req: NextRequest) => listCitizens(await requireApiUser(portal, VIEW), Object.fromEntries(req.nextUrl.searchParams)),
    create: async (req: NextRequest) => {
      const u = await requireApiUser(portal, 'citizen.manage');
      await rateLimit(`citizens:create:${u.id}`, 120, 3600);
      return createCitizen(u, await body(req, CitizenInput));
    },
    detail: async (id: string) => getCitizen(await requireApiUser(portal, VIEW), uuid(id)),
    update: async (req: NextRequest, id: string) => updateCitizen(await requireApiUser(portal, 'citizen.manage'), uuid(id), await body(req, CitizenUpdate)),
    password: async (req: NextRequest, id: string) => {
      const u = await requireApiUser(portal, ['user.password_reset', 'user.manage.all']);
      await getCitizen(u, uuid(id)); // jurisdiction check
      return resetPassword(u, uuid(id), await body(req, ResetPassword), { allowCitizen: true });
    },
  };
}
