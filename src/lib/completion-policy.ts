/**
 * "Mark as completed" evidence rules (shared by the action API and the completion forms):
 *   - every completion needs a reference photo and the GPS location where it was taken;
 *   - higher-grade officers (Supervisor, Dept officer, EO and above) need GPS only, at any distance;
 *   - lower-grade staff (field staff, ward members) must be within FIELD_RADIUS_M of the complaint location,
 *     and on a mobile phone the photo must be a live camera photo (gallery upload only from a PC / laptop).
 * No server-only imports: the client forms use the same constants and distance check.
 */
export const HIGHER_GRADE_RANK = 60;
export const FIELD_RADIUS_M = 200;
/** A "live" photo was taken this recently (camera capture on the phone, just before submitting). */
export const LIVE_PHOTO_MAX_AGE_MS = 15 * 60 * 1000;

export interface CompletionPolicy {
  /** Lower grade: must stand within this many metres of the complaint (null = no distance limit) */
  maxDistanceM: number | null;
  /** Mobile + lower grade: only a live camera photo is accepted */
  liveOnly: boolean;
  mobile: boolean;
  /** Complaint location the distance is measured from (null when the complaint has no GPS) */
  target: { lat: number; lng: number } | null;
}

/** Per-photo capture details sent by the completion forms. */
export interface PhotoMeta { source: 'CAMERA' | 'FILE'; ageMs: number }

export function isHigherGrade(rank: number) {
  return rank >= HIGHER_GRADE_RANK;
}

export function completionPolicy(rank: number, mobile: boolean, lat: unknown, lng: unknown): CompletionPolicy {
  const higher = isHigherGrade(rank);
  const target = lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null;
  return { maxDistanceM: higher ? null : FIELD_RADIUS_M, liveOnly: !higher && mobile, mobile, target };
}

/** Mobile browser, from the client-hint header or the user agent. */
export function isMobileUA(chMobile: string | null, ua: string | null) {
  if (chMobile === '?1') return true;
  if (chMobile === '?0') return false;
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua ?? '');
}

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A photo counts as live when it came from the camera input and was taken within LIVE_PHOTO_MAX_AGE_MS. */
export function isLivePhoto(m: PhotoMeta | undefined) {
  return !!m && m.source === 'CAMERA' && Number.isFinite(m.ageMs) && m.ageMs >= -60_000 && m.ageMs <= LIVE_PHOTO_MAX_AGE_MS;
}
