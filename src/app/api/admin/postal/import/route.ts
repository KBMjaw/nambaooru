import { route } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { badRequest } from '@/lib/errors';
import { importPostal } from '@/lib/postal-import';

/** Import/update postal master data from CSV (Place, Pincode, District) without code changes. */
export const POST = route(async (req) => {
  const u = await requireApiUser('ADMIN', 'location.manage');
  const fd = await req.formData();
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) throw badRequest('CSV file required');
  if (file.size > 4 * 1024 * 1024) throw badRequest('CSV too large (max 4 MB)');
  const text = await file.text();
  if (/[\u0000-\u0008]/.test(text.slice(0, 2000))) throw badRequest('File does not look like CSV text');
  const result = await importPostal(sql, text, {
    name: String(fd.get('name') || file.name).slice(0, 200),
    description: String(fd.get('description') ?? '').slice(0, 1000) || undefined,
    referenceUrl: String(fd.get('referenceUrl') ?? '').slice(0, 500) || undefined,
    fileName: file.name.slice(0, 200),
    importedBy: u.id,
  });
  await audit(u, { action: 'POSTAL_IMPORT', entityType: 'data_source', entityId: String(result.sourceId), newValue: { ...result, errors: result.errors.length } });
  return result;
});
