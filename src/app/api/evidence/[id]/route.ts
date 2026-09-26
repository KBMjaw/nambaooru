import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { getUser } from '@/lib/auth';
import { complaintScope } from '@/lib/scope';
import { forbidden, notFound, unauthorized } from '@/lib/errors';

const CITIZEN_KINDS = ['CITIZEN', 'COMPLETION', 'PROGRESS', 'BEFORE_WORK', 'APPEAL'];
const SAFE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };

/** Evidence is never public: served only to the complaint owner or to officials whose jurisdiction covers the complaint. */
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
    // Citizens: only the person who reported the complaint. Supporters see the public summary, never evidence.
    // Internal field records (inspection, verification, action work) stay with officials.
    if (citizen && citizen.id === e.citizen_id && CITIZEN_KINDS.includes(e.kind as string)) allowed = true;
  }
  if (!allowed) throw forbidden();
  // Only media types that passed magic-byte sniffing at upload are ever served; anything else is sent as a download.
  const mime = SAFE_TYPES[e.mime_type as string];
  return new Response(new Uint8Array(e.data as Buffer), {
    headers: {
      'Content-Type': mime ? (e.mime_type as string) : 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${mime ? 'inline' : 'attachment'}; filename="evidence-${e.id}.${mime ?? 'bin'}"`,
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'none'; script-src 'none'; frame-ancestors 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
});
