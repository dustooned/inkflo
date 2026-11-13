import { describe, expect, it } from 'vitest';
import { anchorCanvasView, canvasGeometry, HOME_VIEW, normalizeAngle } from './canvasview';

const stage = { width: 1080, height: 800 };
const page = { width: 8, height: 10 };

describe('canvas view', () => {
  it('maps hits back to page coordinates after a full turn, pan and zoom', () => {
    const g = canvasGeometry(stage, page, { zoom: 3, panX: -34, panY: 78, angle: 255 });
    const point = { x: 3.8, y: 8.2 };
    const hit = g.toPage(g.toStage(point));
    expect(hit.x).toBeCloseTo(point.x);
    expect(hit.y).toBeCloseTo(point.y);
    expect(normalizeAngle(255)).toBe(-105);
    expect(normalizeAngle(-181)).toBe(179);
  });

  it('holds an off-centre anchor while a two-finger gesture pans, scales and turns', () => {
    const view = { ...HOME_VIEW };
    const anchor = canvasGeometry(stage, page, view).toPage({ x: 350, y: 360 });
    const position = { x: 450, y: 420 };
    view.zoom = 1.8;
    view.angle = 72;
    anchorCanvasView(stage, page, view, anchor, position);
    const projected = canvasGeometry(stage, page, view).toStage(anchor);
    expect(projected.x).toBeCloseTo(position.x);
    expect(projected.y).toBeCloseTo(position.y);
  });
});
