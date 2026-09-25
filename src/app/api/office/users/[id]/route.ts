import { route } from '@/lib/api';
import { userHandlers } from '@/lib/user-routes';

type Ctx = { params: Promise<{ id: string }> };
const h = userHandlers('OFFICE');
export const GET = route<Ctx>(async (_req, { params }) => h.detail((await params).id));
export const PATCH = route<Ctx>(async (req, { params }) => h.update(req, (await params).id));
