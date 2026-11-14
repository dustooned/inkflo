import type { Layer, PlacedImage, ScreenTone, ToneScreen } from '../doc/model';
import { darknessField, gradientField, screenAlpha, type ToneShape } from './halftone';

const TILE = 96;
const tiles = new Map<string, HTMLCanvasElement>();

/** One repeat cell in document coordinates. Patterns remain in phase across export strips. */
function tileFor({ shape, density, color }: ScreenTone): HTMLCanvasElement {
  const key = `${shape}:${density}:${color}`;
  const cached = tiles.get(key);
  if (cached) return cached;
  const tile = document.createElement('canvas');
  tile.width = tile.height = TILE;
  const g = tile.getContext('2d')!;
  g.scale(TILE, TILE);
  g.fillStyle = color;
  if (density >= 1) g.fillRect(0, 0, 1, 1);
  else if (shape === 'line' || shape === 'cross') {
    const width = shape === 'line' ? density : 1 - Math.sqrt(1 - density);
    g.fillRect(0, (1 - width) / 2, 1, width);
    if (shape === 'cross') g.fillRect((1 - width) / 2, 0, width, 1);
  } else {
    // Switch to paper holes at heavy coverage so the marks can reach solid black.
    const holes = shape !== 'square' && density > 0.5;
    const coverage = holes ? 1 - density : density;
    if (holes) {
      g.fillRect(0, 0, 1, 1);
      g.globalCompositeOperation = 'destination-out';
    }
    const positions = holes ? [[0, 0], [0, 1], [1, 0], [1, 1]] : [[0.5, 0.5]];
    for (const [x, y] of positions) {
      const size = Math.sqrt(coverage);
      g.beginPath();
      if (shape === 'dot') g.arc(x!, y!, size / Math.sqrt(Math.PI), 0, 2 * Math.PI);
      else if (shape === 'square') g.rect(x! - size / 2, y! - size / 2, size, size);
      else {
        const r = size / Math.sqrt(2);
        g.moveTo(x!, y! - r); g.lineTo(x! + r, y!); g.lineTo(x!, y! + r); g.lineTo(x! - r, y!); g.closePath();
      }
      g.fill();
    }
  }
  if (tiles.size >= 100) tiles.clear();
  tiles.set(key, tile);
  return tile;
}

/** Page area (inches) a tone needs to cover. */
export interface ToneArea { x0: number; y0: number; x1: number; y1: number }

const pixelsPerUnit = (g: CanvasRenderingContext2D) => {
  const m = g.getTransform();
  return Math.min(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
};

function regionPath(region: { x: number; y: number }[], scale: number): Path2D {
  const p = new Path2D();
  region.forEach(({ x, y }, i) => (i ? p.lineTo(x * scale, y * scale) : p.moveTo(x * scale, y * scale)));
  p.closePath();
  return p;
}

export function drawScreenTone(g: CanvasRenderingContext2D, tone: ScreenTone, w: number, h: number, scale: number, area?: ToneArea, id?: string): void {
  if (tone.gradient) { drawGradientTone(g, tone, w, h, scale, area, id); return; }
  if (!tone.density) return;
  g.save();
  if (scale * pixelsPerUnit(g) / tone.frequency < 2.5) {
    // Blend unresolved dots to their average at low zoom to avoid false moiré bands.
    g.fillStyle = tone.color;
    g.globalAlpha *= tone.density;
  } else {
    const pattern = g.createPattern(tileFor(tone), 'repeat')!;
    pattern.setTransform(new DOMMatrix().rotate(tone.angle).scale(scale / (tone.frequency * TILE)));
    g.fillStyle = pattern;
  }
  if (tone.region) g.fill(regionPath(tone.region, scale), 'evenodd');
  else g.fillRect(0, 0, w, h);
  g.restore();
}

// ---- screened tones (gradients and layers shown as tone), cached per layer

const screened = new Map<string, { key: string; canvas: HTMLCanvasElement; x0: number; y0: number; s: number }>();
const MAX_PIXELS = 30_000_000;

/**
 * The scale to screen at. Exports pass whole dpi and get exactly that (crisp one-ink dots); the
 * screen's fractional zoom is rounded up to steps 25% apart, so a pinch doesn't redo the dots
 * every frame, and the dots are drawn a little smaller with smoothed edges.
 */
function screenScale(target: number, area: ToneArea): { s: number; crisp: boolean } {
  const exact = Math.abs(target - Math.round(target)) < 1e-6;
  let s = exact ? target : Math.pow(1.25, Math.ceil(Math.log(target) / Math.log(1.25)));
  const px = (area.x1 - area.x0) * (area.y1 - area.y0) * s * s;
  if (px > MAX_PIXELS) s *= Math.sqrt(MAX_PIXELS / px);
  return { s, crisp: exact && px <= MAX_PIXELS };
}

function inkCanvas(alpha: Uint8ClampedArray, w: number, h: number, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const img = new ImageData(w, h);
  const r = parseInt(color.slice(1, 3), 16), gg = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  for (let i = 0, k = 0; i < alpha.length; i++, k += 4) { img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = alpha[i]!; }
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** Make (or reuse) the dots for one layer over `area` and draw them. */
function drawScreened(g: CanvasRenderingContext2D, id: string, key: string, area: ToneArea, scale: number, make: (s: number, crisp: boolean, w: number, h: number) => HTMLCanvasElement | null, clip?: Path2D): boolean {
  const target = scale * pixelsPerUnit(g);
  const { s, crisp } = screenScale(target, area);
  const w = Math.max(1, Math.ceil((area.x1 - area.x0) * s)), h = Math.max(1, Math.ceil((area.y1 - area.y0) * s));
  const fullKey = `${key}|${s}|${area.x0},${area.y0},${area.x1},${area.y1}`;
  let hit = screened.get(id);
  if (!hit || hit.key !== fullKey) {
    const canvas = make(s, crisp, w, h);
    if (!canvas) return false;
    if (hit) hit.canvas.width = 0;
    hit = { key: fullKey, canvas, x0: area.x0, y0: area.y0, s };
    screened.set(id, hit);
    if (screened.size > 64) { const first = screened.keys().next().value!; screened.get(first)!.canvas.width = 0; screened.delete(first); }
  }
  g.save();
  if (clip) g.clip(clip, 'evenodd');
  g.imageSmoothingEnabled = !crisp;
  g.drawImage(hit.canvas, hit.x0 * scale, hit.y0 * scale, (hit.canvas.width / hit.s) * scale, (hit.canvas.height / hit.s) * scale);
  g.restore();
  return true;
}

const pageArea = (w: number, h: number, scale: number): ToneArea => ({ x0: 0, y0: 0, x1: w / scale, y1: h / scale });
function regionArea(region: { x: number; y: number }[], within: ToneArea): ToneArea {
  const xs = region.map((p) => p.x), ys = region.map((p) => p.y);
  return { x0: Math.max(within.x0, Math.min(...xs)), y0: Math.max(within.y0, Math.min(...ys)), x1: Math.min(within.x1, Math.max(...xs)), y1: Math.min(within.y1, Math.max(...ys)) };
}

function drawGradientTone(g: CanvasRenderingContext2D, tone: ScreenTone, w: number, h: number, scale: number, given?: ToneArea, id?: string): void {
  const grad = tone.gradient!;
  const page = pageArea(w, h, scale);
  let area = given ? { x0: Math.max(0, given.x0), y0: Math.max(0, given.y0), x1: Math.min(page.x1, given.x1), y1: Math.min(page.y1, given.y1) } : page;
  if (tone.region) area = regionArea(tone.region, area);
  if (area.x1 <= area.x0 || area.y1 <= area.y0) return;
  const clip = tone.region ? regionPath(tone.region, scale) : undefined;
  if (scale * pixelsPerUnit(g) / tone.frequency < 2.5 || !id) {
    // dots too small to see: the same tones as a smooth fill
    g.save();
    const stops = [...grad.stops].sort((a, b) => a.at - b.at);
    const fill = grad.kind === 'radial'
      ? g.createRadialGradient(grad.from.x * scale, grad.from.y * scale, 0, grad.from.x * scale, grad.from.y * scale, Math.hypot(grad.to.x - grad.from.x, grad.to.y - grad.from.y) * scale)
      : g.createLinearGradient(grad.from.x * scale, grad.from.y * scale, grad.to.x * scale, grad.to.y * scale);
    const [r, gg, b] = [1, 3, 5].map((i) => parseInt(tone.color.slice(i, i + 2), 16));
    for (const s of stops) fill.addColorStop(s.at, `rgba(${r},${gg},${b},${s.density})`);
    g.fillStyle = fill;
    if (clip) g.fill(clip, 'evenodd'); else g.fillRect(area.x0 * scale, area.y0 * scale, (area.x1 - area.x0) * scale, (area.y1 - area.y0) * scale);
    g.restore();
    return;
  }
  const field = gradientField(grad);
  const screen = { shape: tone.shape as ToneShape, frequency: tone.frequency, angle: tone.angle };
  drawScreened(g, id, JSON.stringify([tone.shape, tone.frequency, tone.angle, tone.color, grad]), area, scale, (s, crisp, cw, ch) => {
    const alpha = new Uint8ClampedArray(cw * ch);
    screenAlpha(alpha, { width: cw, height: ch, x0: area.x0, y0: area.y0, scale: s }, screen, field, !crisp);
    return inkCanvas(alpha, cw, ch, tone.color);
  }, clip);
}

/**
 * A painted layer shown as tone: its greys become dots of one ink, each dot carrying the average
 * darkness of its cell. False when the dots are too small to see (the caller draws the layer).
 */
export function drawLayerAsTone(g: CanvasRenderingContext2D, layer: Layer, plane: HTMLCanvasElement, rev: string, w: number, h: number, scale: number, image: PlacedImage | undefined, given: ToneArea | undefined,
  drawBitmap: (g: CanvasRenderingContext2D, c: HTMLCanvasElement, w: number, h: number, scale: number, image?: PlacedImage) => void): boolean {
  const tone = layer.asTone as ToneScreen;
  if (scale * pixelsPerUnit(g) / tone.frequency < 2.5) return false;
  const page = pageArea(w, h, scale);
  const area = given ? { x0: Math.max(0, given.x0), y0: Math.max(0, given.y0), x1: Math.min(page.x1, given.x1), y1: Math.min(page.y1, given.y1) } : page;
  if (area.x1 <= area.x0 || area.y1 <= area.y0) return true;
  const screen = { shape: tone.shape as ToneShape, frequency: tone.frequency, angle: tone.angle };
  return drawScreened(g, layer.id, JSON.stringify([tone, rev, image ?? null]), area, scale, (s, crisp, cw, ch) => {
    // the layer's own pixels over this area, at the screening scale
    const src = document.createElement('canvas');
    src.width = cw; src.height = ch;
    const sg = src.getContext('2d', { willReadFrequently: true })!;
    sg.translate(-area.x0 * s, -area.y0 * s);
    drawBitmap(sg, plane, page.x1 * s, page.y1 * s, s, image);
    const rgba = sg.getImageData(0, 0, cw, ch).data;
    src.width = 0;
    const field = darknessField(rgba, cw, ch, { x0: area.x0, y0: area.y0, scale: s }, 1 / tone.frequency);
    const alpha = new Uint8ClampedArray(cw * ch);
    screenAlpha(alpha, { width: cw, height: ch, x0: area.x0, y0: area.y0, scale: s }, screen, field, !crisp);
    return inkCanvas(alpha, cw, ch, tone.color);
  });
}
