import type { Pt } from '../doc/model';

export interface CanvasView { zoom: number; panX: number; panY: number; angle: number }
interface ViewSize { width: number; height: number }

export const HOME_VIEW: Readonly<CanvasView> = { zoom: 1, panX: 0, panY: 0, angle: 0 };
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 8;
export const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
export const normalizeAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const bearing = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

export function canvasGeometry(stage: ViewSize, page: ViewSize, view: CanvasView) {
  const s = Math.max(0.1, Math.min((stage.width - 56) / page.width, (stage.height - 56) / page.height)) * view.zoom;
  const radians = view.angle * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const cx = stage.width / 2 + view.panX, cy = stage.height / 2 + view.panY;
  const hw = page.width * s / 2, hh = page.height * s / 2;
  const ox = cx - cos * hw + sin * hh, oy = cy - sin * hw - cos * hh;

  return {
    s, cos, sin, ox, oy,
    toStage(p: Pt): Pt {
      return { x: ox + s * (cos * p.x - sin * p.y), y: oy + s * (sin * p.x + cos * p.y) };
    },
    toPage(p: Pt): Pt {
      const x = p.x - ox, y = p.y - oy;
      return { x: (cos * x + sin * y) / s, y: (-sin * x + cos * y) / s };
    },
  };
}

/** Keep a page point under the gesture as its position, scale, and angle change. */
export function anchorCanvasView(stage: ViewSize, page: ViewSize, view: CanvasView, anchor: Pt, position: Pt): void {
  const current = canvasGeometry(stage, page, view).toStage(anchor);
  view.panX += position.x - current.x;
  view.panY += position.y - current.y;
}
