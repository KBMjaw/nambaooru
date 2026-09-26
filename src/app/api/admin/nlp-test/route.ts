import { z } from 'zod';
import { route, body } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { analyzeComplaint } from '@/lib/nlp/service';

export const POST = route(async (req) => {
  await requireApiUser('ADMIN', ['masterdata.manage', 'settings.manage']);
  const { text } = await body(req, z.object({ text: z.string().min(2).max(2000) }));
  return { analysis: await analyzeComplaint(text) };
});
