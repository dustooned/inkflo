import type { Page, Pt } from '../doc/model';
import { angleLabel, cutAngle } from '../geom/cutangle';

/**
 * The knife's angle readout: a level reference, an arc to the cut, and the angle in degrees by
 * the pen. A snapped straight cut turns green and shows a guide across the page. `s` is canvas
 * units per inch, `k` canvas units per screen pixel.
 */
export function drawCutAngle(g: CanvasRenderingContext2D, s: number, k: number, a: Pt, b: Pt,
  o: { snapped: boolean; steps: boolean; page: Pick<Page, 'widthIn' | 'heightIn'>; minLen: number }): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < o.minLen) return;
  const angle = cutAngle(a, b);
  const dir = Math.atan2(-(b.y - a.y), b.x - a.x);
  const colour = o.snapped ? '#2e8b57' : '#2F6F7E';
  g.save();
  g.setLineDash([]);
  if (o.snapped) {
    const far = Math.hypot(o.page.widthIn, o.page.heightIn);
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    g.strokeStyle = 'rgba(46,139,87,.6)';
    g.lineWidth = k;
    g.setLineDash([3 * k, 4 * k]);
    g.beginPath();
    g.moveTo((a.x - ux * far) * s, (a.y - uy * far) * s);
    g.lineTo((a.x + ux * far) * s, (a.y + uy * far) * s);
    g.stroke();
    g.setLineDash([]);
  }
  // a level reference on the side the cut leaves toward, and the arc from it to the cut
  const right = Math.cos(dir) >= 0;
  const r = Math.min(46 * k, len * s * 0.6);
  g.strokeStyle = 'rgba(128,128,128,.85)';
  g.lineWidth = k;
  g.beginPath();
  g.moveTo(a.x * s, a.y * s);
  g.lineTo(a.x * s + (right ? 1 : -1) * r * 1.25, a.y * s);
  g.stroke();
  const level = right ? 0 : Math.PI;
  const to = -dir;
  let sweep = to - level;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  g.strokeStyle = colour;
  g.lineWidth = 2 * k;
  g.beginPath();
  g.arc(a.x * s, a.y * s, r, level, level + sweep, sweep < 0);
  g.stroke();
  const text = angleLabel(angle) + (o.steps ? ' · 15° steps' : '');
  g.font = `600 ${12 * k}px system-ui, sans-serif`;
  const w = g.measureText(text).width + 12 * k, h = 20 * k;
  // beside the pen; below it when the pen is near the top edge, left of it near the right edge
  const x = b.x * s + 14 * k + w > o.page.widthIn * s + 40 * k ? b.x * s - 14 * k - w : b.x * s + 14 * k;
  const y = b.y * s - 28 * k < -10 * k ? b.y * s + 10 * k : b.y * s - 28 * k;
  g.fillStyle = colour;
  g.beginPath();
  g.roundRect(x, y, w, h, 6 * k);
  g.fill();
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText(text, x + 6 * k, y + h / 2);
  g.restore();
}
