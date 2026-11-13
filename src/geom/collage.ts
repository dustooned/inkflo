import type { PlacedImage, Pt } from '../doc/model';

/**
 * Collage cut-outs (zines, photo collage, pasted-up pages). A cut is stored in image units —
 * x and y in −0.5…0.5 of the placed width and height around the image centre — so the piece
 * follows every move, scale and rotation, and the renderer, exports and PSD all draw the same.
 */

/** A page point (inches) in the image's own units. */
export function toImageUnits(image: PlacedImage, p: Pt): Pt {
  const a = -image.rotation * Math.PI / 180;
  const dx = p.x - image.x, dy = p.y - image.y;
  return { x: (dx * Math.cos(a) - dy * Math.sin(a)) / image.width, y: (dx * Math.sin(a) + dy * Math.cos(a)) / image.height };
}

/** Repeatable noise in −1…1 for torn edges (the same cut always tears the same way). */
function noise(i: number, seed: number): number {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * The cut outline in pixels relative to the image centre, for an image drawn `scale` px per inch.
 * `torn` subdivides each edge and pushes the points in and out like ripped paper.
 */
export function cutoutPath(image: PlacedImage, scale: number): Pt[] {
  const cut = image.cutout;
  if (!cut || cut.length < 3) return [];
  const w = image.width * scale, h = image.height * scale;
  const pts = cut.map((q) => ({ x: q.x * w, y: q.y * h }));
  const torn = Math.max(0, Math.min(1, image.torn ?? 0));
  if (!torn) return pts;
  const step = Math.max(2, 0.06 * scale);
  const depth = 0.05 * scale * torn;
  const out: Pt[] = [];
  let k = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    const nx = -(b.y - a.y) / (len || 1), ny = (b.x - a.x) / (len || 1);
    for (let j = 0; j < n; j++, k++) {
      const t = j / n;
      const d = j === 0 ? 0 : noise(k, cut.length) * depth;
      out.push({ x: a.x + (b.x - a.x) * t + nx * d, y: a.y + (b.y - a.y) * t + ny * d });
    }
  }
  return out;
}

/** Keep a cut sensible: inside a margin around the image, with no consecutive duplicates. */
export function cleanCutout(points: readonly Pt[]): Pt[] | null {
  const out: Pt[] = [];
  for (const p of points) {
    const q = { x: Math.max(-0.6, Math.min(0.6, p.x)), y: Math.max(-0.6, Math.min(0.6, p.y)) };
    const last = out.at(-1);
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 0.002) out.push(q);
  }
  if (out.length > 1024) {
    const keep = Math.ceil(out.length / 1024);
    return cleanCutout(out.filter((_, i) => i % keep === 0));
  }
  return out.length >= 3 ? out : null;
}
