import type { PixelTransform, Pt } from '../doc/model';
import { clipRect, transformedRect, unionRect, type Mat, type Rect } from '../engine/core/selxform';
import { polygonMask } from '../engine/fill/fill';

export const IDENTITY_MATRIX: Mat = [1, 0, 0, 1, 0, 0];

/** Apply the inner matrix first, then the outer one. */
export function composeMatrix(outer: Mat, inner: Mat): PixelTransform['matrix'] {
  const [a, b, c, d, x, y] = outer;
  const [e, f, g, h, u, v] = inner;
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h, a * u + c * v + x, b * u + d * v + y];
}

export const isUnmoved = (m: Mat): boolean => m.every((v, i) => Math.abs(v - IDENTITY_MATRIX[i]!) < 1e-9);

export interface LiftedPixels {
  rect: Rect;
  pixels: HTMLCanvasElement;
  mask: HTMLCanvasElement;
}

const canvasContext = (w: number, h: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d')!;
};

/** Lift selected nontransparent pixels. The mask has hard edges at pixel centres. */
export function liftPixels(source: HTMLCanvasElement, polygon: Pt[], dpi: number): LiftedPixels | null {
  const xs = polygon.map((p) => p.x * dpi), ys = polygon.map((p) => p.y * dpi);
  const rect = clipRect(Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys)), source.width, source.height);
  if (!rect) return null;
  const { x, y, w, h } = rect;
  const area = polygonMask(xs.map((px, i) => [px - x, ys[i]! - y]), w, h);
  if (!area) return null;
  const sourcePixels = source.getContext('2d')!.getImageData(x, y, w, h);
  let left = w, top = h, right = -1, bottom = -1;
  for (let row = area.y0; row <= area.y1; row++) {
    for (let col = area.x0; col <= area.x1; col++) {
      const i = row * w + col;
      if (!area.mask[i] || !sourcePixels.data[i * 4 + 3]) continue;
      left = Math.min(left, col); right = Math.max(right, col);
      top = Math.min(top, row); bottom = row;
    }
  }
  if (right < 0) return null;
  const width = right - left + 1, height = bottom - top + 1;
  const lifted = canvasContext(width, height), erase = canvasContext(width, height);
  const pixels = lifted.createImageData(width, height), mask = erase.createImageData(width, height);
  const src = new Uint32Array(sourcePixels.data.buffer);
  const dst = new Uint32Array(pixels.data.buffer);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row + top) * w + col + left;
      if (!area.mask[i] || !sourcePixels.data[i * 4 + 3]) continue;
      const j = row * width + col;
      dst[j] = src[i]!;
      mask.data[j * 4 + 3] = 255;
    }
  }
  lifted.putImageData(pixels, 0, 0);
  erase.putImageData(mask, 0, 0);
  return { rect: { x: x + left, y: y + top, w: width, h: height }, pixels: lifted.canvas, mask: erase.canvas };
}

function pixelMatrix(m: Mat, dpi: number): Mat {
  return [m[0], m[1], m[2], m[3], m[4] * dpi, m[5] * dpi];
}

export function transformDestination(lifted: LiftedPixels, m: Mat, dpi: number, w: number, h: number): Rect | null {
  const r = lifted.rect;
  return transformedRect(pixelMatrix(m, dpi), { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 }, w, h);
}

export function paintPixelTransform(g: CanvasRenderingContext2D, lifted: LiftedPixels, m: Mat, dpi: number, copy = false): Rect | null {
  if (isUnmoved(m)) return null;
  const { x, y } = lifted.rect;
  g.save();
  if (!copy) {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(lifted.mask, x, y);
  }
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'low';
  g.transform(...pixelMatrix(m, dpi));
  g.drawImage(lifted.pixels, x, y);
  g.restore();
  return unionRect(lifted.rect, transformDestination(lifted, m, dpi, g.canvas.width, g.canvas.height));
}
