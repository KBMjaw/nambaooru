import { route } from '@/lib/api';
import { userHandlers } from '@/lib/user-routes';

const h = userHandlers('OFFICE');
export const GET = route(h.list);
export const POST = route(h.create);
