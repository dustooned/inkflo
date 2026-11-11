// Vendored from 2Dope src/core/vectorshape.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import type { Mat } from './selxform';
import { readMatrix } from './vectorstyle';

/** Portable imported paths. Curves remain paths, never rasterized during import or placement. */
export interface VectorShape {
  /** Optional selection group; geometry remains in its existing drawing order. */
  group?: string;
  path: string;
  matrix: Mat;
  fill: string | null;
  stroke: string | null;
  width: number;
  rule: CanvasFillRule;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  miter: number;
}

export function readVectorShape(value: unknown): VectorShape {
  const s = value as VectorShape;
  const color = (v: unknown) => v === null || typeof v === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(v);
  if (!s || typeof s.path !== 'string' || s.path.length > 1_000_000 || !/^[Mm]/.test(s.path) || /[^MmZzLlHhVvCcSsQqTtAa0-9eE.,+\s-]/.test(s.path)) throw new Error('Invalid imported vector path');
  const nums = s.path.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? [];
  if (nums.some((n) => !Number.isFinite(Number(n)) || Math.abs(Number(n)) > 1e7)) throw new Error('Imported vector coordinates are too large');
  if (!color(s.fill) || !color(s.stroke) || !Number.isFinite(s.width) || s.width < 0 || s.width > 1e5 || !Number.isFinite(s.miter) || s.miter < 1 || s.miter > 1000 || !['nonzero', 'evenodd'].includes(s.rule) || !['butt', 'round', 'square'].includes(s.cap) || !['miter', 'round', 'bevel'].includes(s.join)) throw new Error('Invalid imported vector paint');
  if (s.group !== undefined && (typeof s.group !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.group))) throw new Error('Invalid vector group');
  return { ...(s.group ? { group: s.group } : {}), path: s.path, matrix: [...readMatrix(s.matrix)], fill: s.fill, stroke: s.stroke, width: s.width, rule: s.rule, cap: s.cap, join: s.join, miter: s.miter };
}
