import type { Layer } from '../doc/model';
import { passForType, toRecord } from '../draw/replay';
import { vectorWidths } from '../engine/core/vectorcut';
import { strokeLength, type StrokePoint, type StrokeRecord } from '../engine/core/stroke';
import { vectorDabs } from '../engine/core/vectorstyle';

/**
 * Vector ink: a stroke stays as points with a width at each point (pressure × the point's own
 * width), drawn as one filled outline with round caps. Ported from 2Dope's `brush/vector.ts`
 * outline renderer (the plain, unstyled path).
 *
 * A vector layer's bitmap is only a cache of these outlines: every edit redraws the layer from its
 * strokes (fast: one path fill per stroke), and exports read the same bitmap (one renderer).
 */

/** Drop points closer than `minDist` so the outline doesn't wobble on dense input. */
function thin(points: StrokePoint[], minDist: number): StrokePoint[] {
  if (points.length < 3) return points;
  const out: StrokePoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** One vector stroke's outline. `totalLength` = Infinity skips the end taper (a line being drawn). */
export function drawVectorStroke(ctx: CanvasRenderingContext2D, rec: StrokeRecord, totalLength = strokeLength(rec.points), flatEnds?: readonly boolean[], styled = true): void {
  const pts = thin(rec.points, 1.5);
  if (pts.length === 0) return;
  const appearance = styled ? rec.brush.vectorStyle : undefined;
  if (appearance?.mode === 'stamp') {
    const stroke = totalLength === Infinity ? { ...rec, brush: { ...rec.brush, taperEnd: 0 } } : rec;
    ctx.save();
    const opacity = ctx.globalAlpha * rec.brush.opacity;
    ctx.fillStyle = rec.color;
    for (const dab of vectorDabs(stroke)) {
      ctx.globalAlpha = opacity * Math.max(0, Math.min(1, dab.alpha));
      ctx.beginPath();
      if (appearance.tip === 'dash') {
        ctx.save();
        ctx.translate(dab.x, dab.y);
        ctx.rotate(dab.angle);
        ctx.rect(-dab.radius, -dab.radius * 0.3, dab.radius * 2, dab.radius * 0.6);
        ctx.restore();
      } else ctx.ellipse(dab.x, dab.y, dab.radius, dab.radius * rec.brush.roundness, dab.angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  const widths = vectorWidths({ ...rec, points: pts }, totalLength);
  ctx.save();
  ctx.globalAlpha *= rec.brush.opacity;
  ctx.fillStyle = rec.tool === 'eraser' ? '#000' : rec.color;
  ctx.beginPath();
  if (pts.length === 1) {
    const p = pts[0]!;
    ctx.arc(p.x, p.y, widths[0]!, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const n = pts.length;
  const flat = appearance?.mode === 'flat';
  const nib = (rec.brush.angle * Math.PI) / 180;
  const L: [number, number][] = [];
  const R: [number, number][] = [];
  const ang: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = flat ? Math.cos(nib) : -dy / len;
    const ny = flat ? Math.sin(nib) : dx / len;
    const p = pts[i]!;
    const w = widths[i]! * (flat ? Math.max(rec.brush.roundness, 0.05) + (1 - rec.brush.roundness) * Math.abs((nx * dy - ny * dx) / len) : 1);
    L.push([p.x + nx * w, p.y + ny * w]);
    R.push([p.x - nx * w, p.y - ny * w]);
    ang.push(Math.atan2(ny, nx));
  }
  const side = (S: [number, number][], reverse: boolean) => {
    const s = reverse ? [...S].reverse() : S;
    for (let i = 1; i < s.length - 1; i++) {
      const c = s[i]!;
      const nx = s[i + 1]!;
      ctx.quadraticCurveTo(c[0], c[1], (c[0] + nx[0]) / 2, (c[1] + nx[1]) / 2);
    }
    const last = s[s.length - 1]!;
    ctx.lineTo(last[0], last[1]);
  };
  ctx.moveTo(L[0]![0], L[0]![1]);
  side(L, false);
  const pe = pts[n - 1]!;
  const ae = ang[n - 1]!;
  if (!flat && !flatEnds?.[1]) ctx.arc(pe.x, pe.y, widths[n - 1]!, ae, ae + Math.PI, true);
  else ctx.lineTo(...R[n - 1]!);
  side(R, true);
  const p0 = pts[0]!;
  const a0 = ang[0]!;
  if (!flat && !flatEnds?.[0]) ctx.arc(p0.x, p0.y, widths[0]!, a0 + Math.PI, a0, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Redraw a vector layer's bitmap from its strokes (the canvas is cleared first). */
export function renderVectorLayer(layer: Layer, canvas: HTMLCanvasElement, dpi: number, skip?: number): void {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const pass = passForType(layer.type);
  layer.strokes.forEach((s, i) => {
    if (i === skip) return;
    drawVectorStroke(g, toRecord(s, pass, dpi, `v${i}`), undefined, s.flat, s.styledVector === true);
  });
}
