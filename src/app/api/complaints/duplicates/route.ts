import { z } from 'zod';
import { route, body } from '@/lib/api';
import { sql } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { findDuplicates } from '@/lib/duplicates';
import { rateLimit } from '@/lib/ratelimit';
import { supportToken } from '@/lib/support-token';

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
  const u = await requireApiUser('PUBLIC', 'complaint.create');
  await rateLimit(`dups:${u.id}`, 60, 3600);
  const d = await body(req, Schema);
  const [cat] = await sql`SELECT id, name_en, name_ta FROM complaint_categories WHERE code = ${d.categoryCode}`;
  if (!cat) return { candidates: [] };
  const candidates = await findDuplicates({ ...d, categoryId: cat.id as number });
  // Each offered complaint carries a token that lets this citizen, and only this citizen, join it.
  // Offers go to a different citizen, so they carry public facts only: the stored summary (which an AI engine may
  // phrase from the reporter's own words) is replaced by a neutral category + place description.
  return {
    candidates: candidates.map((c) => ({
      ...c,
      summaryEn: [cat.name_en, [c.street, c.wardNumber != null ? `Ward ${c.wardNumber}` : null].filter(Boolean).join(', ')].filter(Boolean).join(' at '),
      summaryTa: [[c.streetTa, c.wardNumber != null ? `வார்டு ${c.wardNumber}` : null].filter(Boolean).join(', '), cat.name_ta].filter(Boolean).join(' – '),
      supportToken: supportToken(u.id, c.id),
    })),
  };
});
