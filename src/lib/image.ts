'use client';

/** Re-encode an image on the device: resizes, strips EXIF/metadata, and keeps uploads small. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<{ file: File; hash: string; url: string }> {
  const bitmap = await createImageBitmap(file).catch(async () => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img as unknown as ImageBitmap;
  });
  const w0 = (bitmap as ImageBitmap).width;
  const h0 = (bitmap as ImageBitmap).height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', quality));
  const out = new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg', { type: 'image/jpeg' });
  return { file: out, hash: averageHash(bitmap as CanvasImageSource), url: URL.createObjectURL(out) };
}

/** 64-bit average hash (hex) — lets the server spot near-identical photos for duplicate detection. */
export function averageHash(src: CanvasImageSource): string {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  const g: number[] = [];
  for (let i = 0; i < 64; i++) g.push(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  const avg = g.reduce((a, b) => a + b, 0) / 64;
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) n = (n << 1) | (g[i + k] >= avg ? 1 : 0);
    hex += n.toString(16);
  }
  return hex;
}

export interface Geo { latitude: number; longitude: number; accuracy: number; at: string }

export function getLocation(): Promise<Geo> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), at: new Date(p.timestamp).toISOString() }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  });
}
