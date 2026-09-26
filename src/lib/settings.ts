import 'server-only';
import { sql } from './db';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = ${key}`;
    return rows.length ? (rows[0].value as T) : fallback;
  } catch {
    return fallback;
  }
}
