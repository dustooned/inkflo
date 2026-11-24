import type { Pt } from '../doc/model';
import { boxCorners, type OBox } from './xformbox';

/**
 * Distort and Warp. Both reduce to one thing: a mesh. The source rectangle is cut into `cols` × `rows`
 * cells, and each grid vertex has a destination point. The art is drawn cell by cell (two triangles
 * each), so a perspective squeeze and a hand-pulled warp share the saved form and the renderer.
 * `pts` is row-major, (cols + 1) × (rows + 1), in document units.
 */
export interface Mesh {
  cols: number;
  rows: number;
  pts: Pt[];
}

/** Unit square (TL, TR, BR, BL) → quad, with perspective when the quad is not a parallelogram. */
export function unitToQuad(q: readonly Pt[]): (u: number, v: number) => Pt {
  const [p0, p1, p2, p3] = q as [Pt, Pt, Pt, Pt];
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    return (u, v) => ({ x: p0.x + (p1.x - p0.x) * u + (p3.x - p0.x) * v, y: p0.y + (p1.y - p0.y) * u + (p3.y - p0.y) * v });
  }
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

/** The four corners of a box as the art sits on it: flips swap which corner the art's corner lands on. */
export function artCorners(b: OBox): Pt[] {
  const [tl, tr, br, bl] = boxCorners(b) as [Pt, Pt, Pt, Pt];
  if (b.fx < 0 && b.fy < 0) return [br, bl, tl, tr];
  if (b.fx < 0) return [tr, tl, bl, br];
  if (b.fy < 0) return [bl, br, tr, tl];
  return [tl, tr, br, bl];
}

/** A mesh from a quad pulled by its four corners (perspective). */
export function distortMesh(quad: readonly Pt[], n = 12): Mesh {
  const at = unitToQuad(quad);
  const pts: Pt[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pts.push(at(i / n, j / n));
  return { cols: n, rows: n, pts };
}

const NODES = 4;

/** A 4 × 4 grid of nodes spread evenly across a quad (row-major): the Warp handles at rest. */
export function warpNodes(quad: readonly Pt[]): Pt[] {
  const at = unitToQuad(quad);
  const out: Pt[] = [];
  for (let j = 0; j < NODES; j++) for (let i = 0; i < NODES; i++) out.push(at(i / (NODES - 1), j / (NODES - 1)));
  return out;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** The smooth surface through a 4 × 4 node grid, at (u, v) in 0…1. */
export function warpAt(nodes: readonly Pt[], u: number, v: number): Pt {
  const span = (t: number) => {
    const s = Math.min(Math.max(t, 0), 1) * (NODES - 1);
    const i = Math.min(NODES - 2, Math.floor(s));
    return { i, t: s - i };
  };
  const a = span(u), b = span(v);
  const idx = (k: number) => Math.min(NODES - 1, Math.max(0, k));
  const row = (j: number) => {
    const at = (i: number) => nodes[idx(j) * NODES + idx(i)]!;
    return {
      x: catmull(at(a.i - 1).x, at(a.i).x, at(a.i + 1).x, at(a.i + 2).x, a.t),
      y: catmull(at(a.i - 1).y, at(a.i).y, at(a.i + 1).y, at(a.i + 2).y, a.t),
    };
  };
  const r = [row(b.i - 1), row(b.i), row(b.i + 1), row(b.i + 2)] as const;
  return { x: catmull(r[0].x, r[1].x, r[2].x, r[3].x, b.t), y: catmull(r[0].y, r[1].y, r[2].y, r[3].y, b.t) };
}

export function warpMesh(nodes: readonly Pt[], n = 15): Mesh {
  const pts: Pt[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pts.push(warpAt(nodes, i / n, j / n));
  return { cols: n, rows: n, pts };
}

/** Where the mesh sends the source point at (u, v) in 0…1 across the source rectangle (bilinear within a cell). */
export function sampleMesh(m: Mesh, u: number, v: number): Pt {
  const fx = Math.min(Math.max(u, 0), 1) * m.cols, fy = Math.min(Math.max(v, 0), 1) * m.rows;
  const i = Math.min(m.cols - 1, Math.floor(fx)), j = Math.min(m.rows - 1, Math.floor(fy));
  const tx = fx - i, ty = fy - j, w = m.cols + 1;
  const p = (a: number, b: number) => m.pts[(j + b) * w + i + a]!;
  const mix = (k: 'x' | 'y') => (p(0, 0)[k] * (1 - tx) + p(1, 0)[k] * tx) * (1 - ty) + (p(0, 1)[k] * (1 - tx) + p(1, 1)[k] * tx) * ty;
  return { x: mix('x'), y: mix('y') };
}

export const meshBounds = (m: Mesh) => {
  const xs = m.pts.map((p) => p.x), ys = m.pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

/** Flat form for saving, and back; null if the numbers do not describe a mesh. */
export const meshToFlat = (m: Mesh): { cols: number; rows: number; pts: number[] } => ({ cols: m.cols, rows: m.rows, pts: m.pts.flatMap((p) => [p.x, p.y]) });
export function meshFromFlat(f: { cols: number; rows: number; pts: readonly number[] }): Mesh | null {
  if (!Number.isInteger(f.cols) || !Number.isInteger(f.rows) || f.cols < 1 || f.rows < 1 || f.cols > 40 || f.rows > 40) return null;
  if (f.pts.length !== (f.cols + 1) * (f.rows + 1) * 2 || !f.pts.every(Number.isFinite)) return null;
  const pts: Pt[] = [];
  for (let i = 0; i < f.pts.length; i += 2) pts.push({ x: f.pts[i]!, y: f.pts[i + 1]! });
  return { cols: f.cols, rows: f.rows, pts };
}
