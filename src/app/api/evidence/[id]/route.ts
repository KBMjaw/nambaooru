import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { getUser } from '@/lib/auth';
import { complaintScope } from '@/lib/scope';
import { forbidden, notFound, unauthorized } from '@/lib/errors';

/** Evidence is never public: served only to the complaint owner / supporters or officials within jurisdiction. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) throw notFound();
  const [e] = await sql`SELECT e.id, e.kind, e.mime_type, e.data, e.complaint_id, c.citizen_id FROM complaint_evidence e
                        JOIN complaints c ON c.id = e.complaint_id WHERE e.id = ${id}`;
  if (!e) throw notFound();

  let allowed = false;
  const staffUsers = [await getUser('OFFICE'), await getUser('ADMIN')].filter((x) => x != null);
  const staff = staffUsers[0] ?? null;
  for (const su of staffUsers) {
    const r = await sql`SELECT 1 FROM complaints c WHERE c.id = ${e.complaint_id} AND (${complaintScope(su)})`;
    if (r.length) { allowed = true; break; }
  }
  if (!allowed) {
    const citizen = await getUser('PUBLIC');
    if (!staff && !citizen) throw unauthorized();
    if (citizen) {
      if (citizen.id === e.citizen_id) allowed = true;
      else if (['CITIZEN', 'COMPLETION'].includes(e.kind as string)) {
        const s = await sql`SELECT 1 FROM complaint_supporters WHERE complaint_id = ${e.complaint_id} AND user_id = ${citizen.id}`;
        allowed = s.length > 0;
      }
    }
  }
  if (!allowed) throw forbidden();
  return new Response(new Uint8Array(e.data as Buffer), {
    headers: {
      'Content-Type': e.mime_type as string,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
    },
  });
});
