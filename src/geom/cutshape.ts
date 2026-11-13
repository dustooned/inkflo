import type { Pt } from '../doc/model';
import { editShape, fitCircle, pathLength, recognizeShape, resample, shapeOutline, simplify, type Shape } from '../engine/core/quickshape';

/**
 * Auto Shape for the Layout knife: hold at the end of a cut and it snaps to the cleanest shape it
 * looks like. Open shapes only (a cut runs from one side to another):
 *
 * - **line**: a straight gutter;
 * - **arc**: a clean curve of one radius;
 * - **polyline**: a crisp zig-zag (2 to 5 corners) for jagged or dynamic panel edges;
 * - **smooth**: anything else keeps its course with the hand wobble taken out.
 *
 * Recognition runs in screen pixels (`scale` = pixels per inch), so it behaves the same at any
 * zoom. Points come back in page inches. Pure geometry, no DOM.
 */

export type CutShapeKind = 'line' | 'arc' | 'polyline' | 'smooth';

export interface CutShape {
  kind: CutShapeKind;
  /** The QuickShape it came from (absent for smooth). */
  shape?: Shape;
  /** The cut path in page inches. */
  pts: Pt[];
}

export const CUT_SHAPE_LABEL: Record<CutShapeKind, string> = {
  line: 'Straight line', arc: 'Arc', polyline: 'Zig-zag', smooth: 'Smooth curve',
};

const toPx = (pts: readonly Pt[], k: number) => pts.map((p) => ({ x: p.x * k, y: p.y * k }));
const toIn = (pts: readonly Pt[], k: number) => pts.map((p) => ({ x: p.x / k, y: p.y / k }));

/** The stroke with the hand wobble removed: resampled, then relaxed with its ends held. */
export function smoothCut(trail: readonly Pt[], scale: number): Pt[] {
  if (trail.length < 3) return trail.map((p) => ({ ...p }));
  const px = toPx(trail, scale);
  const n = Math.max(12, Math.min(160, Math.round(pathLength(px) / 6)));
  let pts = resample(px, n);
  for (let pass = 0; pass < 6; pass++) {
    pts = pts.map((p, i) => i === 0 || i === pts.length - 1 ? p : {
      x: (pts[i - 1]!.x + 2 * p.x + pts[i + 1]!.x) / 4,
      y: (pts[i - 1]!.y + 2 * p.y + pts[i + 1]!.y) / 4,
    });
  }
  return toIn(pts, scale);
}

function fromShape(shape: Shape, scale: number): CutShape | null {
  if (shape.kind !== 'line' && shape.kind !== 'arc' && shape.kind !== 'polyline') return null;
  const pts = shape.kind === 'line' ? [shape.a, shape.b] : shapeOutline(shape, 3);
  return { kind: shape.kind, shape, pts: toIn(pts, scale) };
}

/**
 * Real corners survive a much tighter tolerance; a wavy curve needs many more points there.
 * The recognizer's own tolerance (6% of the size) would read a gentle S-curve as a zig-zag.
 */
function sharpCorners(px: readonly Pt[], corners: number): boolean {
  const p = resample(px, 96);
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return simplify(p, Math.max(1.5, 0.01 * diag)).length <= corners + 2;
}

/** The shape a held knife stroke snaps to. Never null for a stroke of two or more points. */
export function recognizeCut(trail: readonly Pt[], scale: number): CutShape {
  const px = toPx(trail, scale);
  let shape = trail.length >= 2 ? recognizeShape(px) : null;
  // QuickShape calls anything within 7% of its length straight. Across a page that swallows a
  // deliberate zig-zag or bow, so a cut is straight only within 3%; otherwise look again.
  if (shape?.kind === 'line' && deviation(px) > 0.03 * Math.hypot(px.at(-1)!.x - px[0]!.x, px.at(-1)!.y - px[0]!.y)) shape = bentShape(px);
  if (shape?.kind === 'polyline' && !sharpCorners(px, shape.pts.length)) shape = null;
  return (shape && fromShape(shape, scale)) ?? { kind: 'smooth', pts: smoothCut(trail, scale) };
}

/** Furthest distance of the stroke from the chord between its ends (pixels). */
function deviation(px: readonly Pt[]): number {
  const a = px[0]!, b = px.at(-1)!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.max(...px.map((q) => Math.abs((b.x - a.x) * (a.y - q.y) - (a.x - q.x) * (b.y - a.y)) / len));
}

/** A not-quite-straight cut: a zig-zag when it has real corners, else an arc when one fits. */
function bentShape(px: readonly Pt[]): Shape | null {
  const p = resample(px, 96);
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pts = simplify(p, Math.max(3, 0.04 * diag));
  if (pts.length >= 3 && pts.length <= 7 && sharpCorners(px, pts.length)) return { kind: 'polyline', pts };
  const c = fitCircle(p);
  if (!c || c.r > 4 * diag) return null;
  const rms = Math.sqrt(p.reduce((sum, q) => sum + (Math.hypot(q.x - c.cx, q.y - c.cy) - c.r) ** 2, 0) / p.length);
  if (rms > 0.06 * c.r) return null;
  const start = Math.atan2(p[0]!.y - c.cy, p[0]!.x - c.cx);
  let sweep = 0;
  for (let i = 1; i < p.length; i++) {
    let d = Math.atan2(p[i]!.y - c.cy, p[i]!.x - c.cx) - Math.atan2(p[i - 1]!.y - c.cy, p[i - 1]!.x - c.cx);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    sweep += d;
  }
  return { kind: 'arc', cx: c.cx, cy: c.cy, r: c.r, start, sweep };
}

/**
 * The snapped cut after the pen moved from `grab` to `now` while still held (page inches). The
 * start stays put and the end follows the pen; a smooth curve bends along its length to meet it.
 */
export function adjustCut(cut: CutShape, grab: Pt, now: Pt, scale: number): CutShape {
  if (cut.shape) {
    const [g, n] = toPx([grab, now], scale);
    return fromShape(editShape(cut.shape, g!, n!), scale) ?? cut;
  }
  const dx = now.x - grab.x, dy = now.y - grab.y;
  const last = cut.pts.length - 1 || 1;
  return { kind: 'smooth', pts: cut.pts.map((p, i) => ({ x: p.x + dx * i / last, y: p.y + dy * i / last })) };
}
