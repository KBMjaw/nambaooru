import type { TFn } from '@/i18n';
import type { Geo } from '@/lib/image';
import { distanceM, isLivePhoto, type CompletionPolicy, type PhotoMeta } from '@/lib/completion-policy';

/** A picked photo and how it was captured (camera input or file / gallery picker, and the original file time). */
export interface PickedPhoto { file: File; url: string; source: PhotoMeta['source']; lastModified: number }

export const photoMeta = (photos: PickedPhoto[]): PhotoMeta[] => photos.map((p) => ({ source: p.source, ageMs: Date.now() - p.lastModified }));

export function distanceTo(policy: CompletionPolicy | undefined, geo: Geo | null) {
  if (!policy?.target || !geo) return null;
  return Math.round(distanceM(geo.latitude, geo.longitude, policy.target.lat, policy.target.lng));
}

/** Client-side copy of the server's completion checks, so the officer sees the problem before uploading. */
export function completionError(t: TFn, policy: CompletionPolicy | undefined, geo: Geo | null, photos: PickedPhoto[]): string | null {
  if (!geo) return t('field.needLocation');
  if (!policy) return null;
  const d = distanceTo(policy, geo);
  if (policy.maxDistanceM != null && d != null && d > policy.maxDistanceM) return t('complete.tooFarAt', { d, max: policy.maxDistanceM });
  if (policy.liveOnly && !photoMeta(photos).every((m) => isLivePhoto(m))) return t('complete.liveOnly');
  return null;
}

export function policyLines(t: TFn, policy: CompletionPolicy | undefined): string[] {
  if (!policy) return [];
  const out = [policy.maxDistanceM != null ? t('complete.policyField', { max: policy.maxDistanceM }) : t('complete.policyHigher')];
  if (policy.liveOnly) out.push(t('complete.policyLive'));
  if (policy.maxDistanceM != null && !policy.target) out.push(t('complete.noTarget'));
  return out;
}
