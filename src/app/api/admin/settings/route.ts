import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser, has } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { forbidden, notFound, badRequest } from '@/lib/errors';

const RULES: Record<string, z.ZodTypeAny> = {
  'ai.engine': z.enum(['auto', 'rules', 'llm']),
  'ai.llm_model': z.string().regex(/^claude-[a-z0-9-]+$/),
  'duplicate.radius_m': z.number().int().min(10).max(2000),
  'duplicate.window_days': z.number().int().min(1).max(365),
  'gps.conflict_km': z.number().min(0.1).max(100),
  'upload.max_photo_mb': z.number().min(1).max(4),
  'upload.max_video_mb': z.number().min(1).max(4),
  'auth.max_failed_logins': z.number().int().min(3).max(20),
  'auth.lockout_minutes': z.number().int().min(1).max(1440),
  'auth.session_hours': z.number().int().min(1).max(72),
  'pilot.local_body_code': z.string().max(60),
};

export const POST = route(async (req) => {
  const u = await requireApiUser('ADMIN', ['settings.manage', 'masterdata.manage']);
  const d = await body(req, z.object({ key: z.string(), value: z.unknown() }));
  const [s] = await sql`SELECT key, value, is_security FROM system_settings WHERE key = ${d.key}`;
  if (!s) throw notFound();
  // Security & AI settings: Super Admin only
  if (s.is_security && !has(u, 'settings.manage')) throw forbidden('Only Super Admin can change security settings');
  const rule = RULES[d.key];
  if (!rule) throw badRequest('Setting is not editable');
  const value = rule.parse(d.value);
  await sql`UPDATE system_settings SET value = ${sql.json(value as never)}, updated_by = ${u.id}, updated_at = now() WHERE key = ${d.key}`;
  await audit(u, { action: 'SETTINGS_UPDATED', entityType: 'system_setting', entityId: d.key, oldValue: s.value, newValue: value });
  return { ok: true };
});
