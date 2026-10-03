import { route } from '@/lib/api';
import { citizenHandlers } from '@/lib/citizen-routes';

const h = citizenHandlers('OFFICE');
export const GET = route(h.list);
export const POST = route(h.create);
