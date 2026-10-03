import { route } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { buildTemplate } from '@/lib/bulk-users';

/** Download the bulk upload template (CSV, or Excel with reference lists and dropdowns). */
export const GET = route(async (req) => {
  const u = await requireApiUser('ADMIN', 'user.bulk_upload');
  const format = req.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const buf = await buildTemplate(u, format);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="nammaooru-users-template.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
});
