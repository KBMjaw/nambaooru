import 'server-only';
import { sql } from './db';
import { sha256Hex } from './crypto';
import { badRequest } from './errors';

const MAX_PHOTO = 3 * 1024 * 1024;
const MAX_VIDEO = 4 * 1024 * 1024; // Vercel request body limit is 4.5 MB

/** Identify file type from magic bytes — never trust the client-declared MIME type. */
export function sniff(buf: Buffer): { mime: string; media: 'PHOTO' | 'VIDEO' } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', media: 'PHOTO' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', media: 'PHOTO' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', media: 'PHOTO' };
  if (buf.toString('ascii', 4, 8) === 'ftyp') return { mime: 'video/mp4', media: 'VIDEO' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'video/webm', media: 'VIDEO' };
  return null;
}

export interface EvidenceMeta {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  capturedAt?: string | null;
  source?: 'CAMERA' | 'UPLOAD' | null;
  imageHash?: string | null;
}

const EXT: Record<'PHOTO' | 'VIDEO', string[]> = { PHOTO: ['jpg', 'jpeg', 'png', 'webp'], VIDEO: ['mp4', 'webm'] };
// Active content that must never be stored as evidence, whatever the file claims to be
const DANGEROUS_TYPE = /html|svg|xml|javascript|ecmascript|x-sh|x-msdownload|octet-stream\+exe/i;
const DANGEROUS_CONTENT = ['<script', '<html', '<?php', '<svg', '<iframe', '<object', '<embed', 'javascript:'];

export async function validateFile(file: File) {
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) throw badRequest('Unsupported or unsafe file type. Use JPG, PNG, WEBP, MP4 or WEBM.');
  if (kind.media === 'PHOTO' && buf.length > MAX_PHOTO) throw badRequest('Photo is too large (max 3 MB).');
  if (kind.media === 'VIDEO' && buf.length > MAX_VIDEO) throw badRequest('Video is too large (max 4 MB).');
  // The declared name / type must agree with the real content (camera blobs without an extension are fine)
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.name ?? '')?.[1]?.toLowerCase();
  if (ext && !EXT[kind.media].includes(ext)) throw badRequest('File extension does not match its content. Use JPG, PNG, WEBP, MP4 or WEBM.');
  if (file.type && DANGEROUS_TYPE.test(file.type)) throw badRequest('Unsupported or unsafe file type. Use JPG, PNG, WEBP, MP4 or WEBM.');
  // Reject polyglots: a media file must not carry script/HTML payloads anywhere in it
  const text = buf.toString('latin1').toLowerCase();
  if (DANGEROUS_CONTENT.some((m) => text.includes(m))) throw badRequest('File rejected by security scan.');
  return { buf, ...kind };
}

export async function storeEvidence(
  complaintId: number,
  kind: 'CITIZEN' | 'INSPECTION' | 'PROGRESS' | 'COMPLETION' | 'APPEAL' | 'ACTION',
  file: File,
  uploadedBy: string,
  meta: EvidenceMeta = {},
  appealId?: number | null,
  actionId?: number | null,
) {
  const v = await validateFile(file);
  const hash = meta.imageHash && /^[0-9a-f]{16}$/.test(meta.imageHash) ? meta.imageHash : null;
  const [row] = await sql`
    INSERT INTO complaint_evidence (complaint_id, kind, media_type, mime_type, size_bytes, sha256, image_hash, data,
      latitude, longitude, gps_accuracy_m, captured_at, capture_source, uploaded_by, appeal_id, action_id)
    VALUES (${complaintId}, ${kind}, ${v.media}, ${v.mime}, ${v.buf.length}, ${sha256Hex(v.buf)}, ${hash}, ${v.buf},
      ${meta.latitude ?? null}, ${meta.longitude ?? null}, ${meta.accuracy ?? null}, ${meta.capturedAt ?? null},
      ${meta.source ?? null}, ${uploadedBy}, ${appealId ?? null}, ${actionId ?? null})
    RETURNING id`;
  return row.id as number;
}

export function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
