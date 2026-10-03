import { z } from 'zod';
import { route, body } from '@/lib/api';
import { requireApiStaffFor } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { wardMapData, FeatureInput, createFeature } from '@/lib/ward-maps';

export const GET = route(async (req) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'), ['wardmap.view', 'wardmap.edit']);
  return wardMapData(u, z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get('ward')));
});

export const POST = route(async (req) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'), 'wardmap.edit');
  await rateLimit(`wardmap:${u.id}`, 300, 3600);
  return createFeature(u, await body(req, FeatureInput));
});
