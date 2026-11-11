// Adapted from 2Dope src/view/caption.ts @ 707f793 (paintCaption, captionLayout, captionBalloon,
// captionLinks, measureLines, drawWords, placeOnPath). inkflo pages are still images, so there is
// no frame, no keys, no letter motion and no write-on; type size comes from the book's style
// sheet in points instead of a share of the page height. Positions are stored in points and
// converted to the target's pixels before layout, so text is measured at its real pixel size.

import { DEFAULT_SHEET, PT, type Letter, type LetterSheet } from '../doc/model';
import { alongPath, balloonOutline, balloonProfile, balloonShapes, fitCaption, inside, pathBand, pathLength, textPath, type Fit, type Pt } from '../engine/lettering/geometry';
import { freshState, hasBold, runsOf, stripMarkup } from '../engine/lettering/markup';
import { captionValue, type CaptionSpec } from '../engine/lettering/spec';
import { letterFont, letterFontReady } from './fonts';

/** Type size in points (house size × the balloon's own scale). */
export function sizePt(c: CaptionSpec, sheet: LetterSheet = DEFAULT_SHEET): number {
  return sheet.sizes[c.size] * (c.scale ?? 1);
}

/** A caption scaled from points to target pixels (`k` = px per pt). */
export function toPx(c: CaptionSpec, k: number): CaptionSpec {
  const p = ([x, y]: [number, number]): [number, number] => [x * k, y * k];
  const out: CaptionSpec = {
    ...c,
    x: c.x * k,
    y: c.y * k,
    tails: c.tails.map((t) => ({ ...t, x: t.x * k, y: t.y * k, ...(t.bend ? { bend: [t.bend[0] * k, t.bend[1] * k] as [number, number] } : {}) })),
  };
  if (c.path) out.path = c.path.map(p);
  if (c.minSize) out.minSize = [c.minSize[0] * k, c.minSize[1] * k];
  if (c.links) out.links = c.links.map((l) => ({ ...l, x: l.x * k, y: l.y * k }));
  if (c.curve?.kind === 'drawn') out.curve = { kind: 'drawn', points: c.curve.points.map(p) };
  return out;
}

export interface CaptionLayout {
  fit: Fit;
  /** Type size, px. */
  size: number;
  tracking: number;
  font: string;
  text: string;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  return (measureCtx ??= document.createElement('canvas').getContext('2d')!);
}

const layouts = new Map<string, CaptionLayout>();

/** Lay out a caption already in pixels (`size` px), cached by everything that changes the result. */
export function captionLayout(c: CaptionSpec, size: number, pageW: number, pageH: number): CaptionLayout {
  const tracking = captionValue(c, 'tracking');
  const leading = captionValue(c, 'leading') / 100;
  const text = c.caps ? c.text.toUpperCase() : c.text;
  const font = letterFont(c, size);
  const bold = hasBold(text);
  const boldFont = bold ? letterFont({ ...c, bold: true }, size) : '';
  const key = `${text}|${font}|${letterFontReady(c)}|${bold ? letterFontReady({ ...c, bold: true }) : ''}|${c.style}|${c.shape ?? 1}|${JSON.stringify(c.look ?? '')}|${c.minSize ?? ''}|${tracking}|${leading}|${pageW}x${pageH}`;
  const hit = layouts.get(key);
  if (hit) return hit;
  const g = measurer();
  g.font = font;
  const extra = (tracking / 1000) * size;
  // markup takes no room; a caption with bold words measures with the wider bold letters
  const measure = (t: string) => {
    const plain = stripMarkup(t);
    let w = g.measureText(plain).width;
    if (bold) {
      g.font = boldFont;
      w = Math.max(w, g.measureText(plain).width);
      g.font = font;
    }
    return w + extra * Math.max(0, [...plain].length - 1);
  };
  const fitted = fitCaption(text.length ? text : ' ', c.style, measure, { size, leading, maxA: pageW * 0.48, maxB: pageH * 0.48, aspect: c.shape ?? 1, profile: balloonProfile(c.style, c.look) });
  const fit = c.minSize ? { ...fitted, a: Math.max(fitted.a, c.minSize[0]), b: Math.max(fitted.b, c.minSize[1]) } : fitted;
  const out = { fit, size, tracking: extra, font, text };
  if (layouts.size > 300) layouts.delete(layouts.keys().next().value!);
  layouts.set(key, out);
  return out;
}

/** The path a sound effect's letters follow (around its centre), or null for straight lettering. */
function curvePath(c: CaptionSpec, lay: CaptionLayout): Pt[] | null {
  if (c.style !== 'sfx' || !c.curve) return null;
  const span = lay.fit.lines.reduce((n, l) => n + l.width, 0) + lay.size * 0.3 * Math.max(0, lay.fit.lines.length - 1);
  const p = textPath(c.curve, Math.max(span, lay.size), lay.size);
  return p.length >= 2 ? p : null;
}

/** The balloon (with tails) of a caption in pixels. */
export function captionBalloon(c: CaptionSpec, size: number, pageW: number, pageH: number) {
  const lay = captionLayout(c, size, pageW, pageH);
  const seed = [...c.text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const curved = curvePath(c, lay);
  // outlines are around (0, 0); balloonShapes moves them to the caption's centre
  const outline = curved ? pathBand(curved, lay.size * 0.8) : balloonOutline(c.style, lay.fit.a, lay.fit.b, seed, c.path, c.look);
  return { lay, outline, shapes: balloonShapes(outline, c.style === 'sfx' ? [] : c.tails, c.x, c.y, lay.size) };
}

function linkCaption(c: CaptionSpec, i: number): CaptionSpec {
  const k = c.links![i]!;
  const { links: _l, minSize: _m, keys: _k, ...rest } = c;
  return { ...rest, text: k.text, x: k.x, y: k.y, tails: [] };
}

function neckBetween(a: Pt, b: Pt, w: number): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d;
  const ny = dx / d;
  const out: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const half = (w / 2) * (0.62 + 0.38 * Math.abs(2 * t - 1));
    out.push({ x: a.x + dx * t + nx * half, y: a.y + dy * t + ny * half });
  }
  for (let i = 16; i >= 0; i--) {
    const t = i / 16;
    const half = (w / 2) * (0.62 + 0.38 * Math.abs(2 * t - 1));
    out.push({ x: a.x + dx * t - nx * half, y: a.y + dy * t - ny * half });
  }
  return out;
}

function captionLinks(c: CaptionSpec, size: number, pageW: number, pageH: number) {
  if (!c.links?.length || c.style === 'sfx') return [];
  return c.links.map((_, i) => {
    const lc = linkCaption(c, i);
    const { lay, shapes } = captionBalloon(lc, size, pageW, pageH);
    return { caption: lc, lay, outline: shapes.outline, neck: neckBetween({ x: c.x, y: c.y }, { x: lc.x, y: lc.y }, size * 1.5) };
  });
}

const pathOf = (g: CanvasRenderingContext2D, pts: Pt[], close = true) => {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  if (close) g.closePath();
};

/** Draw one caption (in pixels). */
export function paintCaption(g: CanvasRenderingContext2D, c: CaptionSpec, size: number, pageW: number, pageH: number): void {
  const { lay, shapes } = captionBalloon(c, size, pageW, pageH);
  const links = captionLinks(c, size, pageW, pageH);
  const balloonA = captionValue(c, 'balloonOpacity') / 100;
  const textA = captionValue(c, 'textOpacity') / 100;
  g.save();
  const base = g.globalAlpha;
  if (c.style !== 'sfx' && balloonA > 0) {
    g.globalAlpha = base * balloonA;
    const union = [shapes.outline, ...shapes.joined, ...links.flatMap((k) => [k.outline, k.neck])];
    const closedShapes = [...union, ...shapes.seams];
    const fillAll = (dx: number, dy: number) => {
      for (const s of closedShapes) {
        g.beginPath();
        s.forEach((p, i) => (i ? g.lineTo(p.x + dx, p.y + dy) : g.moveTo(p.x + dx, p.y + dy)));
        g.closePath();
        g.fill();
      }
      for (const b of shapes.bubbles) {
        g.beginPath();
        g.arc(b.x + dx, b.y + dy, b.r, 0, Math.PI * 2);
        g.fill();
      }
    };
    if (c.underFill) {
      g.fillStyle = c.underFill.color;
      fillAll(c.underFill.dx * size, c.underFill.dy * size);
    }
    g.fillStyle = c.fill;
    fillAll(0, 0);
    if (c.inkWidth > 0) {
      g.strokeStyle = c.ink;
      g.lineWidth = c.inkWidth * size;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      const whisper = c.style === 'whisper' ? [size * 0.45, size * 0.3] : null;
      if (whisper) g.setLineDash(whisper);
      const outside = (pieces: Pt[][]) => {
        const far = 1e6;
        for (const p of pieces) {
          g.beginPath();
          g.rect(-far, -far, 2 * far, 2 * far);
          p.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
          g.closePath();
          g.clip('evenodd');
        }
      };
      if (union.length > 1) {
        // pieces that share one outline: stroke each twice as wide, outside all of them
        g.save();
        outside(union);
        g.lineWidth = c.inkWidth * size * 2;
        for (const p of union) {
          pathOf(g, p);
          g.stroke();
        }
        g.restore();
      } else {
        pathOf(g, shapes.outline);
        g.stroke();
      }
      g.setLineDash(whisper ?? []);
      if (shapes.seams.length) {
        g.save();
        outside(union);
        g.lineWidth = c.inkWidth * size * 2;
        for (const p of shapes.seams) {
          pathOf(g, p);
          g.stroke();
        }
        g.restore();
        g.lineWidth = c.inkWidth * size;
      }
      for (const b of shapes.bubbles) {
        g.beginPath();
        g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        g.stroke();
      }
      shapes.zigzags.forEach((z, i) => {
        g.lineWidth = c.inkWidth * size * (shapes.zigzagWidths[i] ?? 1);
        pathOf(g, z, false);
        g.stroke();
      });
      g.setLineDash([]);
    }
  }
  if (textA > 0) {
    g.globalAlpha = base * textA;
    const pieces = [{ cap: c, lay }, ...links.map((k) => ({ cap: k.caption, lay: k.lay }))];
    for (const p of pieces) drawWords(g, p.cap, p.lay);
  }
  g.restore();
}

/** Each line's runs (markup: *bold*, _italic_, colours) measured in their own fonts. */
function measureLines(g: CanvasRenderingContext2D, c: CaptionSpec, lay: CaptionLayout) {
  const size = lay.size;
  const state = freshState();
  const lines = lay.fit.lines.map((line) => {
    const runs = runsOf(line.text, state).map((r) => {
      const bold = c.bold || r.bold;
      const italic = c.italic || r.italic;
      const font = r.bold || r.italic ? letterFont({ ...c, bold, italic }, size) : lay.font;
      g.font = font;
      const w = g.measureText(r.text).width + lay.tracking * [...r.text].length;
      return { ...r, bold, italic, font, w };
    });
    return { y: line.y, runs, width: runs.reduce((n, r) => n + r.w, 0) - (runs.length ? lay.tracking : 0) };
  });
  const widest = Math.max(0, ...lines.map((l) => l.width));
  const lineX = (w: number) => (c.align === 'left' ? c.x - widest / 2 : c.align === 'right' ? c.x + widest / 2 - w : c.x - w / 2);
  return { lines, lineX };
}

function drawWords(g: CanvasRenderingContext2D, c: CaptionSpec, lay: CaptionLayout): void {
  const size = lay.size;
  const curved = curvePath(c, lay);
  g.textBaseline = 'middle';
  if (curved) {
    drawOnPath(g, c, lay, curved);
    return;
  }
  const { lines, lineX } = measureLines(g, c, lay);
  for (const line of lines) {
    let x = lineX(line.width);
    const y = c.y + line.y;
    for (const r of line.runs) {
      const chars = [...r.text];
      g.font = r.font;
      const paint = (draw: (t: string, px: number) => void) => {
        if (!lay.tracking) {
          draw(chars.join(''), x);
          return;
        }
        let px = x;
        for (const ch of chars) {
          draw(ch, px);
          px += g.measureText(ch).width + lay.tracking;
        }
      };
      if (c.textOutline && c.textOutlineWidth > 0) {
        g.strokeStyle = c.textOutline;
        g.lineWidth = c.textOutlineWidth * size * 2;
        g.lineJoin = 'round';
        paint((t, px) => g.strokeText(t, px, y));
      }
      g.fillStyle = r.color ?? c.textColor;
      paint((t, px) => g.fillText(t, px, y));
      x += r.w;
    }
  }
}

/** A sound effect's letters along its path, each turned to follow it. */
function drawOnPath(g: CanvasRenderingContext2D, c: CaptionSpec, lay: CaptionLayout, path: Pt[]): void {
  const size = lay.size;
  const state = freshState();
  const letters: { ch: string; font: string; color: string | null; w: number }[] = [];
  lay.fit.lines.forEach((line, i) => {
    if (i) letters.push({ ch: ' ', font: lay.font, color: null, w: size * 0.3 });
    for (const r of runsOf(line.text, state)) {
      const font = r.bold || r.italic ? letterFont({ ...c, bold: c.bold || r.bold, italic: c.italic || r.italic }, size) : lay.font;
      g.font = font;
      for (const ch of r.text) letters.push({ ch, font, color: r.color, w: g.measureText(ch).width + lay.tracking });
    }
  });
  const total = letters.reduce((n, l) => n + l.w, 0);
  let d = (pathLength(path) - total) / 2;
  g.textAlign = 'center';
  for (const l of letters) {
    const at = alongPath(path, d + l.w / 2);
    d += l.w;
    if (l.ch === ' ') continue;
    g.save();
    g.translate(c.x + at.x, c.y + at.y);
    g.rotate(at.angle);
    g.font = l.font;
    if (c.textOutline && c.textOutlineWidth > 0) {
      g.strokeStyle = c.textOutline;
      g.lineWidth = c.textOutlineWidth * size * 2;
      g.lineJoin = 'round';
      g.strokeText(l.ch, 0, 0);
    }
    g.fillStyle = l.color ?? c.textColor;
    g.fillText(l.ch, 0, 0);
    g.restore();
  }
  g.textAlign = 'start';
}

// ---------------------------------------------------------------------------------------------
// Page-level helpers (points in, pixels out)

/** Draw a page's letter at `s` px per inch. */
export function paintLetter(g: CanvasRenderingContext2D, l: Letter, sheet: LetterSheet, s: number, pageWIn: number, pageHIn: number): void {
  const k = s / PT;
  paintCaption(g, toPx(l.cap, k), sizePt(l.cap, sheet) * k, pageWIn * s, pageHIn * s);
}

/** A letter's outline in points (hit testing, safe area, selection boxes). */
export function letterOutline(l: Letter, sheet: LetterSheet, pageWIn: number, pageHIn: number): Pt[] {
  // laid out at 4 px per pt, then scaled back, so text is measured at a realistic size
  const k = 4;
  const { shapes } = captionBalloon(toPx(l.cap, k), sizePt(l.cap, sheet) * k, pageWIn * PT * k, pageHIn * PT * k);
  return shapes.outline.map((p) => ({ x: p.x / k, y: p.y / k }));
}

export function letterBox(l: Letter, sheet: LetterSheet, pageWIn: number, pageHIn: number): { x0: number; y0: number; x1: number; y1: number } {
  const o = letterOutline(l, sheet, pageWIn, pageHIn);
  const xs = o.map((p) => p.x);
  const ys = o.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Does a point (pt) hit a letter's balloon? */
export function hitLetter(l: Letter, sheet: LetterSheet, p: Pt, pageWIn: number, pageHIn: number): boolean {
  return inside(letterOutline(l, sheet, pageWIn, pageHIn), p);
}
