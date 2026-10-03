import { z } from 'zod';
import { route } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { badRequest } from '@/lib/errors';
import { runBulkImport } from '@/lib/bulk-users';

export const maxDuration = 60;

/** Validate or import a CSV / Excel file of users. */
export const POST = route(async (req) => {
  const u = await requireApiUser('ADMIN', 'user.bulk_upload');
  await rateLimit(`bulk:${u.id}`, 30, 3600);
  const fd = await req.formData();
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) throw badRequest('Choose a CSV or Excel file');
  if (file.size > 3 * 1024 * 1024) throw badRequest('File too large (max 3 MB)');
  const mode = z.enum(['VALIDATE', 'ALL_OR_NOTHING', 'VALID_ONLY']).parse(fd.get('mode') ?? 'VALIDATE');
  return runBulkImport(u, file, mode);
});
