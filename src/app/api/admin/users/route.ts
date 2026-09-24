import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { CreateUser, createUser, listUsers, manageableRoles } from '@/lib/users';

const PORTAL = 'ADMIN' as const;

export const GET = route(async (req) => {
  const u = await requireApiUser(PORTAL, ['user.view', 'user.manage', 'user.manage.all']);
  const sp = req.nextUrl.searchParams;
  const lb = Number(sp.get('supervisorsFor') ?? 0);
  if (lb) {
    const items = await sql`SELECT usr.id, usr.full_name, r.code AS role FROM users usr JOIN roles r ON r.id = usr.role_id JOIN officials o ON o.user_id = usr.id
                            WHERE o.local_body_id = ${lb} AND r.code IN ('SUPERVISOR','DEPT_OFFICER','EO') AND usr.status = 'ACTIVE' ORDER BY usr.full_name`;
    return { items };
  }
  const items = await listUsers(u, { q: sp.get('q') ?? undefined, role: sp.get('role') ?? undefined, status: sp.get('status') ?? undefined });
  return { items, manageableRoles: manageableRoles(u) };
});

export const POST = route(async (req) => {
  const u = await requireApiUser(PORTAL, ['user.manage', 'user.manage.all']);
  await rateLimit(`users:create:${u.id}`, 60, 3600);
  const input = await body(req, CreateUser);
  return createUser(u, input);
});
