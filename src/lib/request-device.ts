import 'server-only';
import { headers } from 'next/headers';
import { isMobileUA } from './completion-policy';

/** Whether the current page request comes from a mobile browser (decides live-photo-only completion forms). */
export async function requestIsMobile() {
  const h = await headers();
  return isMobileUA(h.get('sec-ch-ua-mobile'), h.get('user-agent'));
}
