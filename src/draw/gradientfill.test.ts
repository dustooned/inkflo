import { describe, expect, it } from 'vitest';
import { newBook, newLayer, type FillGradient } from '../doc/model';
import { FORMAT, parseBookFile, SCHEMA, stringifyBookFile } from '../doc/schema';
import { blendGradient, colourRegion, gradientT } from './gradientfill';

const DPI = 100;
/** A w×h RGBA patch filled with one colour. */
function patch(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(rgba, i * 4);
  return px;
}
const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('colour gradient fills', () => {
  it('runs linear and radial from the start point to the end point', () => {
    const lin = gradientT({ kind: 'linear', from: { x: 0, y: 0 }, to: { x: 2, y: 0 } });
    expect(lin(1, 3)).toBeCloseTo(0.5);
    expect(lin(-1, 0)).toBe(0);
    expect(lin(5, 0)).toBe(1);
    const rad = gradientT({ kind: 'radial', from: { x: 1, y: 1 }, to: { x: 3, y: 1 } });
    expect(rad(1, 2)).toBeCloseTo(0.5);
  });

  it('blends one colour into another across the area, only where the mask is set', () => {
    const w = 200, h = 10, px = patch(w, h, [0, 0, 0, 0]);
    const mask = new Uint8Array(w * h).fill(1);
    mask[5 * w + 199] = 0;
    const gr: FillGradient = { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, start: '#ff0000', end: '#0000ff' };
    blendGradient(px, { x: 0, y: 0, w, h }, mask, w, DPI, gr);
    // the first pixel's centre is a hair along the gradient
    at(px, w, 0, 5).forEach((v, i) => expect(Math.abs(v - [255, 0, 0, 255][i]!)).toBeLessThanOrEqual(1));
    const mid = at(px, w, 100, 5);
    expect(mid[0]).toBeGreaterThan(120); expect(mid[0]).toBeLessThan(135);
    expect(mid[2]).toBeGreaterThan(120); expect(mid[2]).toBeLessThan(135);
    expect(at(px, w, 199, 5)).toEqual([0, 0, 0, 0]); // outside the mask
  });

  it('fades a colour to transparent without going dark, over a flat', () => {
    const w = 200, h = 4, px = patch(w, h, [240, 200, 160, 255]);
    const mask = new Uint8Array(w * h).fill(1);
    blendGradient(px, { x: 0, y: 0, w, h }, mask, w, DPI, { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, start: '#3f6c9e', end: 'transparent' });
    expect(at(px, w, 0, 1).slice(0, 3)).toEqual([63, 108, 158]);
    expect(at(px, w, 199, 1)).toEqual([240, 200, 160, 255]); // the flat shows through at the end
    expect(at(px, w, 100, 1)[3]).toBe(255);
  });

  it('shades with multiply (keeps the hue) and lightens with screen', () => {
    const w = 10, h = 1, mask = new Uint8Array(w).fill(1);
    const flat = patch(w, h, [200, 100, 50, 255]);
    blendGradient(flat, { x: 0, y: 0, w, h }, mask, w, DPI, { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, start: '#808080', end: '#808080', blend: 'multiply' });
    const m = at(flat, w, 5, 0);
    expect(m[0]).toBeCloseTo(100, -1); expect(m[1]).toBeCloseTo(50, -1); expect(m[2]).toBeCloseTo(25, -1);
    const lit = patch(w, h, [100, 50, 0, 255]);
    blendGradient(lit, { x: 0, y: 0, w, h }, mask, w, DPI, { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, start: '#808080', end: '#808080', blend: 'screen', opacity: 0.5 });
    expect(at(lit, w, 5, 0)[0]).toBeGreaterThan(100);
  });

  it('finds the flat under the start: same colour, joined, inside the panel', () => {
    const w = 20, h = 10, px = patch(w, h, [255, 0, 0, 255]);
    // a blue stripe splits the red into two flats
    for (let y = 0; y < h; y++) px.set([0, 0, 255, 255], (y * w + 10) * 4);
    const r = colourRegion(px, w, h, 2, 2)!;
    expect(r.count).toBe(10 * h);
    expect(r.x1).toBe(9);
    expect(colourRegion(patch(w, h, [0, 0, 0, 0]), w, h, 2, 2)).toBeNull(); // nothing painted: no flat
  });

  it('keeps gradient fills and the transparent colour in the book file', () => {
    const book = newBook('G');
    const layer = newLayer('colour');
    const gradient: FillGradient = { kind: 'radial', from: { x: 1, y: 1 }, to: { x: 2, y: 2 }, start: '#3f6c9e', end: 'transparent', blend: 'multiply', opacity: 0.6, area: 'lasso', lasso: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }] };
    layer.fills.push({ at: { x: 1, y: 1 }, color: '#3f6c9e', gap: 0, gradient }, { at: { x: 2, y: 2 }, color: 'transparent', gap: 0, strokes: 3 });
    book.pages[0]!.groups.find((g) => g.kind === 'background')!.layers.push(layer);
    const f = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 't', book, art: {} }));
    const fills = f.book.pages[0]!.groups.find((g) => g.kind === 'background')!.layers.find((l) => l.id === layer.id)!.fills;
    expect(fills[0]!.gradient).toEqual(gradient);
    expect(fills[1]!.color).toBe('transparent');
    expect(fills[1]!.strokes).toBe(3); // where the fill falls among the strokes, for rebuilds
  });
});
