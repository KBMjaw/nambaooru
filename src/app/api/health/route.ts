import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Liveness + database connectivity probe (no sensitive detail exposed). */
export async function GET() {
  try {
    await sql`SELECT 1`;
    return NextResponse.json({ ok: true, db: 'up' });
  } catch (e) {
    console.error('[health]', (e as Error).message);
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  }
}
