import { expect, it } from 'vitest';
import { applyPoint } from '../engine/core/selxform';
import {
  boxCorners, boxFromBounds, boxFrame, changeMatrix, fitBox, flipBox, grabBox, moveBox, pinchBox, pivotFraction, pivotPoint,
  resizeOBox, rotateKnob, rotateOBox, sameBox, snapBoxToPage, snapDegrees, turnBox, type OBox,
} from './xformbox';

const box = boxFromBounds({ x0: 2, y0: 1, x1: 6, y1: 3 }); // 4 × 2 about (4, 2)
const near = (p: { x: number; y: number }, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };
const opts = { uniform: false, centre: false, min: 0.01 };

it('carries art onto the new box: a corner of the old box lands on the matching corner of the new one', () => {
  const next = turnBox({ ...box, w: 8 }, 90);
  const m = changeMatrix(box, next)!;
  const from = boxCorners(box), to = boxCorners(next);
  from.forEach((p, i) => { const [x, y] = applyPoint(m, p.x, p.y); near({ x, y }, to[i]!.x, to[i]!.y); });
});

it('does not drift: turning there and back leaves the art where it began', () => {
  const there = rotateOBox(box, { x: 4, y: 2 }, { x: 8, y: 2 }, { x: 4, y: 6 }, 0, null);
  expect(there.degrees).toBeCloseTo(90, 6);
  const back = rotateOBox(there.box, { x: 4, y: 2 }, { x: 4, y: 6 }, { x: 8, y: 2 }, 0, null);
  expect(sameBox({ ...back.box, a: 0 }, box)).toBe(true);
});

it('stretches a turned box along its own edge, not along the screen', () => {
  const turned: OBox = { ...box, a: Math.PI / 2 }; // its "right" edge now points down the screen
  const handle = rotateKnob(turned, 1);
  expect(handle.x).toBeGreaterThan(turned.cx); // knob sits on the turned top edge
  const from = { x: 4, y: 4 }; // the box's right-edge handle after the turn
  const next = resizeOBox(turned, 1, 0, from, { x: 4, y: 5 }, opts);
  expect(next.w).toBeCloseTo(5, 6);
  expect(next.h).toBeCloseTo(2, 6);
  // the far edge stays where it was
  const far = (b: OBox) => boxCorners(b)[0]!;
  near(far(next), far(turned).x, far(turned).y);
  // a pull across the edge does nothing
  expect(resizeOBox(turned, 1, 0, from, { x: 9, y: 4 }, opts).w).toBeCloseTo(4, 6);
});

it('keeps proportions for a uniform corner drag and for a side handle', () => {
  const c = resizeOBox(box, 1, 1, { x: 6, y: 3 }, { x: 8, y: 3.1 }, { ...opts, uniform: true });
  expect(c.w / c.h).toBeCloseTo(2, 6);
  const s = resizeOBox(box, 1, 0, { x: 6, y: 2 }, { x: 8, y: 2 }, { ...opts, uniform: true });
  expect(s.w).toBeCloseTo(6, 6);
  expect(s.h).toBeCloseTo(3, 6);
  near({ x: s.cx, y: s.cy }, 5, 2); // left edge held, vertical middle held
});

it('scales about the centre with Alt and snaps back to 100% when close', () => {
  const c = resizeOBox(box, 1, 1, { x: 6, y: 3 }, { x: 7, y: 4 }, { ...opts, centre: true });
  near({ x: c.cx, y: c.cy }, 4, 2);
  expect(c.w).toBeCloseTo(6, 6);
  const s = resizeOBox(box, 1, 0, { x: 6, y: 2 }, { x: 6.05, y: 2 }, { ...opts, snapTo: box });
  expect(s.w).toBe(4);
  expect(resizeOBox(box, 1, 0, { x: 6, y: 2 }, { x: -9, y: 2 }, opts).w).toBe(0.01);
});

it('rotates about a moved pivot and snaps to 15°', () => {
  const r = rotateOBox(box, { x: 2, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 3 }, 0, null);
  expect(r.degrees).toBeCloseTo(90, 6);
  near({ x: r.box.cx, y: r.box.cy }, 2 - 1, 1 + 2); // centre swung a quarter turn about the top-left corner
  const to = { x: 4 + 4 * Math.cos(16 * Math.PI / 180), y: 2 + 4 * Math.sin(16 * Math.PI / 180) };
  const free = rotateOBox(box, { x: 4, y: 2 }, { x: 8, y: 2 }, to, 0, null).degrees;
  const snapped = rotateOBox(box, { x: 4, y: 2 }, { x: 8, y: 2 }, to, 0, { step: 15, tol: 180 }).degrees;
  expect(free).toBeCloseTo(16, 6);
  expect(snapped).toBe(15);
  expect(snapDegrees(44), 'soft snap').toBe(45);
  expect(snapDegrees(40)).toBe(40);
});

it('grabs the right thing, including just outside a corner', () => {
  const frame = boxFrame(box, 100);
  const at = (x: number, y: number) => grabBox(frame, { x, y }, 100)?.kind ?? null;
  expect(at(4, 2)).toBe('move');
  expect(at(6, 3)).toBe('resize');
  expect(at(6.1, 3.1)).toBe('rotate'); // a hair outside the corner turns it
  expect(at(4, 0.77)).toBe('rotate'); // the knob
  expect(at(9, 9)).toBeNull();
  expect(grabBox(frame, { x: 4.01, y: 2 }, 100, { pivot: { x: 4, y: 2 } })?.kind).toBe('pivot');
  // a turned box is grabbed where it is drawn
  const t: OBox = { ...box, a: Math.PI / 2 };
  expect(grabBox(t, { x: 4, y: 4 }, 100)).toEqual({ kind: 'resize', sx: 1, sy: 0 });
});

it('hides side handles on a tiny box but keeps it grabbable', () => {
  const tiny = boxFromBounds({ x0: 1, y0: 1, x1: 1.01, y1: 1.01 });
  const frame = boxFrame(tiny, 96);
  expect(grabBox(frame, { x: 1.005, y: 1.005 }, 96, { touch: true })?.kind).toBe('move');
  expect(grabBox(frame, boxCorners(frame)[2]!, 96, { touch: true })?.kind).toBe('resize');
});

it('flips without moving the handles, and the art mirrors', () => {
  const f = flipBox(box, 'h');
  const m = changeMatrix(box, f)!;
  const [x, y] = applyPoint(m, 2, 1); // left edge → right edge
  near({ x, y }, 6, 1);
  expect(boxCorners(f)).toEqual(boxCorners(box));
});

it('moves with an axis lock and snaps to page edges and centre', () => {
  expect(moveBox(box, { x: 3, y: 1 }, true)).toMatchObject({ cx: 7, cy: 2 });
  const { box: snapped, guides } = snapBoxToPage(moveBox(box, { x: -1.97, y: 2.5 }), { w: 8.5, h: 11 }, 0.1);
  expect(snapped.cx - snapped.w / 2).toBeCloseTo(0, 6);
  expect(guides).toEqual({ x: 0 });
  const centred = snapBoxToPage(moveBox(box, { x: 0.05, y: 0 }), { w: 8, h: 4 }, 0.1);
  expect(centred.guides).toEqual({ x: 4, y: 2 });
});

it('pinches and twists about the fingers, then follows their drift', () => {
  const p = pinchBox(box, { x: 4, y: 2 }, { x: 1, y: 0 }, 2, Math.PI / 2);
  expect(p).toMatchObject({ w: 8, h: 4 });
  near({ x: p.cx, y: p.cy }, 5, 2);
  expect(p.a).toBeCloseTo(Math.PI / 2, 6);
  const q = pinchBox(box, { x: 0, y: 0 }, { x: 0, y: 0 }, 2, 0);
  near({ x: q.cx, y: q.cy }, 8, 4);
});

it('fits to the page and keeps the pivot with the box', () => {
  const fit = fitBox(turnBox(box, 90), { w: 8, h: 10 }, 0.5);
  near({ x: fit.cx, y: fit.cy }, 4, 5);
  expect(fit.w).toBeCloseTo(9, 6); // turned 90°: it covers 2 × 4, so the 9-tall limit wins (×2.25)
  expect(fit.h).toBeCloseTo(4.5, 6);
  const f = pivotFraction(box, { x: 2, y: 1 });
  expect(f).toEqual({ x: -0.5, y: -0.5 });
  const moved = moveBox(turnBox(box, 30), { x: 1, y: 1 });
  near(pivotPoint(moved, f), boxCorners(moved)[0]!.x, boxCorners(moved)[0]!.y);
});
