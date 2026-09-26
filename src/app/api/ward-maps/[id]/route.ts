import { z } from 'zod';
import { route, body } from '@/lib/api';
import { requireApiStaffFor } from '@/lib/auth';
import { FeatureUpdate, updateFeature } from '@/lib/ward-maps';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'), 'wardmap.edit');
  return updateFeature(u, z.coerce.number().int().positive().parse((await params).id), await body(req, FeatureUpdate));
});
