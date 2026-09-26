import 'server-only';
import { sql } from './db';

export type Vars = Record<string, string | number | null | undefined>;

function render(tpl: string, vars: Vars) {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] == null ? '' : String(vars[k])));
}

/**
 * Create an in-app notification from a template (both languages stored so the UI
 * can switch instantly). Other channels (SMS / WhatsApp / Email / Push) are queued
 * as rows for future channel adapters.
 */
export async function notify(userId: string, templateCode: string, vars: Vars, complaintId?: number | bigint | string | null) {
  const [t] = await sql`SELECT * FROM notification_templates WHERE code = ${templateCode} AND active`;
  if (!t) return;
  const title_en = render(t.title_en as string, { ...vars, category: vars.category_en ?? vars.category });
  const title_ta = render(t.title_ta as string, { ...vars, category: vars.category_ta ?? vars.category });
  const body_en = render(t.body_en as string, { ...vars, category: vars.category_en ?? vars.category, reason: vars.reason_en ?? vars.reason });
  const body_ta = render(t.body_ta as string, { ...vars, category: vars.category_ta ?? vars.category, reason: vars.reason_ta ?? vars.reason });
  const channels = (t.channels as string[]) ?? ['IN_APP'];
  for (const ch of channels) {
    await sql`
      INSERT INTO notifications (user_id, complaint_id, template_code, title_en, title_ta, body_en, body_ta, channel, delivery_status)
      VALUES (${userId}, ${complaintId != null ? String(complaintId) : null}, ${templateCode}, ${title_en}, ${title_ta}, ${body_en}, ${body_ta},
              ${ch}, ${ch === 'IN_APP' ? 'DELIVERED' : 'QUEUED'})`;
  }
}
