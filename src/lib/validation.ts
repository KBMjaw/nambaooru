import { z } from 'zod';

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'abc12345', 'admin123', 'welcome1',
  'iloveyou1', 'letmein1', 'passw0rd', 'india123', 'chennai1', 'tamilnadu1', 'nammaooru1', 'abcd1234', '11111111', '00000000',
]);

/** Password policy: 8–128 chars, at least one letter and one digit, not a well-known password, not all one character. */
export const passwordSchema = z.string().min(8).max(128)
  .regex(/[A-Za-z]/, 'err.password')
  .regex(/\d/, 'err.password')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'err.passwordCommon')
  .refine((p) => !/^(.)\1+$/.test(p), 'err.passwordCommon');

/** Extra checks that need account context (password must not contain the username or mobile). */
export function passwordContextIssue(pw: string, ctx: { username?: string | null; mobile?: string | null }): string | null {
  const low = pw.toLowerCase();
  if (ctx.username && ctx.username.length >= 3 && low.includes(ctx.username.toLowerCase())) return 'err.passwordPersonal';
  if (ctx.mobile && low.includes(ctx.mobile)) return 'err.passwordPersonal';
  return null;
}

export const mobileSchema = z.string().regex(/^[6-9]\d{9}$/);
