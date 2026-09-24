import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { createSession, hashPassword, requestMeta } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { rateLimit } from '@/lib/ratelimit';
import { audit } from '@/lib/audit';
import { HttpError, badRequest } from '@/lib/errors';
import { cookies } from 'next/headers';
import { LANG_COOKIE, isLang } from '@/i18n';

import { passwordSchema } from '@/lib/validation';

const Schema = z.object({
  fullName: z.string().trim().min(2).max(100),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  email: z.string().trim().email().max(120).optional().or(z.literal('')),
  pincode: z.string().regex(/^[1-9]\d{5}$/),
  postalLocationId: z.coerce.number().int().positive().nullable().optional(),
  districtId: z.number().int().positive(),
  talukId: z.number().int().positive().nullable().optional(),
  localBodyId: z.number().int().positive().nullable().optional(),
  wardId: z.number().int().positive().nullable().optional(),
  streetId: z.number().int().positive().nullable().optional(),
  streetText: z.string().trim().max(120).optional().or(z.literal('')),
  address: z.string().trim().min(1).max(200),
  landmark: z.string().trim().max(120).optional().or(z.literal('')),
  password: passwordSchema,
  consent: z.literal(true),
  lang: z.string().optional(),
});

export const POST = route(async (req) => {
  const { ip } = await requestMeta();
  await rateLimit(`register:ip:${ip ?? 'unknown'}`, 10, 3600);
  const d = await body(req, Schema);

  const dob = new Date(d.dob);
  const age = (Date.now() - dob.getTime()) / (365.25 * 86400000);
  if (!(age > 5 && age < 120)) throw badRequest('err.dob', { dob: ['err.dob'] });

  // Consistency checks: ward must belong to local body, street to ward, local body to district
  if (d.localBodyId) {
    const [lb] = await sql`SELECT id FROM local_bodies WHERE id = ${d.localBodyId} AND district_id = ${d.districtId} AND status = 'ACTIVE'`;
    if (!lb) throw badRequest('Invalid local body');
  }
  if (d.wardId) {
    const [w] = await sql`SELECT id FROM wards WHERE id = ${d.wardId} AND local_body_id = ${d.localBodyId ?? 0} AND status = 'ACTIVE'`;
    if (!w) throw badRequest('Invalid ward');
  }
  if (d.streetId) {
    const [s] = await sql`SELECT id FROM streets WHERE id = ${d.streetId} AND ward_id = ${d.wardId ?? 0} AND status = 'ACTIVE'`;
    if (!s) throw badRequest('Invalid street');
  }

  const existing = await sql`SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.mobile = ${d.mobile} AND r.code = 'CITIZEN'`;
  if (existing.length) throw new HttpError(409, 'MOBILE_TAKEN', 'reg.mobileTaken');

  await sql`INSERT INTO pincodes (pincode) VALUES (${d.pincode}) ON CONFLICT DO NOTHING`;
  const lang = isLang(d.lang) ? d.lang : 'ta';
  const hash = await hashPassword(d.password);
  const user = await sql.begin(async (tx) => {
    const [u] = await tx`
      INSERT INTO users (username, password_hash, full_name, mobile, email, role_id, preferred_language)
      VALUES (${'c' + d.mobile}, ${hash}, ${d.fullName}, ${d.mobile}, ${d.email || null},
              (SELECT id FROM roles WHERE code = 'CITIZEN'), ${lang})
      RETURNING id, token_version`;
    await tx`
      INSERT INTO citizens (user_id, dob_enc, address_enc, landmark, pincode, postal_location_id, district_id, taluk_id,
                            local_body_id, ward_id, street_id, street_text)
      VALUES (${u.id}, ${encrypt(d.dob)}, ${encrypt(d.address)}, ${d.landmark || null}, ${d.pincode}, ${d.postalLocationId ?? null},
              ${d.districtId}, ${d.talukId ?? null}, ${d.localBodyId ?? null}, ${d.wardId ?? null}, ${d.streetId ?? null}, ${d.streetText || null})`;
    return u;
  });
  await audit({ id: user.id as string, role: 'CITIZEN' }, { action: 'user.register', entityType: 'user', entityId: user.id as string, targetUserId: user.id as string, newValue: { role: 'CITIZEN', localBodyId: d.localBodyId, wardId: d.wardId } });
  await createSession(user.id as string, 'PUBLIC', user.token_version as number);
  (await cookies()).set(LANG_COOKIE, lang, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  return { ok: true, redirect: '/' };
});
