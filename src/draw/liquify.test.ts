import { expect, it } from 'vitest';
import { liquifySegment } from './liquify';

/** A bare-bones canvas context over an RGBA buffer: all liquifySegment needs. */
function fake(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  const g = {
    canvas: { width: w, height: h },
    getImageData(x: number, y: number, cw: number, ch: number) {
      const out = new Uint8ClampedArray(cw * ch * 4);
      for (let r = 0; r < ch; r++) out.set(data.subarray(((y + r) * w + x) * 4, ((y + r) * w + x + cw) * 4), r * cw * 4);
      return { data: out, width: cw, height: ch };
    },
    putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) {
      for (let r = 0; r < img.height; r++) data.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((y + r) * w + x) * 4);
    },
  };
  return { g: g as unknown as CanvasRenderingContext2D, data };
}
const dot = (data: Uint8ClampedArray, w: number, x: number, y: number) => { data.set([0, 0, 0, 255], (y * w + x) * 4); };
const alphaAt = (data: Uint8ClampedArray, w: number, x: number, y: number) => data[(y * w + x) * 4 + 3]!;
const sum = (data: Uint8ClampedArray) => { let s = 0; for (let i = 3; i < data.length; i += 4) s += data[i]!; return s; };
const at = (x: number, y: number) => ({ x, y, pressure: 1 });

const centroidX = (data: Uint8ClampedArray, w: number) => {
  let sx = 0, s = 0;
  for (let i = 0; i < data.length / 4; i++) { sx += (i % w) * data[i * 4 + 3]!; s += data[i * 4 + 3]!; }
  return sx / s;
};

it('push carries paint along the stroke', () => {
  const { g, data } = fake(80, 40);
  for (let y = 18; y < 22; y++) for (let x = 30; x < 34; x++) dot(data, 80, x, y);
  const before = centroidX(data, 80);
  liquifySegment(g, at(28 / 100, 20 / 100), at(48 / 100, 20 / 100), { size: 0.3, strength: 1, mode: 'push' }, 100);
  expect(centroidX(data, 80)).toBeGreaterThan(before + 1);
  expect(alphaAt(data, 80, 20, 20)).toBe(0); // nothing appears behind the stroke's start
});

it('bloat grows a mark and pinch shrinks it, both about the brush centre', () => {
  const grow = fake(60, 60), shrink = fake(60, 60);
  for (const f of [grow, shrink]) for (let y = 26; y < 34; y++) for (let x = 26; x < 34; x++) dot(f.data, 60, x, y);
  const start = sum(grow.data);
  for (let i = 0; i < 6; i++) {
    liquifySegment(grow.g, at(0.299, 0.3), at(0.301, 0.3), { size: 0.4, strength: 1, mode: 'bloat' }, 100);
    liquifySegment(shrink.g, at(0.299, 0.3), at(0.301, 0.3), { size: 0.4, strength: 1, mode: 'pinch' }, 100);
  }
  expect(sum(grow.data)).toBeGreaterThan(start);
  expect(sum(shrink.data)).toBeLessThan(start);
});

it('twirl turns an off-centre mark about the brush centre without losing it', () => {
  const { g, data } = fake(60, 60);
  for (let y = 28; y < 32; y++) for (let x = 38; x < 44; x++) dot(data, 60, x, y);
  const before = sum(data);
  for (let i = 0; i < 8; i++) liquifySegment(g, at(0.299, 0.3), at(0.301, 0.3), { size: 0.5, strength: 1, mode: 'twirl' }, 100);
  expect(sum(data)).toBeGreaterThan(before * 0.6);
  expect(sum(data)).not.toBe(before);
});

it('is deterministic, so a replay matches the live preview', () => {
  const paint = (f: ReturnType<typeof fake>) => { for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) dot(f.data, 60, x, y); };
  const a = fake(60, 60), b = fake(60, 60);
  paint(a); paint(b);
  for (const f of [a, b]) liquifySegment(f.g, at(0.12, 0.2), at(0.4, 0.3), { size: 0.3, strength: 0.7, mode: 'push' }, 100);
  expect([...a.data]).toEqual([...b.data]);
});

it('does nothing for a stroke that does not move or a brush with no strength', () => {
  const { g, data } = fake(40, 40);
  dot(data, 40, 20, 20);
  expect(liquifySegment(g, at(0.2, 0.2), at(0.2, 0.2), { size: 0.3, strength: 1, mode: 'push' }, 100)).toBeNull();
  expect(liquifySegment(g, at(0.1, 0.2), at(0.3, 0.2), { size: 0.3, strength: 0, mode: 'push' }, 100)).toBeNull();
});
