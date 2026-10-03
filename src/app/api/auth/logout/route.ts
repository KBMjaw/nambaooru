import { z } from 'zod';
import { route, body } from '@/lib/api';
import { destroySession, getUser } from '@/lib/auth';
import { securityLog } from '@/lib/audit';

export const POST = route(async (req) => {
  const { portal } = await body(req, z.object({ portal: z.enum(['PUBLIC', 'OFFICE', 'ADMIN']) }));
  const u = await getUser(portal);
  if (u) await securityLog('LOGOUT', { userId: u.id, identifier: u.username, portal });
  await destroySession(portal);
  return { ok: true, redirect: portal === 'PUBLIC' ? '/' : portal === 'OFFICE' ? '/office/login' : '/admin/login' };
});
