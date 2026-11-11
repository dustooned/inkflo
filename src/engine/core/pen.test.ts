// Vendored from 2Dope src/core/pen.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { canvasCursorCss, defaultPenPrefs, diagnosePen, mapPressure, PenProbe, platformOf, readPenPrefs, type PenSample } from './pen';

const pen = (pressure: number, buttons = 1, extra: Partial<PenSample> = {}): PenSample => ({ type: 'pen', pressure, tiltX: 0, tiltY: 0, twist: 0, buttons, ...extra });
const stroke = (probe: PenProbe, pressures: number[], extra: Partial<PenSample> = {}): boolean => {
  let warned = false;
  for (const p of pressures) warned = probe.observe(pen(p, 1, extra)) || warned;
  return probe.observe(pen(0, 0)) || warned;
};

describe('pen prefs', () => {
  it('defaults leave pressure unchanged', () => {
    const d = defaultPenPrefs();
    for (const p of [0, 0.1, 0.37, 0.5, 0.9, 1]) expect(mapPressure(p, d)).toBeCloseTo(p, 6);
  });
  it('soft reaches more strength with a light hand, firm less', () => {
    const soft = { ...defaultPenPrefs(), firmness: -1 }, firm = { ...defaultPenPrefs(), firmness: 1 };
    expect(mapPressure(0.3, soft)).toBeGreaterThan(0.3);
    expect(mapPressure(0.3, firm)).toBeLessThan(0.3);
    expect(mapPressure(1, soft)).toBe(1);
  });
  it('threshold and full strength stretch the useful range', () => {
    const p = { ...defaultPenPrefs(), threshold: 0.1, full: 0.6 };
    expect(mapPressure(0.05, p)).toBe(0);
    expect(mapPressure(0.35, p)).toBeCloseTo(0.5, 6);
    expect(mapPressure(0.8, p)).toBe(1);
  });
  it('reads stored prefs safely', () => {
    expect(readPenPrefs(null)).toEqual(defaultPenPrefs());
    expect(readPenPrefs({ version: 2, firmness: 1 })).toEqual(defaultPenPrefs());
    const r = readPenPrefs({ version: 1, firmness: 9, threshold: 0.3, full: 0.1, tilt: false, eraserEnd: 'yes', barrel: 'x' });
    expect(r.firmness).toBe(1);
    expect(r.full).toBeCloseTo(0.35, 6);
    expect(r.tilt).toBe(false);
    expect(r.eraserEnd).toBe(true);
    expect(r.barrel).toBe('menu');
    for (const b of ['pan', 'zoom', 'eraser'] as const) expect(readPenPrefs({ version: 1, barrel: b }).barrel).toBe(b);
  });
  it('reads the canvas cursor choice and builds its CSS', () => {
    expect(readPenPrefs({ version: 1 }).cursor).toBe('crosshair');
    expect(readPenPrefs({ version: 1, cursor: 'dot' }).cursor).toBe('dot');
    expect(readPenPrefs({ version: 1, cursor: 'sparkles' }).cursor).toBe('crosshair');
    expect(readPenPrefs({ version: 1 }).touchHold).toBe('eyedropper');
    expect(readPenPrefs({ version: 1, touchHold: 'menu' }).touchHold).toBe('menu');
    expect(readPenPrefs({ version: 1, touchHold: 'dance' }).touchHold).toBe('eyedropper');
    expect(canvasCursorCss('crosshair')).toBe('crosshair');
    expect(canvasCursorCss('none')).toBe('none');
    for (const k of ['circle', 'dot'] as const) expect(canvasCursorCss(k)).toMatch(/^url\("data:image\/svg\+xml,.+"\) \d+ \d+, crosshair$/);
    // Brush size: the ring's picture grows with the brush on screen, hotspot in the middle
    const size = (css: string) => Number(/width%3D%22(\d+)%22/.exec(css)![1]);
    const hot = (css: string) => /"\) (\d+) (\d+),/.exec(css)!.slice(1).map(Number);
    const small = canvasCursorCss('brush', 10), big = canvasCursorCss('brush', 80);
    expect(size(big)).toBeGreaterThan(size(small));
    expect(hot(big)).toEqual([Math.floor(size(big) / 2), Math.floor(size(big) / 2)]);
    // too big for a cursor picture, or a tool without a size
    expect(canvasCursorCss('brush', 400)).toBe('crosshair');
    expect(canvasCursorCss('brush', 0)).toBe(canvasCursorCss('circle'));
  });
});

describe('pen probe', () => {
  it('finds pressure, tilt, eraser, side button and hover', () => {
    const probe = new PenProbe();
    probe.observe(pen(0, 0));
    for (let i = 0; i < 3; i++) stroke(probe, Array.from({ length: 60 }, (_, k) => 0.2 + k / 1024), { tiltX: 20 });
    probe.observe(pen(0.4, 32));
    probe.observe(pen(0.4, 2));
    const c = probe.caps();
    expect(c).toMatchObject({ pen: true, pressure: 'yes', tilt: true, eraser: true, barrel: true, hover: true, strokes: 3 });
    expect(c.levels).toBe(1024);
    expect(c.maxPressure).toBeCloseTo(0.2 + 59 / 1024, 6);
  });
  it('warns once when a pen keeps reporting 0.5', () => {
    const probe = new PenProbe();
    const flat = Array(10).fill(0.5) as number[];
    expect(stroke(probe, flat)).toBe(false);
    expect(stroke(probe, flat)).toBe(true);
    expect(stroke(probe, flat)).toBe(false);
    expect(probe.caps().pressure).toBe('none');
    stroke(probe, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(probe.caps().pressure).toBe('yes');
  });
  it('ignores taps and remembers a mouse', () => {
    const probe = new PenProbe();
    expect(stroke(probe, [0.5, 0.5])).toBe(false);
    expect(probe.caps().strokes).toBe(0);
    const mouse = new PenProbe();
    mouse.observe({ ...pen(0.5), type: 'mouse' });
    expect(mouse.caps()).toMatchObject({ pen: false, lastType: 'mouse' });
  });
});

describe('pen diagnosis', () => {
  it('names the platform', () => {
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32')).toBe('windows');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel')).toBe('mac');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe('ios');
    expect(platformOf('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64')).toBe('linux');
  });
  it('points a mouse-only Windows tablet at Windows Ink', () => {
    const probe = new PenProbe();
    probe.observe({ ...pen(0.5), type: 'mouse' });
    const d = diagnosePen(probe.caps(), 'windows');
    expect(d.summary).toMatch(/mouse/);
    expect(d.tips[0]).toMatch(/Windows Ink/);
  });
  it('describes a pen without pressure, and a light hand', () => {
    const flat = new PenProbe();
    stroke(flat, Array(8).fill(0.5) as number[]); stroke(flat, Array(8).fill(0.5) as number[]);
    expect(diagnosePen(flat.caps(), 'mac').tips[0]).toMatch(/Accessibility/);
    const light = new PenProbe();
    for (let i = 0; i < 3; i++) stroke(light, [0.1, 0.2, 0.3, 0.4, 0.3, 0.2]);
    const d = diagnosePen(light.caps(), 'other');
    expect(d.summary).toMatch(/^Pen with pressure/);
    expect(d.tips.join(' ')).toMatch(/40% pressure/);
  });
});
