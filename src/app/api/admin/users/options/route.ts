import { route } from '@/lib/api';
import { userHandlers } from '@/lib/user-routes';

export const GET = route(userHandlers('ADMIN').options);
