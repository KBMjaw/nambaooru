import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { findDuplicates } from '@/lib/duplicates';

const Schema = z.object({
  categoryCode: z.string().max(40),
  localBodyId: z.number().int().positive(),
  wardId: z.number().int().positive().nullable(),
  streetId: z.number().int().positive().nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  text: z.string().max(4000),
  imageHash: z.string().regex(/^[0-9a-f]{16}$/).nullable().optional(),
});

export const POST = route(async (req) => {
  await requireApiUser('PUBLIC', 'complaint.create');
  const d = await body(req, Schema);
  const [cat] = await sql`SELECT id FROM complaint_categories WHERE code = ${d.categoryCode}`;
  if (!cat) return { candidates: [] };
  const candidates = await findDuplicates({ ...d, categoryId: cat.id as number });
  return { candidates };
});
