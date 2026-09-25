import { route } from '@/lib/api';
import { userHandlers } from '@/lib/user-routes';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route<Ctx>(async (req, { params }) => userHandlers('ADMIN').permissions(req, (await params).id));
