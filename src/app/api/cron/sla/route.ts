import { route } from '@/lib/api';
import { slaSweep } from '@/lib/sla';
import { unauthorized } from '@/lib/errors';

/** Vercel Cron: SLA approaching / breached notifications. Protected by CRON_SECRET. */
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) throw unauthorized();
  return slaSweep();
});
