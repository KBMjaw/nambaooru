import { route } from '@/lib/api';
import { userHandlers } from '@/lib/user-routes';

const h = userHandlers('ADMIN');
export const GET = route(h.list);
export const POST = route(h.create);
