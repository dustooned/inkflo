import { expect, it } from 'vitest';
import { artCorners, distortMesh, meshBounds, meshFromFlat, meshToFlat, sampleMesh, unitToQuad, warpAt, warpMesh, warpNodes } from './meshwarp';
import { boxFromBounds } from './xformbox';

const rect = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }];
const near = (p: { x: number; y: number }, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };

it('maps the unit square onto a quad, with perspective when it is not a parallelogram', () => {
  const trap = [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }];
  const at = unitToQuad(trap);
  near(at(0, 0), 1, 0); near(at(1, 0), 3, 0); near(at(1, 1), 4, 2); near(at(0, 1), 0, 2);
  // the middle of a trapezoid's top-to-bottom axis sits nearer the narrow end than a plain average would put it
  expect(at(0.5, 0.5).y).toBeLessThan(1);
  near(unitToQuad(rect)(0.25, 0.5), 1, 1);
});

it('builds a distort mesh whose corners are the quad corners', () => {
  const m = distortMesh(rect, 6);
  near(m.pts[0]!, 0, 0); near(m.pts[6]!, 4, 0); near(m.pts.at(-1)!, 4, 2); near(m.pts[42]!, 0, 2);
  near(m.pts[3 * 7 + 3]!, 2, 1);
});

it('a warp grid at rest is the plain rectangle, and the surface passes through every node', () => {
  const nodes = warpNodes(rect);
  expect(nodes).toHaveLength(16);
  near(warpMesh(nodes, 15).pts[7 * 16 + 7]!, 4 * 7 / 15, 2 * 7 / 15);
  const pulled = nodes.map((p, i) => (i === 5 ? { x: p.x + 0.8, y: p.y - 0.5 } : p));
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) near(warpAt(pulled, i / 3, j / 3), pulled[j * 4 + i]!.x, pulled[j * 4 + i]!.y);
  // pulling one node bends its neighbourhood but leaves the far corner alone
  near(warpAt(pulled, 1, 1), 4, 2);
});

it('samples a mesh bilinearly and finds its bounds', () => {
  const m = distortMesh(rect, 4);
  near(sampleMesh(m, 0.5, 0.5), 2, 1);
  near(sampleMesh(m, 1, 1), 4, 2);
  expect(meshBounds(m)).toEqual({ x0: 0, y0: 0, x1: 4, y1: 2 });
});

it('round-trips through the saved form and rejects a damaged one', () => {
  const m = distortMesh(rect, 3);
  expect(meshFromFlat(meshToFlat(m))).toEqual(m);
  expect(meshFromFlat({ cols: 3, rows: 3, pts: [1, 2, 3] })).toBeNull();
  expect(meshFromFlat({ cols: 0, rows: 3, pts: [] })).toBeNull();
  expect(meshFromFlat({ cols: 1, rows: 1, pts: [0, 0, 1, 0, 0, 1, Number.NaN, 1] })).toBeNull();
});

it('swaps corners for a flipped box so the art stays on its own corners', () => {
  const b = boxFromBounds({ x0: 0, y0: 0, x1: 4, y1: 2 });
  expect(artCorners(b)[0]).toEqual({ x: 0, y: 0 });
  near(artCorners({ ...b, fx: -1 })[0]!, 4, 0);
  near(artCorners({ ...b, fy: -1 })[0]!, 0, 2);
  near(artCorners({ ...b, fx: -1, fy: -1 })[0]!, 4, 2);
});
