import type { ModularGrid, Page } from '../doc/model';
import { construction, gridLines, type Guide } from '../geom/composition';

export function drawComposition(g: CanvasRenderingContext2D, kind: Guide, w: number, h: number, s: number): void {
  if (kind === 'off') return;
  const { lines, circles } = construction(kind, w, h);
  g.save();
  g.beginPath();
  g.rect(0, 0, w * s, h * s);
  g.clip();
  g.strokeStyle = 'rgba(18, 110, 146, .64)';
  g.lineWidth = 1;
  g.setLineDash([5, 4]);
  g.beginPath();
  for (const [a, b] of lines) {
    g.moveTo(a.x * s, a.y * s);
    g.lineTo(b.x * s, b.y * s);
  }
  for (const { x, y, r } of circles) {
    g.moveTo((x + r) * s, y * s);
    g.arc(x * s, y * s, r * s, 0, 2 * Math.PI);
  }
  g.stroke();
  g.restore();
}

export function drawModularGrid(g: CanvasRenderingContext2D, page: Page, grid: ModularGrid, s: number): void {
  const { x, y } = gridLines(page, grid);
  g.save();
  g.beginPath();
  g.rect(0, 0, page.widthIn * s, page.heightIn * s);
  g.clip();
  g.fillStyle = 'rgba(171, 105, 32, .16)';
  g.strokeStyle = 'rgba(158, 86, 22, .75)';
  g.lineWidth = 1;
  g.setLineDash([3, 3]);
  g.beginPath();
  for (const v of x) {
    g.fillRect((v - grid.gutter / 2) * s, 0, grid.gutter * s, page.heightIn * s);
    g.moveTo(v * s, 0);
    g.lineTo(v * s, page.heightIn * s);
  }
  for (const v of y) {
    g.fillRect(0, (v - grid.gutter / 2) * s, page.widthIn * s, grid.gutter * s);
    g.moveTo(0, v * s);
    g.lineTo(page.widthIn * s, v * s);
  }
  g.stroke();
  g.restore();
}
