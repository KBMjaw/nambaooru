import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { getUser, hashPassword, verifyPassword, createSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { badRequest, unauthorized } from '@/lib/errors';
import { passwordSchema } from '@/lib/validation';

/** Change own password (any portal). Bumps token_version to revoke other sessions. */
export const POST = route(async (req) => {
  const portal = (['PUBLIC', 'OFFICE', 'ADMIN'] as const).find((p) => p === req.nextUrl.searchParams.get('portal')) ?? 'PUBLIC';
  const u = await getUser(portal);
  if (!u) throw unauthorized();
  await rateLimit(`pw:${u.id}`, 5, 900);
  const d = await body(req, z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }));
  const [row] = await sql`SELECT password_hash FROM users WHERE id = ${u.id}`;
  if (!(await verifyPassword(d.currentPassword, row.password_hash as string))) throw badRequest('auth.invalid');
  const [n] = await sql`UPDATE users SET password_hash = ${await hashPassword(d.newPassword)}, token_version = token_version + 1, updated_at = now()
                        WHERE id = ${u.id} RETURNING token_version`;
  await createSession(u.id, portal, n.token_version as number);
  await audit(u, { action: 'user.password_change', entityType: 'user', entityId: u.id, targetUserId: u.id });
  return { ok: true };
});
