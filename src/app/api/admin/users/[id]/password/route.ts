import { route } from '@/lib/api';
import { userHandlers } from '@/lib/user-routes';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route<Ctx>(async (req, { params }) => userHandlers('ADMIN').password(req, (await params).id));
