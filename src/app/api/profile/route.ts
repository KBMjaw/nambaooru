import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { getUser, hashPassword, verifyPassword, createSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { badRequest, unauthorized } from '@/lib/errors';
import { passwordSchema, passwordContextIssue } from '@/lib/validation';

/**
 * Change own password (any portal). Also completes a forced change after a temporary / reset password.
 * Bumps token_version to revoke other sessions. The audit entry records THAT the password changed and
 * how — never any password value or hash.
 */
export const POST = route(async (req) => {
  const portal = (['PUBLIC', 'OFFICE', 'ADMIN'] as const).find((p) => p === req.nextUrl.searchParams.get('portal')) ?? 'PUBLIC';
  const u = await getUser(portal);
  if (!u) throw unauthorized();
  await rateLimit(`pw:${u.id}`, 5, 900);
  const d = await body(req, z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }));
  const [row] = await sql`SELECT password_hash, must_change_password FROM users WHERE id = ${u.id}`;
  if (!(await verifyPassword(d.currentPassword, row.password_hash as string))) throw badRequest('auth.invalid');
  if (d.currentPassword === d.newPassword) throw badRequest('err.passwordSame');
  const issue = passwordContextIssue(d.newPassword, { username: u.username, mobile: u.mobile });
  if (issue) throw badRequest(issue);
  const [n] = await sql`UPDATE users SET password_hash = ${await hashPassword(d.newPassword)}, token_version = token_version + 1, updated_at = now(),
                          must_change_password = false, password_changed_at = now()
                        WHERE id = ${u.id} RETURNING token_version`;
  await createSession(u.id, portal, n.token_version as number);
  await audit(u, {
    action: 'PASSWORD_CHANGED', entityType: 'user', entityId: u.id, targetUserId: u.id,
    newValue: { source: row.must_change_password ? 'FORCED_RESET' : 'SELF_SERVICE', portal, sessionsRevoked: true },
  });
  return { ok: true, redirect: portal === 'PUBLIC' ? '/' : portal === 'OFFICE' ? '/office' : '/admin' };
});
