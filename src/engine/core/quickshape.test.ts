// Vendored from 2Dope src/core/quickshape.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { constrainShape, editShape, fitAs, recognizeShape, shapeOutline, type V } from './quickshape';

/** A wobbly hand-drawn version of a path (deterministic). */
function wobble(p: V[], amount: number): V[] {
  return p.map((q, i) => ({ x: q.x + Math.sin(i * 1.7) * amount, y: q.y + Math.cos(i * 2.3) * amount }));
}
function along(pts: V[], per = 20): V[] {
  const out: V[] = [];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < per; k++) out.push({ x: pts[i]!.x + ((pts[i + 1]!.x - pts[i]!.x) * k) / per, y: pts[i]!.y + ((pts[i + 1]!.y - pts[i]!.y) * k) / per });
  out.push(pts[pts.length - 1]!);
  return out;
}
function ellipse(cx: number, cy: number, rx: number, ry: number, from = 0, to = 2 * Math.PI, n = 80): V[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });
}

describe('QuickShape', () => {
  it('fits elongated rotated ovals without shrinking the long axis or inventing corners', () => {
    for (const ratio of [1, 2, 4, 6]) for (const rot of [0, 0.6, 1.4]) {
      const points = ellipse(0, 0, 120, 120 / ratio, 0.7, 0.7 + 2 * Math.PI, 240).map(q => ({
        x: 230 + q.x * Math.cos(rot) - q.y * Math.sin(rot),
        y: 180 + q.x * Math.sin(rot) + q.y * Math.cos(rot),
      }));
      for (const s of [recognizeShape(points), fitAs('ellipse', points)]) {
        expect(s?.kind).toBe('ellipse');
        if (s?.kind !== 'ellipse') continue;
        expect(Math.abs(s.cx - 230)).toBeLessThan(0.2);
        expect(Math.abs(s.cy - 180)).toBeLessThan(0.2);
        expect(Math.abs(s.rx - 120)).toBeLessThan(0.2);
        expect(Math.abs(s.ry - 120 / ratio)).toBeLessThan(0.2);
        // Compare the actual contour, including orientation, rather than just fit parameters.
        const c = Math.cos(rot), n = Math.sin(rot);
        for (const q of shapeOutline(s, 8)) {
          const x = (q.x - 230) * c + (q.y - 180) * n;
          const y = -(q.x - 230) * n + (q.y - 180) * c;
          expect(Math.abs(Math.hypot(x / 120, y / (120 / ratio)) - 1)).toBeLessThan(0.01);
        }
      }
    }
  });

  it('keeps a noisy narrow oval smooth and close to its drawn bounds', () => {
    const s = recognizeShape(wobble(ellipse(200, 200, 120, 30, 0.4, 0.4 + 2 * Math.PI, 240), 1));
    expect(s?.kind).toBe('ellipse');
    if (s?.kind === 'ellipse') {
      expect(Math.abs(s.rx - 120)).toBeLessThan(2);
      expect(Math.abs(s.ry - 30)).toBeLessThan(2);
    }
  });

  it('fits line direction from the stroke instead of a shaky final point', () => {
    const points = Array.from({ length: 101 }, (_, i) => ({ x: i * 2, y: i === 100 ? 10 : Math.sin(i) * 0.5 }));
    for (const s of [recognizeShape(points), fitAs('line', points)]) {
      expect(s?.kind).toBe('line');
      if (s?.kind === 'line') {
        expect(Math.abs(s.b.y - s.a.y)).toBeLessThan(3);
        expect(s.b.x - s.a.x).toBeGreaterThan(195);
      }
    }
    const reversed = fitAs('line', [...points].reverse());
    expect(reversed?.kind === 'line' && reversed.a.x > reversed.b.x).toBe(true);
  });

  it('keeps square orientation when choosing Rectangle after recognition', () => {
    const rot = 0.4;
    const points = along([{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }, { x: -50, y: -50 }], 40)
      .map(q => ({ x: q.x * Math.cos(rot) - q.y * Math.sin(rot), y: q.x * Math.sin(rot) + q.y * Math.cos(rot) }));
    const s = fitAs('rect', points);
    expect(s?.kind).toBe('rect');
    if (s?.kind === 'rect') {
      expect(Math.abs(s.w - 50)).toBeLessThan(2);
      expect(Math.abs(s.h - 50)).toBeLessThan(2);
      expect(Math.abs(Math.sin(4 * (s.rot - rot)))).toBeLessThan(0.05);
    }
  });

  it('rejects a line as an ellipse and keeps a closed-stroke Line conversion usable', () => {
    expect(fitAs('ellipse', along([{ x: 0, y: 0 }, { x: 200, y: 0 }]))).toBeNull();
    const s = fitAs('line', ellipse(0, 0, 90, 40));
    expect(s?.kind === 'line' && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeGreaterThan(170);
  });

  it('ignores tiny strokes and scribbles', () => {
    expect(
      recognizeShape([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ]),
    ).toBeNull();
    const scribble = Array.from({ length: 200 }, (_, i) => ({ x: (i * 37) % 100, y: (i * 61) % 90 }));
    expect(recognizeShape(scribble)).toBeNull();
  });

  it('a nearly straight stroke is a line', () => {
    const s = recognizeShape(
      wobble(
        along([
          { x: 10, y: 10 },
          { x: 210, y: 60 },
        ]),
        2,
      ),
    );
    expect(s?.kind).toBe('line');
  });

  it('a rough circle and a rough ellipse are ellipses', () => {
    const c = recognizeShape(wobble(ellipse(100, 100, 60, 60, 0, 2 * Math.PI + 0.1), 2));
    expect(c?.kind).toBe('ellipse');
    if (c?.kind === 'ellipse') {
      expect(c.cx).toBeCloseTo(100, -1);
      expect(c.rx).toBeGreaterThan(50);
      expect(c.rx).toBeLessThan(70);
    }
    const e = recognizeShape(wobble(ellipse(100, 100, 90, 40, 0, 2 * Math.PI), 1.5));
    expect(e?.kind).toBe('ellipse');
    if (e?.kind === 'ellipse') expect(e.rx / e.ry).toBeGreaterThan(1.8);
  });

  it('a rough square is a rectangle; a triangle is a polygon', () => {
    const sq = recognizeShape(
      wobble(
        along([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
          { x: 0, y: 3 },
        ]),
        1.5,
      ),
    );
    expect(sq?.kind).toBe('rect');
    if (sq?.kind === 'rect') {
      expect(sq.w).toBeGreaterThan(40);
      expect(sq.w).toBeLessThan(60);
    }
    const tri = recognizeShape(
      wobble(
        along([
          { x: 0, y: 100 },
          { x: 60, y: 0 },
          { x: 120, y: 100 },
          { x: 2, y: 98 },
        ]),
        1.5,
      ),
    );
    expect(tri?.kind).toBe('polygon');
    if (tri?.kind === 'polygon') expect(tri.pts).toHaveLength(3);
  });

  it('an open curve is an arc; an open zigzag is a polyline', () => {
    const arc = recognizeShape(wobble(ellipse(0, 0, 100, 100, 0, Math.PI * 0.8), 1));
    expect(arc?.kind).toBe('arc');
    const zig = recognizeShape(
      wobble(
        along([
          { x: 0, y: 0 },
          { x: 60, y: 80 },
          { x: 120, y: 0 },
          { x: 180, y: 80 },
        ]),
        1,
      ),
    );
    expect(zig?.kind).toBe('polyline');
  });

  it('editing keeps the first point and drags the second', () => {
    // line: the start stays, the end follows the pen
    const moved = editShape({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { x: 10, y: 0 }, { x: 30, y: 5 });
    expect(moved.kind === 'line' && moved.a).toEqual({ x: 0, y: 0 });
    expect(moved.kind === 'line' && moved.b).toEqual({ x: 30, y: 5 });
    // polyline: only the last point moves
    const pl = editShape(
      {
        kind: 'polyline',
        pts: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 0 },
        ],
      },
      { x: 20, y: 0 },
      { x: 25, y: 5 },
    );
    expect(pl.kind === 'polyline' && pl.pts).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 25, y: 5 },
    ]);
    // ellipse grabbed on its right edge: the left edge stays; the other axis follows in proportion
    const e = editShape({ kind: 'ellipse', cx: 0, cy: 0, rx: 50, ry: 30, rot: 0 }, { x: 50, y: 0 }, { x: 150, y: 0 });
    expect(e.kind === 'ellipse' && [e.cx, e.rx, e.ry]).toEqual([50, 100, 60]);
    // rectangle grabbed at a corner: the opposite corner stays, width and height separately
    const r = editShape({ kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rot: 0 }, { x: 10, y: 10 }, { x: 30, y: 20 });
    expect(r.kind === 'rect' && [r.cx, r.cy, r.w, r.h]).toEqual([10, 5, 20, 15]);
    const sq = editShape({ kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rot: 0 }, { x: 10, y: 10 }, { x: 30, y: 20 }, true);
    expect(sq.kind === 'rect' && sq.w === sq.h).toBe(true);
    // arc: pinned at its start, its end lands on the pen
    const arc = editShape({ kind: 'arc', cx: 0, cy: 0, r: 10, start: 0, sweep: Math.PI }, { x: -10, y: 0 }, { x: -20, y: 0 });
    expect(arc.kind === 'arc' && arc.r).toBeCloseTo(15);
    const end = arc.kind === 'arc' ? { x: arc.cx + Math.cos(arc.start + arc.sweep) * arc.r, y: arc.cy + Math.sin(arc.start + arc.sweep) * arc.r } : null;
    expect(end!.x).toBeCloseTo(-20);
    expect(end!.y).toBeCloseTo(0);
    // perfect versions
    const circle = constrainShape({ kind: 'ellipse', cx: 0, cy: 0, rx: 50, ry: 30, rot: 0 });
    expect(circle.kind === 'ellipse' && circle.rx === circle.ry).toBe(true);
    const line = constrainShape({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 3 } });
    expect(line.kind === 'line' && line.b.y).toBeCloseTo(0);
  });

  it('outlines close and keep corners', () => {
    const o = shapeOutline({ kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, rot: 0 }, 3);
    expect(o[0]).toEqual(o[o.length - 1]);
    expect(o).toContainEqual({ x: 10, y: 10 });
    const e = shapeOutline({ kind: 'ellipse', cx: 0, cy: 0, rx: 20, ry: 20, rot: 0 }, 3);
    for (const q of e) expect(Math.hypot(q.x, q.y)).toBeCloseTo(20);
  });
});

describe('QuickShape pressure', () => {
  it('keeps the thick and thin of the stroke along the shape', async () => {
    const { pressureProfile, sampleProfile } = await import('./quickshape');
    // a line drawn light at the start and heavy at the end
    const stroke = Array.from({ length: 50 }, (_, i) => ({ x: i * 4, y: 0, pressure: 0.1 + (0.8 * i) / 49 }));
    const prof = pressureProfile({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 196, y: 0 } }, stroke);
    expect(sampleProfile(prof, 0)).toBeLessThan(0.25);
    expect(sampleProfile(prof, 1)).toBeGreaterThan(0.75);
    expect(sampleProfile(prof, 0.5)).toBeCloseTo(0.5, 1);
  });
});

describe('Edit shape: fit the stroke as a chosen shape', () => {
  it('turns one stroke into each shape', async () => {
    const { fitAs } = await import('./quickshape');
    // a rough, slightly squashed circle
    const stroke = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 79) * Math.PI * 2;
      return { x: 100 + Math.cos(a) * 60 + Math.sin(i * 1.3) * 2, y: 100 + Math.sin(a) * 45 };
    });
    expect(fitAs('line', stroke)?.kind).toBe('line');
    expect(fitAs('ellipse', stroke)?.kind).toBe('ellipse');
    const c = fitAs('circle', stroke);
    expect(c?.kind === 'ellipse' && c.rx === c.ry).toBe(true);
    const r = fitAs('rect', stroke);
    expect(r?.kind === 'rect' && r.w).toBeGreaterThan(r?.kind === 'rect' ? r.h : 0);
    const sq = fitAs('square', stroke);
    expect(sq?.kind === 'rect' && sq.w === sq.h).toBe(true);
    expect(fitAs('arc', stroke)?.kind).toBe('arc');
    expect(fitAs('polyline', stroke)?.kind).toBe('polyline');
    expect(fitAs('line', [{ x: 0, y: 0 }])).toBeNull();
  });
});
