import { z } from 'zod';
import { route } from '@/lib/api';
import { requireApiStaffFor } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { num } from '@/lib/evidence';
import { ActionUpdate, updateAction } from '@/lib/complaint-actions';

type Ctx = { params: Promise<{ code: string; id: string }> };

/** Edit / progress / verify / cancel an action. JSON, or multipart with `data` + optional `photo` evidence. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireApiStaffFor(req.nextUrl.searchParams.get('portal'));
  await rateLimit(`actions:${u.id}`, 300, 3600);
  const { code, id } = await params;
  let raw: Record<string, unknown> = {};
  let photo: File | null = null;
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const fd = await req.formData();
    raw = JSON.parse(String(fd.get('data') ?? '{}'));
    const f = fd.get('photo');
    photo = f instanceof File && f.size > 0 ? f : null;
  } else raw = await req.json().catch(() => ({}));
  const d = ActionUpdate.parse(raw);
  const geo = { latitude: num(raw.latitude as never), longitude: num(raw.longitude as never), accuracy: num(raw.accuracy as never) };
  return updateAction(u, decodeURIComponent(code), z.coerce.number().int().positive().parse(id), d, photo, geo);
});
