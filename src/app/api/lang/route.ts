import { z } from 'zod';
import { cookies } from 'next/headers';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { getUser } from '@/lib/auth';
import { LANG_COOKIE } from '@/i18n';

/** Persist the chosen UI language (cookie + user profile when signed in). */
export const POST = route(async (req) => {
  const { lang } = await body(req, z.object({ lang: z.enum(['ta', 'en']) }));
  (await cookies()).set(LANG_COOKIE, lang, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  for (const p of ['PUBLIC', 'OFFICE', 'ADMIN'] as const) {
    const u = await getUser(p).catch(() => null);
    if (u) await sql`UPDATE users SET preferred_language = ${lang} WHERE id = ${u.id}`;
  }
  return { ok: true };
});
