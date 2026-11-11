// Vendored from 2Dope src/core/vectorclip.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import type { StrokePoint, StrokeRecord } from './stroke';
import { at, eraseVectors, type VectorErase } from './vectorcut';
import { selectionClip, vectorBounds, type VectorClip } from './vectorstyle';

/**
 * Selections for vector lines: keep the parts of a stroke whose centre line falls inside a
 * document mask (1 = selected). A crossing is found by bisecting the segment that crosses the
 * edge, so the cut lands on the mask edge. Pure geometry on stroke records.
 */

/** Is this point's pixel selected? Off the page is never selected. */
function selected(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const px = Math.floor(x), py = Math.floor(y);
  return px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px] === 1;
}

/**
 * Split a vector stroke into the parts whose centres fall inside the mask (or, with
 * `keep = 'outside'`, outside it). Wholly kept: the same record (same id). Nothing kept: [].
 * Pieces get ids `${id}~c${k}`, keep pressure, tilt and time, and lose the taper at a cut end.
 */
export function clipStrokeToMask(rec: StrokeRecord, mask: Uint8Array, width: number, height: number, keep: 'inside' | 'outside' = 'inside', compiled?: VectorClip): StrokeRecord[] {
  const P = rec.points;
  if (!P.length) return [];
  if(rec.style || rec.shape || rec.clips) {
    // Clip the visible mark, including tip overhang and scatter. Geometry is retained so a
    // future point edit cannot expose paint beyond the saved restriction.
    const clip=compiled ?? selectionClip(mask,width,height,keep==='outside');
    if(!clip.runs.length)return [];
    const box=vectorBounds(rec);
    let intersects=false;
    for(let i=0;i<clip.runs.length;i+=3)if(clip.runs[i]!>=box.y0 && clip.runs[i]!<box.y1 && clip.runs[i+1]!<box.x1 && clip.runs[i+2]!>box.x0){intersects=true;break;}
    if(!intersects)return [];
    if((rec.clips?.length ?? 0)>=16)throw new Error('This line has reached its selection clip limit.');
    return [{...rec,clips:[...(rec.clips ?? []),clip]}];
  }
  const want = keep === 'inside';
  const keeps = (p: { x: number; y: number }) => selected(mask, width, height, p.x, p.y) === want;
  // walk each segment in steps of at most one pixel, so a gap between two points is not missed
  const runs: [number, number][] = [];
  let kept = keeps(P[0]!);
  let start = kept ? 0 : -1;
  let all = kept, any = kept;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1]!, b = P[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const now = keeps({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      all &&= now;
      any ||= now;
      if (now === kept) continue;
      const f = i - 1 + edge(a, b, (k - 1) / n, t, kept, keeps);
      if (now) start = f;
      else runs.push([start, f]);
      kept = now;
    }
  }
  if (all) return [rec];
  if (!any) return [];
  if (kept) runs.push([start, P.length - 1]);
  const out: StrokeRecord[] = [];
  for (const [a, b] of runs) {
    const piece = cut(rec, a, b, out.length);
    if (piece) out.push(piece);
  }
  return out;
}

/** Where between t0 and t1 along a→b the kept side ends or begins: 8 bisections are plenty at one pixel apart. */
function edge(a: StrokePoint, b: StrokePoint, t0: number, t1: number, aKept: boolean, keeps: (p: { x: number; y: number }) => boolean): number {
  let lo = t0, hi = t1;
  for (let k = 0; k < 8; k++) {
    const t = (lo + hi) / 2;
    if (keeps({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) === aKept) lo = t;
    else hi = t;
  }
  // the end on the kept side, so a kept piece never reaches past the edge
  return aKept ? lo : hi;
}

/** The part of a stroke between fractional indices a..b. Cut ends lose their taper. */
function cut(rec: StrokeRecord, a: number, b: number, k: number): StrokeRecord | null {
  const P = rec.points;
  const last = P.length - 1;
  if (b - a < 1e-6) return null;
  const pts: StrokePoint[] = [a === Math.floor(a) ? P[a]! : at(P, a)];
  for (let i = Math.floor(a) + 1; i < b; i++) pts.push(P[i]!);
  pts.push(b === Math.floor(b) ? P[b]! : at(P, b));
  if (pts.length < 2) return null;
  const brush = { ...rec.brush, taperStart: a > 1e-6 ? 0 : rec.brush.taperStart, taperEnd: b < last - 1e-6 ? 0 : rec.brush.taperEnd };
  return { ...rec, id: `${rec.id}~c${k}`, brush, points: pts, controls: undefined };
}

/**
 * The vector eraser with a selection: only the parts of the eraser path inside the mask erase,
 * and only what lies inside the mask may change. A touched line keeps its outside parts as they
 * were. Returns null when nothing inside the selection changed.
 */
export function eraseVectorsInMask(strokes: StrokeRecord[], path: StrokePoint[], radius: number, mode: VectorErase, mask: Uint8Array, width: number, height: number): StrokeRecord[] | null {
  if (mode === 'off' || !path.length || !strokes.length) return null;
  const runs = clipStrokeToMask({ id: 'eraser', tool: 'eraser', brush: {} as StrokeRecord['brush'], color: '', seed: 0, points: path }, mask, width, height);
  let erased = strokes;
  for (const run of runs) erased = eraseVectors(erased, run.points, radius, mode) ?? erased;
  if (erased === strokes) return null;
  return eraseInsideMask(strokes, erased, mask, width, height);
}

/** Keep what changed inside the mask, and every touched line's outside parts as they were. */
function eraseInsideMask(before: StrokeRecord[], erased: StrokeRecord[], mask: Uint8Array, width: number, height: number): StrokeRecord[] | null {
  const kept = new Set(erased);
  const out: StrokeRecord[] = [];
  let changed = false;
  for (const rec of before) {
    if (kept.has(rec)) {
      out.push(rec);
      continue;
    }
    // what the eraser left of this stroke (whole-line erasing leaves nothing)
    const left = erased.filter((e) => e.id.startsWith(`${rec.id}~`) && !before.some((o) => o.id === e.id));
    const inside = left.flatMap((e) => clipStrokeToMask(e, mask, width, height, 'inside'));
    if (sameLength(clipStrokeToMask(rec, mask, width, height, 'inside'), inside)) {
      out.push(rec);
      continue;
    }
    changed = true;
    out.push(...clipStrokeToMask(rec, mask, width, height, 'outside'), ...inside);
  }
  return changed ? out : null;
}

/** Does the eraser leave the inside parts as long as they were (nothing inside was erased)? */
function sameLength(a: StrokeRecord[], b: StrokeRecord[]): boolean {
  const len = (rs: StrokeRecord[]) => rs.reduce((n, r) => n + r.points.reduce((m, p, i) => (i ? m + Math.hypot(p.x - r.points[i - 1]!.x, p.y - r.points[i - 1]!.y) : m), 0), 0);
  return Math.abs(len(a) - len(b)) < 1e-3;
}
