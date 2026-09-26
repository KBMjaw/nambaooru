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

/**
 * Plain-text fields that end up on maps and labels (e.g. ward-map feature names). Markup, event-handler
 * attributes, script URLs and control characters are rejected outright; the UI still renders these values
 * as text, so this is defence in depth rather than the only barrier.
 */
export function unsafeTextIssue(s: string): string | null {
  if (/[<>]/.test(s)) return 'HTML is not allowed';
  if (/(javascript|vbscript|data)\s*:/i.test(s)) return 'Script URLs are not allowed';
  if (/\bon[a-z]+\s*=/i.test(s)) return 'Event handler attributes are not allowed';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) return 'Control characters are not allowed';
  return null;
}

export const safeText = (max: number) => z.string().trim().max(max).superRefine((s, ctx) => {
  const issue = unsafeTextIssue(s);
  if (issue) ctx.addIssue({ code: 'custom', message: issue });
});
