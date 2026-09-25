import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { createSession, verifyPassword, requestMeta, PASSWORD_PATH, type Portal } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { securityLog } from '@/lib/audit';
import { HttpError } from '@/lib/errors';
import { getSetting } from '@/lib/settings';
import { cookies } from 'next/headers';
import { LANG_COOKIE } from '@/i18n';

const Schema = z.object({
  portal: z.enum(['PUBLIC', 'OFFICE', 'ADMIN']),
  identifier: z.string().trim().min(3).max(64),
  password: z.string().min(1).max(128),
});

// Constant-time-ish dummy hash so unknown users take as long as known ones
const DUMMY = '$2b$12$1w0CePkYV19Dy4ft.Z6NOORjzDsd3srO7YQGOJp8S8ZBDGdmnuDfe';

export const POST = route(async (req) => {
  const { portal, identifier, password } = await body(req, Schema);
  const { ip } = await requestMeta();
  await rateLimit(`login:ip:${ip ?? 'unknown'}`, 30, 300);
  await rateLimit(`login:id:${portal}:${identifier.toLowerCase()}`, 10, 300);

  // Citizens log in with mobile number; officials/admins with username.
  const rows = portal === 'PUBLIC'
    ? await sql`SELECT u.*, r.code AS role, r.portal, r.status AS role_status FROM users u JOIN roles r ON r.id = u.role_id
                WHERE u.mobile = ${identifier} AND r.code = 'CITIZEN' LIMIT 1`
    : await sql`SELECT u.*, r.code AS role, r.portal, r.status AS role_status FROM users u JOIN roles r ON r.id = u.role_id
                WHERE lower(u.username) = ${identifier.toLowerCase()} LIMIT 1`;
  const u = rows[0];
  const ok = await verifyPassword(password, (u?.password_hash as string) ?? DUMMY);

  if (!u || !ok) {
    if (u) {
      const max = Number(await getSetting('auth.max_failed_logins', 5));
      const mins = Number(await getSetting('auth.lockout_minutes', 15));
      await sql`UPDATE users SET failed_logins = failed_logins + 1,
                  locked_until = CASE WHEN failed_logins + 1 >= ${max} THEN now() + make_interval(mins => ${mins}) ELSE locked_until END
                WHERE id = ${u.id}`;
    }
    await securityLog('LOGIN_FAILED', { userId: (u?.id as string) ?? null, identifier, portal });
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'auth.invalid');
  }
  if (u.locked_until && new Date(u.locked_until as string) > new Date()) {
    await securityLog('LOGIN_LOCKED', { userId: u.id as string, identifier, portal });
    throw new HttpError(423, 'LOCKED', 'auth.locked');
  }
  if (u.status !== 'ACTIVE' || u.role_status !== 'ACTIVE') {
    await securityLog('LOGIN_BLOCKED', { userId: u.id as string, identifier, portal, detail: { reason: 'INACTIVE' } });
    throw new HttpError(403, 'INACTIVE', 'auth.inactive');
  }
  // The portal is decided by the role stored in the DB — a citizen can never obtain an office/admin session.
  if (u.portal !== portal) {
    await securityLog('LOGIN_BLOCKED', { userId: u.id as string, identifier, portal, detail: { reason: 'WRONG_PORTAL' } });
    throw new HttpError(403, 'WRONG_PORTAL', 'auth.wrongPortal');
  }

  await sql`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = ${u.id}`;
  await createSession(u.id as string, portal as Portal, u.token_version as number);
  await securityLog('LOGIN_SUCCESS', { userId: u.id as string, identifier, portal, detail: u.must_change_password ? { forcedChange: true } : undefined });
  (await cookies()).set(LANG_COOKIE, u.preferred_language as string, { path: '/', maxAge: 31536000, sameSite: 'lax' });

  const home = u.must_change_password ? PASSWORD_PATH[portal as Portal] : portal === 'PUBLIC' ? '/' : portal === 'OFFICE' ? '/office' : '/admin';
  return { ok: true, redirect: home, role: u.role };
});
