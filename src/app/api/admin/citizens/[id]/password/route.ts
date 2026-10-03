import { route } from '@/lib/api';
import { citizenHandlers } from '@/lib/citizen-routes';

type Ctx = { params: Promise<{ id: string }> };
export const POST = route<Ctx>(async (req, { params }) => citizenHandlers('ADMIN').password(req, (await params).id));
