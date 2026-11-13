import { PT, type LetterSheet, type Page } from '../doc/model';
import type { CaptionSpec } from '../engine/lettering/spec';
import { letterBox } from '../render/caption';
import { lettersReady } from '../render/fonts';
import { drawBalloons } from '../render/page';

/**
 * A small picture of a balloon, drawn by the page renderer and framed to fit: the shape picker
 * and look presets show exactly what a click will give.
 */
export function balloonSwatch(cap: CaptionSpec, sheet: LetterSheet, pageW: number, pageH: number, w = 64, h = 44): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.setAttribute('aria-hidden', 'true');
  const cx = pageW * PT / 2, cy = pageH * PT / 2;
  const dx = cx - cap.x, dy = cy - cap.y;
  const letter = { id: 'swatch', cap: { ...cap, x: cx, y: cy, tails: cap.tails.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })) } };
  void lettersReady([letter.cap]).then(() => {
    const b = letterBox(letter, sheet, pageW, pageH);
    const bw = Math.max(0.05, (b.x1 - b.x0) / PT), bh = Math.max(0.05, (b.y1 - b.y0) / PT);
    // bumps, spikes and dashes reach a little past the measured box
    const scale = Math.min(w / bw, h / bh) * 0.8 * ratio;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(1, 0, 0, 1, canvas.width / 2 - ((b.x0 + b.x1) / 2 / PT) * scale, canvas.height / 2 - ((b.y0 + b.y1) / 2 / PT) * scale);
    drawBalloons(g, { widthIn: pageW, heightIn: pageH, balloons: [letter] } as unknown as Page, scale, sheet);
  });
  return canvas;
}
