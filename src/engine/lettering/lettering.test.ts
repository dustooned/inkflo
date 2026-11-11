// Vendored from 2Dope src/lettering/lettering.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { balloonOutline, balloonProfile, balloonShapes, detectBalloon, fitCaption, inside, mergeTail, normalizeOutline, reshapeOutline, shapeForText, turnOutline, type Pt } from './geometry';
import { captionValue, defaultCaption, readCaption, readLook } from './spec';
import { BUNDLED_FONTS, bundledFile, familyName, isFontFile } from './fonts';

const mono = (size: number) => (t: string) => t.length * size * 0.6;
const ellipse = (a: number, b: number, n = 200): Pt[] => Array.from({ length: n }, (_, i) => ({ x: Math.cos((i / n) * Math.PI * 2) * a, y: Math.sin((i / n) * Math.PI * 2) * b }));

describe('lettering stays portable', () => {
  it('imports nothing from the app (so a comics app can reuse it)', () => {
    const files = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    for (const [f, src] of Object.entries(files).filter(([f]) => !f.endsWith('.test.ts'))) {
      const imports = [...src.matchAll(/from '([^']+)'/g)].map(m => m[1]!);
      expect(imports.filter(i => !i.startsWith('./')), f).toEqual([]);
    }
  });
});

describe('text sets the balloon', () => {
  const o = { size: 34, leading: 1.15, maxA: 1000, maxB: 600 };
  it('grows with the words at a fixed lettering size and shapes lines like a diamond', () => {
    const short = fitCaption('HEY!', 'speech', mono(34), o), long = fitCaption('WAIT FOR ME, I LEFT MY LUNCH ON THE BUS!', 'speech', mono(34), o);
    expect(short.lines).toHaveLength(1);
    expect(long.lines.length).toBeGreaterThanOrEqual(3);
    expect(long.a).toBeGreaterThan(short.a);
    const widths = long.lines.map(l => l.width), mid = Math.floor(widths.length / 2);
    expect(widths[mid]).toBeGreaterThanOrEqual(widths[0]!);
    expect(widths[mid]).toBeGreaterThanOrEqual(widths[widths.length - 1]!);
    // every line fits inside the ellipse with room for the ink
    for (const l of long.lines) expect((l.width / 2 / long.a) ** 2 + (l.y / long.b) ** 2).toBeLessThan(1);
  });
  it('a wider balloon setting gives fewer, longer lines; the letters keep their size', () => {
    const text = 'WAIT FOR ME, I LEFT MY LUNCH ON THE BUS AND MY HOMEWORK TOO!';
    const usual = fitCaption(text, 'speech', mono(34), o), wide = fitCaption(text, 'speech', mono(34), { ...o, aspect: 2.2 }), tall = fitCaption(text, 'speech', mono(34), { ...o, aspect: 0.6 });
    expect(wide.lines.length).toBeLessThan(usual.lines.length);
    expect(tall.lines.length).toBeGreaterThan(usual.lines.length);
    expect(wide.a / wide.b).toBeGreaterThan(usual.a / usual.b);
    for (const f of [wide, tall]) for (const l of f.lines) expect((l.width / 2 / f.a) ** 2 + (l.y / f.b) ** 2).toBeLessThan(1);
    expect(readCaption({ ...defaultCaption(0, 0), shape: 9 }).shape).toBe(2.5);
    expect(readCaption({ ...defaultCaption(0, 0), shape: 1 }).shape).toBeUndefined();
  });
  it('keeps the student’s own line breaks, and never squeezes past the frame', () => {
    const own = fitCaption('ONE\nTWO WORDS', 'speech', mono(34), o);
    expect(own.lines.map(l => l.text)).toEqual(['ONE', 'TWO WORDS']);
    const huge = fitCaption(Array(200).fill('WORD').join(' '), 'speech', mono(34), { ...o, maxA: 300, maxB: 200 });
    expect(huge.tooLong).toBe(true);
    const sfx = fitCaption('POW', 'sfx', mono(80), o);
    expect(sfx.lines).toHaveLength(1);
  });
});

describe('balloons and tails', () => {
  it('draws closed outlines for every style', () => {
    for (const s of ['speech', 'whisper', 'thought', 'shout', 'box'] as const) {
      const p = balloonOutline(s, 120, 80, 3);
      expect(p.length).toBeGreaterThan(20);
      expect(inside(p, { x: 0, y: 0 })).toBe(true);
      expect(inside(p, { x: 400, y: 0 })).toBe(false);
    }
  });
  it('merges a tail into the outline, or falls back to a seam, never a broken outline', () => {
    const m = mergeTail(ellipse(120, 80), { x: -60, y: 200 }, null, 30)!;
    expect(m.some(p => Math.hypot(p.x + 60, p.y - 200) < 1)).toBe(true);
    expect(inside(m, { x: 0, y: 0 })).toBe(true);
    const shapes = balloonShapes(balloonOutline('speech', 120, 80), [{ x: 200, y: 260, join: 'merged', width: 1 }, { x: -220, y: -200, join: 'bubbles', width: 1 }, { x: 260, y: -120, join: 'lightning', width: 1 }], 0, 0, 30);
    expect(shapes.bubbles).toHaveLength(3);
    expect(shapes.zigzags).toHaveLength(1);
    expect(shapes.outline.some(p => Math.hypot(p.x - 200, p.y - 260) < 1) || shapes.seams.length === 1).toBe(true);
  });
});

describe('detecting a drawn balloon', () => {
  it('recognises a sloppy oval, box and star, and an open line', () => {
    const wobble = (pts: Pt[]) => pts.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * 1.5, y: p.y + Math.cos(i * 2.3) * 1.5 }));
    expect(detectBalloon(wobble(ellipse(150, 100)))).toBe('speech');
    // a long, flat oval is still an oval, not a box
    expect(detectBalloon(ellipse(90, 50))).toBe('speech');
    expect(detectBalloon(ellipse(200, 60).map((p, i) => ({ x: p.x + Math.sin(i * 0.4) * 2, y: p.y + Math.cos(i * 0.3) * 2 })))).toBe('speech');
    const box: Pt[] = [];
    for (let i = 0; i < 50; i++) box.push({ x: -150 + i * 6, y: -90 });
    for (let i = 0; i < 30; i++) box.push({ x: 150, y: -90 + i * 6 });
    for (let i = 0; i < 50; i++) box.push({ x: 150 - i * 6, y: 90 });
    for (let i = 0; i < 30; i++) box.push({ x: -150, y: 90 - i * 6 });
    expect(detectBalloon(wobble(box))).toBe('box');
    const star = Array.from({ length: 24 }, (_, i) => { const t = (i / 24) * Math.PI * 2, r = i % 2 ? 90 : 150; return { x: Math.cos(t) * r, y: Math.sin(t) * r }; });
    const drawn: Pt[] = [];
    star.forEach((p, i) => { const q = star[(i + 1) % star.length]!; for (let k = 0; k < 8; k++) drawn.push({ x: p.x + ((q.x - p.x) * k) / 8, y: p.y + ((q.y - p.y) * k) / 8 }); });
    expect(detectBalloon(drawn)).toBe('shout');
    expect(detectBalloon(ellipse(150, 100).slice(0, 80))).toBe('open');
  });
});

describe('caption data', () => {
  it('reads back what it writes, clamps values and refuses unknown versions', () => {
    const c = { ...defaultCaption(100, 80), text: 'HI', values: { reveal: 50, tracking: 900 } };
    const back = readCaption(JSON.parse(JSON.stringify(c)));
    expect(back.text).toBe('HI');
    expect(captionValue(back, 'reveal')).toBe(50);
    expect(captionValue(back, 'tracking')).toBe(300);
    expect(captionValue(back, 'balloon')).toBe(100);
    expect(() => readCaption({ v: 2 })).toThrow();
    expect(readCaption({ v: 1, style: 'nope', font: '../evil' }).style).toBe('speech');
  });
  it('lists only fonts with files, and names faces uniquely', () => {
    for (const f of BUNDLED_FONTS) expect(f.files.regular).toMatch(/\.ttf$/);
    expect(bundledFile(BUNDLED_FONTS.find(f => f.id === 'bangers')!, true, false)).toEqual({ file: 'Bangers-Regular.ttf', synthetic: true });
    expect(familyName('comic-neue', true, true)).not.toBe(familyName('comic-neue', true, false));
    expect(isFontFile('a.ttf', new Uint8Array([0, 1, 0, 0]))).toBe(true);
    expect(isFontFile('a.woff2', new TextEncoder().encode('wOF2'))).toBe(true);
    expect(isFontFile('a.png', new Uint8Array([0, 1, 0, 0]))).toBe(false);
  });
});

describe('balloon looks', () => {
  const o = { size: 34, leading: 1.15, maxA: 1000, maxB: 600 };
  const text = 'WAIT FOR ME, I LEFT MY LUNCH ON THE BUS AND MY HOMEWORK TOO!';
  it('the classic balloon is fuller than an oval, so the same words need a smaller one', () => {
    const oval = fitCaption(text, 'speech', mono(34), { ...o, profile: balloonProfile('speech', { round: 2 }) });
    const classic = fitCaption(text, 'speech', mono(34), { ...o, profile: balloonProfile('speech') });
    expect(classic.a * classic.b).toBeLessThan(oval.a * oval.b);
    // its outline at 45° sits outside the oval's (flatter top and bottom, fuller corners)
    const pts = balloonOutline('speech', 100, 60, 1, undefined, { wobble: 0 }), corner = pts[Math.round(pts.length / 8)]!;
    expect((corner.x / 100) ** 2 + (corner.y / 60) ** 2).toBeGreaterThan(1.05);
  });
  it('wobble only swells outward, and is the same every time for a caption', () => {
    const plain = balloonOutline('speech', 100, 60, 5, undefined, { wobble: 0 }), inked = balloonOutline('speech', 100, 60, 5, undefined, { wobble: 1 });
    inked.forEach((p, i) => expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(Math.hypot(plain[i]!.x, plain[i]!.y) - 1e-9));
    expect(balloonOutline('speech', 100, 60, 5, undefined, { wobble: 1 })).toEqual(inked);
  });
  it('sets spikes and bumps by count', () => {
    const shout = balloonOutline('shout', 100, 60, 1, undefined, { spikes: 7 });
    expect(shout).toHaveLength(14);
    const deep = balloonOutline('shout', 100, 60, 1, undefined, { spikes: 7, spikeDepth: 0.8 });
    expect(Math.max(...deep.map(p => Math.abs(p.x)))).toBeGreaterThan(Math.max(...shout.map(p => Math.abs(p.x))));
    const cloud = balloonOutline('thought', 100, 60, 1, undefined, { bumps: 5, bumpDepth: 0.3 });
    expect(cloud.length).toBeGreaterThan(100);
  });
  it('fits words inside a custom outline, even one that pinches in', () => {
    // an hourglass-ish lozenge: narrow at the top and bottom
    const raw: Pt[] = [];
    for (let i = 0; i < 120; i++) { const t = (i / 120) * Math.PI * 2; raw.push({ x: Math.cos(t) * (300 - 120 * Math.abs(Math.sin(t)) ** 3), y: Math.sin(t) * 140 }); }
    const unit = normalizeOutline(raw);
    expect(unit.every(([x, y]) => Math.abs(x) <= 1.001 && Math.abs(y) <= 1.001)).toBe(true);
    const fit = fitCaption(text, 'custom', mono(34), { ...o, profile: balloonProfile('custom', { outline: unit }) });
    const poly = balloonOutline('custom', fit.a, fit.b, 1, undefined, { outline: unit, wobble: 0 });
    for (const l of fit.lines) for (const sx of [-1, 1]) for (const sy of [-1, 1]) expect(inside(poly, { x: (sx * l.width) / 2, y: l.y + (sy * 34) / 2 })).toBe(true);
  });
  it('reads looks back clamped, and drops a broken outline', () => {
    expect(readLook({ round: 99, spikes: 2.6, wobble: -1 })).toEqual({ round: 8, spikes: 4, wobble: 0 });
    expect(readLook({ outline: [[0, 0], [1, 0]] })).toBeNull();
    expect(readCaption({ ...defaultCaption(0, 0), look: { bumps: 9 } }).look).toEqual({ bumps: 9 });
  });
});

describe('custom shapes for words', () => {
  const spread = (u: [number, number][]) => { const xs = u.map(p => p[0]), ys = u.map(p => p[1]); return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
  it('turns a tall or tilted shape so its long side runs with the words', () => {
    const tilted: Pt[] = [];
    for (let i = 0; i < 100; i++) { const t = (i / 100) * Math.PI * 2, x = Math.cos(t) * 200, y = Math.sin(t) * 70; tilted.push({ x: x * Math.cos(1.1) - y * Math.sin(1.1), y: x * Math.sin(1.1) + y * Math.cos(1.1) }); }
    const u = shapeForText(tilted);
    // normalised to a unit box, but the profile is wide: the middle row is nearly full width
    const mid = u.filter(([, y]) => Math.abs(y) < 0.05).map(([x]) => Math.abs(x));
    expect(Math.max(...mid)).toBeGreaterThan(0.95);
    const level: Pt[] = tilted.map(p => ({ x: p.x * Math.cos(-1.1) - p.y * Math.sin(-1.1), y: p.x * Math.sin(-1.1) + p.y * Math.cos(-1.1) }));
    expect(spread(shapeForText(level, false)).w).toBeCloseTo(2, 1);
  });
  it('centres the words on a lopsided shape', () => {
    // a balloon that bulges on the left (like a hand-inked one)
    const raw: Pt[] = [];
    for (let i = 0; i < 120; i++) { const t = (i / 120) * Math.PI * 2, c = Math.cos(t); raw.push({ x: c * (c < 0 ? 260 : 140), y: Math.sin(t) * 90 }); }
    const u = shapeForText(raw, false), xs = u.filter(([, y]) => Math.abs(y) < 0.05).map(([x]) => x);
    expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(0.05);
  });
  it('turns, mirrors and reshapes smoothly', () => {
    const u = shapeForText(Array.from({ length: 80 }, (_, i) => ({ x: Math.cos((i / 80) * 6.283) * 300, y: Math.sin((i / 80) * 6.283) * 100 })));
    const turned = turnOutline(u, 'turn');
    expect(turned).toHaveLength(u.length);
    const m = turnOutline(u, 'mirror');
    expect(m.every(([x, y]) => Math.abs(x) <= 1.01 && Math.abs(y) <= 1.01)).toBe(true);
    const pulled = reshapeOutline(u, 0, 0.3, 0);
    expect(pulled[0]![0]).toBeCloseTo(u[0]![0] + 0.3, 3);
    expect(pulled[1]![0] - u[1]![0]).toBeGreaterThan(0.2);
    expect(pulled[40]).toEqual(u[40]);
  });
});

describe('each tail style has its own settings', () => {
  const ring = balloonOutline('speech', 120, 70, 1, undefined, { wobble: 0 });
  const area = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]!; return s + a.x * b.y - b.x * a.y; }, 0) / 2);
  it('bubbles: count, size and shrink', () => {
    const three = balloonShapes(ring, [{ x: 0, y: 260, join: 'bubbles', width: 1 }], 0, 0, 30).bubbles;
    const five = balloonShapes(ring, [{ x: 0, y: 260, join: 'bubbles', width: 1, count: 5, size: 2, shrink: 0 }], 0, 0, 30).bubbles;
    expect(three).toHaveLength(3);
    expect(five).toHaveLength(5);
    expect(five[0]!.r).toBeGreaterThan(three[0]!.r * 1.9);
    expect(five[4]!.r).toBeCloseTo(five[0]!.r, 6);
    expect(three[2]!.r).toBeLessThan(three[0]!.r * 0.5);
  });
  it('lightning: zigs and swing', () => {
    const z = balloonShapes(ring, [{ x: 0, y: 260, join: 'lightning', width: 1, zigs: 6, amp: 2 }], 0, 0, 30).zigzags[0]!;
    expect(z).toHaveLength(13);
    const narrow = balloonShapes(ring, [{ x: 0, y: 260, join: 'lightning', width: 1, zigs: 6 }], 0, 0, 30).zigzags[0]!;
    expect(Math.max(...z.map(p => Math.abs(p.x)))).toBeGreaterThan(Math.max(...narrow.map(p => Math.abs(p.x))) * 1.8);
  });
  it('joined and seam: taper and a blunt tip change the wedge', () => {
    const sharp = balloonShapes(ring, [{ x: 0, y: 260, join: 'seam', width: 1.2 }], 0, 0, 30).seams[0]!;
    const fat = balloonShapes(ring, [{ x: 0, y: 260, join: 'seam', width: 1.2, taper: 2.5, tip: 0.4 }], 0, 0, 30).seams[0]!;
    expect(area(fat)).toBeGreaterThan(area(sharp) * 1.3);
    const joined = balloonShapes(ring, [{ x: 0, y: 260, join: 'merged', width: 1.2, taper: 0.5 }], 0, 0, 30);
    expect(joined.seams).toHaveLength(0);
    expect(readCaption({ ...defaultCaption(0, 0), tails: [{ x: 1, y: 2, join: 'bubbles', width: 1, count: 30, shrink: -2 }] }).tails[0]).toMatchObject({ count: 8, shrink: 0 });
  });
});

describe('a tail that follows a layer', () => {
  it('keeps the layer and its spot when read back, and drops a malformed one', () => {
    const c = readCaption({ ...defaultCaption(0, 0), tails: [{ x: 1, y: 2, join: 'merged', width: 1, follow: { layer: 'L7', at: [30, 40] } }] });
    expect(c.tails[0]!.follow).toEqual({ layer: 'L7', at: [30, 40] });
    const bad = readCaption({ ...defaultCaption(0, 0), tails: [{ x: 1, y: 2, join: 'merged', width: 1, follow: { layer: '<script>', at: [1] } }] });
    expect(bad.tails[0]!.follow).toBeUndefined();
  });
});
