import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not configured');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
  return k;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(enc: string | null | undefined): string {
  if (!enc) return '';
  const [v, iv, tag, ct] = enc.split('.');
  if (v !== 'v1') throw new Error('Unknown ciphertext version');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function maskMobile(m: string): string {
  return m.length === 10 ? `${m.slice(0, 2)}******${m.slice(8)}` : '**********';
}
