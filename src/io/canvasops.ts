// Adapted from 2Dope src/io/codec.ts @ 707f793 (isBlank, encodePng, decodePngInto), plus the
// browser PlaneOps that residency needs.

import { PASSES } from '../doc/model';
import type { PageArt, PlaneOps } from '../draw/residency';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** True when no pixel of the canvas has any paint (so the pass is not stored). */
export function isBlank(canvas: HTMLCanvasElement): boolean {
  if (!canvas.width || !canvas.height) return true;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return true;
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const px = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  for (let i = 0; i < px.length; i++) if (px[i] !== 0) return false;
  return true;
}

/**
 * Start encoding a canvas to PNG. `toBlob` snapshots the pixels at call time, so the returned
 * promise is safe to await even if the canvas changes right after.
 */
export function encodePng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('could not encode the page as PNG'));
        return;
      }
      blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, 'image/png');
  });
}

export async function decodePngInto(canvas: HTMLCanvasElement, bytes: Uint8Array): Promise<void> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
  try {
    const g = canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  } finally {
    bmp.close();
  }
}

const THUMB_W = 160;

/**
 * Stand-in thumbnail: the passes stacked on paper. Rule 5 says thumbnails come from the one page
 * renderer; replace this with `renderPage(page, { dpi, include })` once `render/` exists.
 */
function thumb(art: PageArt, into: HTMLCanvasElement | null): HTMLCanvasElement {
  const w = THUMB_W;
  const h = Math.max(1, Math.round((art.height / art.width) * w));
  const c = into ?? makeCanvas(w, h);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext('2d');
  if (!g) return c;
  g.fillStyle = '#F7F2E8'; // --paper-lift
  g.fillRect(0, 0, w, h);
  for (const p of PASSES) {
    const plane = art.planes[p];
    if (plane && plane.width) g.drawImage(plane, 0, 0, w, h);
  }
  return c;
}

export const browserPlaneOps: PlaneOps = {
  isBlank,
  encode: encodePng,
  decodeInto: decodePngInto,
  resize: (c, w, h) => {
    c.width = w;
    c.height = h;
  },
  newCanvas: makeCanvas,
  thumb,
  defer: (fn) => {
    // a message channel, not setTimeout: background tabs clamp timers to 1 s
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      fn();
    };
    ch.port2.postMessage(null);
  },
};
