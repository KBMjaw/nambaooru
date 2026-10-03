import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_SECONDS = 2 * 3600;

function mac(userId: string, complaintId: number, exp: number) {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (>= 32 chars)');
  return createHmac('sha256', s).update(`support|${userId}|${complaintId}|${exp}`).digest('base64url');
}

/**
 * A citizen may join ("support") an existing complaint only when the duplicate check offered it to them.
 * The offer is a short-lived token bound to that citizen and that complaint, so a guessed complaint code
 * is never enough on its own.
 */
export function supportToken(userId: string, complaintId: number): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return `${exp}.${mac(userId, complaintId, exp)}`;
}

export function verifySupportToken(token: unknown, userId: string, complaintId: number): boolean {
  if (typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp < Date.now() / 1000 || !sig) return false;
  const want = Buffer.from(mac(userId, complaintId, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
