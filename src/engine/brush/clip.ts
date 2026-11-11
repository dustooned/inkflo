// Vendored from 2Dope src/brush/clip.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/** Selection clipping for raster painting: a document-pixel mask (1 = selected) as a stencil. */

/** True when any pixel of the rect is selected. Pure; used as a cheap early-out. */
export function anySelected(mask: Uint8Array, width: number, rect: { x: number; y: number; w: number; h: number }): boolean {
  if (width <= 0) return false;
  const height = Math.floor(mask.length / width);
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w)), y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  if (!(x1 > x0) || !(y1 > y0)) return false;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) if (mask[row + x]) return true;
  }
  return false;
}

/** 1-bit alpha canvas of a document mask (255 inside, 0 outside). Reused per stroke. */
export function maskCanvas(mask: Uint8Array, width: number, height: number, into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = into ?? document.createElement('canvas');
  if (c.width !== width || c.height !== height) {
    c.width = width;
    c.height = height;
  }
  const g = c.getContext('2d')!;
  const img = g.createImageData(width, height);
  const px = img.data;
  for (let i = 0, n = Math.min(mask.length, width * height); i < n; i++) if (mask[i]) px[i * 4 + 3] = 255;
  g.putImageData(img, 0, 0);
  return c;
}
