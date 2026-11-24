import type { PixelTransform, Pt, SelectionStep } from '../doc/model';
import { clipRect, transformedRect, unionRect, type Mat, type Rect } from '../engine/core/selxform';
import { polygonMask } from '../engine/fill/fill';
import { meshBounds, type Mesh } from '../geom/meshwarp';
import { buildMask, maskBounds, type Mask } from './selmask';

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
  // a rectangle that covers the whole region (Whole layer, a box round everything) needs no rasterising
  const covers = polygon.length === 4 && Math.min(...xs) <= x && Math.max(...xs) >= x + w && Math.min(...ys) <= y && Math.max(...ys) >= y + h &&
    polygon.every((p, i) => p.x === polygon[(i + 1) % 4]!.x || p.y === polygon[(i + 1) % 4]!.y);
  const area = covers ? { mask: new Uint8Array(w * h).fill(1), x0: 0, y0: 0, x1: w - 1, y1: h - 1 } : polygonMask(xs.map((px, i) => [px - x, ys[i]! - y]), w, h);
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

/**
 * A smaller copy of the lifted art, for a live preview while it is being dragged: every pixel
 * measure is multiplied by `k` (paint it with `dpi * k`). Nothing saved ever comes from this.
 */
/**
 * Lift through a soft selection mask: each pixel comes out as much of itself as the mask covers, and the same
 * amount is taken from where it was, so nothing is created or lost by feathering.
 */
export function liftMask(source: HTMLCanvasElement, mask: Mask): LiftedPixels | null {
  const b = maskBounds(mask);
  if (!b) return null;
  const rect = clipRect(b.x0, b.y0, b.x1 + 1, b.y1 + 1, source.width, source.height);
  if (!rect) return null;
  const { x, y, w, h } = rect;
  const src = source.getContext('2d')!.getImageData(x, y, w, h).data;
  let left = w, top = h, right = -1, bottom = -1;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!mask.data[(row + y) * mask.w + col + x] || !src[(row * w + col) * 4 + 3]) continue;
      left = Math.min(left, col); right = Math.max(right, col);
      top = Math.min(top, row); bottom = row;
    }
  }
  if (right < 0) return null;
  const width = right - left + 1, height = bottom - top + 1;
  const lifted = canvasContext(width, height), erase = canvasContext(width, height);
  const pixels = lifted.createImageData(width, height), cover = erase.createImageData(width, height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const m = mask.data[(row + top + y) * mask.w + col + left + x]!;
      const from = ((row + top) * w + col + left) * 4, to = (row * width + col) * 4;
      if (!m || !src[from + 3]) continue;
      pixels.data[to] = src[from]!; pixels.data[to + 1] = src[from + 1]!; pixels.data[to + 2] = src[from + 2]!;
      pixels.data[to + 3] = Math.round(src[from + 3]! * m / 255);
      cover.data[to + 3] = m;
    }
  }
  lifted.putImageData(pixels, 0, 0);
  erase.putImageData(cover, 0, 0);
  return { rect: { x: x + left, y: y + top, w: width, h: height }, pixels: lifted.canvas, mask: erase.canvas };
}

/** Lift whatever a selection recipe selects. One polygon is the plain hard-edged lift; anything more goes through a mask. */
export function liftRecipe(source: HTMLCanvasElement, steps: readonly SelectionStep[], dpi: number): LiftedPixels | null {
  const only = steps.length === 1 ? steps[0]! : null;
  if (only && only.op === 'replace' && only.shape.kind === 'polygon') return liftPixels(source, only.shape.pts, dpi);
  const mask = buildMask(steps, source.width, source.height, dpi, () => source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data);
  return mask ? liftMask(source, mask) : null;
}

export function downscaleLifted(lifted: LiftedPixels, k: number): LiftedPixels {
  const { x, y, w, h } = lifted.rect;
  const lw = Math.max(1, Math.round(w * k)), lh = Math.max(1, Math.round(h * k));
  const shrink = (src: HTMLCanvasElement) => {
    const g = canvasContext(lw, lh);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, lw, lh);
    return g.canvas;
  };
  return { rect: { x: x * k, y: y * k, w: lw, h: lh }, pixels: shrink(lifted.pixels), mask: shrink(lifted.mask) };
}

export function downscaleCanvas(source: HTMLCanvasElement, k: number): HTMLCanvasElement {
  const g = canvasContext(Math.max(1, Math.round(source.width * k)), Math.max(1, Math.round(source.height * k)));
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, g.canvas.width, g.canvas.height);
  return g.canvas;
}

function pixelMatrix(m: Mat, dpi: number): Mat {
  return [m[0], m[1], m[2], m[3], m[4] * dpi, m[5] * dpi];
}

export function transformDestination(lifted: LiftedPixels, m: Mat, dpi: number, w: number, h: number, mesh?: Mesh | null): Rect | null {
  const r = lifted.rect;
  if (mesh) {
    const b = meshBounds(mesh);
    return clipRect(Math.floor(b.x0 * dpi) - 2, Math.floor(b.y0 * dpi) - 2, Math.ceil(b.x1 * dpi) + 2, Math.ceil(b.y1 * dpi) + 2, w, h);
  }
  return transformedRect(pixelMatrix(m, dpi), { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 }, w, h);
}

/**
 * Draw `image` through a mesh: each cell of the source becomes two triangles, each carried by its own
 * affine map. `mesh.pts` are destination pixels; the source is the whole image, cut into cols × rows cells.
 */
export function drawMesh(g: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, mesh: Mesh): void {
  const { cols, rows, pts } = mesh, w = cols + 1;
  const sw = image.width / cols, sh = image.height / rows;
  const tri = (s: [number, number][], d: { x: number; y: number }[]) => {
    const [s0, s1, s2] = s as [[number, number], [number, number], [number, number]];
    const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
    const det = sx1 * sy2 - sx2 * sy1;
    if (!det) return;
    const dx1 = d[1]!.x - d[0]!.x, dy1 = d[1]!.y - d[0]!.y, dx2 = d[2]!.x - d[0]!.x, dy2 = d[2]!.y - d[0]!.y;
    const a = (dx1 * sy2 - dx2 * sy1) / det, c = (dx2 * sx1 - dx1 * sx2) / det;
    const b = (dy1 * sy2 - dy2 * sy1) / det, e = (dy2 * sx1 - dy1 * sx2) / det;
    // grow the clip a little so neighbouring cells overlap and no seam shows
    const cx = (d[0]!.x + d[1]!.x + d[2]!.x) / 3, cy = (d[0]!.y + d[1]!.y + d[2]!.y) / 3;
    g.save();
    g.beginPath();
    d.forEach((q, i) => {
      const len = Math.hypot(q.x - cx, q.y - cy) || 1, k = 0.7 / len;
      const x = q.x + (q.x - cx) * k, y = q.y + (q.y - cy) * k;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.closePath();
    g.clip();
    g.transform(a, b, c, e, d[0]!.x - a * s0[0] - c * s0[1], d[0]!.y - b * s0[0] - e * s0[1]);
    g.drawImage(image, 0, 0);
    g.restore();
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p00 = pts[j * w + i]!, p10 = pts[j * w + i + 1]!, p01 = pts[(j + 1) * w + i]!, p11 = pts[(j + 1) * w + i + 1]!;
      const x0 = i * sw, x1 = (i + 1) * sw, y0 = j * sh, y1 = (j + 1) * sh;
      tri([[x0, y0], [x1, y0], [x0, y1]], [p00, p10, p01]);
      tri([[x1, y1], [x0, y1], [x1, y0]], [p11, p01, p10]);
    }
  }
}

export function paintPixelTransform(g: CanvasRenderingContext2D, lifted: LiftedPixels, m: Mat, dpi: number, copy = false, crisp = false, mesh: Mesh | null = null): Rect | null {
  if (!mesh && isUnmoved(m)) return null;
  const { x, y } = lifted.rect;
  g.save();
  if (!copy) {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(lifted.mask, x, y);
  }
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = !crisp;
  g.imageSmoothingQuality = 'high';
  if (mesh) drawMesh(g, lifted.pixels, { ...mesh, pts: mesh.pts.map((q) => ({ x: q.x * dpi, y: q.y * dpi })) });
  else {
    g.transform(...pixelMatrix(m, dpi));
    g.drawImage(lifted.pixels, x, y);
  }
  g.restore();
  return unionRect(lifted.rect, transformDestination(lifted, m, dpi, g.canvas.width, g.canvas.height, mesh));
}
