import type { Pt } from '../doc/model';
import type { Mat } from '../engine/core/selxform';
import { artCorners, distortMesh, warpMesh, warpNodes, type Mesh } from '../geom/meshwarp';
import {
  boxFrame, changeMatrix, fitBox, flipBox, grabBox, moveBox, pinchBox, pivotFraction, pivotPoint, resizeOBox, rotateOBox,
  sameBox, snapBoxToPage, turnBox, wrapDegrees, type BoxGrab, type OBox,
} from '../geom/xformbox';
import { h, seg } from './dom';
import { icon, type IconName } from './icons';
import { drawMeshHandles, drawTransformBox } from './selectiongesture';

export type ScaleMode = 'freeform' | 'uniform' | 'distort' | 'warp';

/** Two fingers on the canvas, as the desk reports them (page units). */
export interface PinchGesture {
  /** Where the fingers' midpoint started. */
  anchor: Pt;
  /** Where it is now. */
  to: Pt;
  /** Spread now ÷ spread at the start. */
  scale: number;
  /** Twist since the start, radians. */
  turn: number;
}

export interface TransformBoxOptions {
  /** Screen pixels per document unit. */
  scale: () => number;
  /** Smallest box side, in document units. */
  minSize: number;
  /** The box moved: repaint the canvas. */
  changed: () => void;
  /** The controls need rebuilding (a toggle flipped). */
  chrome: () => void;
  /** Offer Distort and Warp (tools whose art can be bent, not just placed). */
  meshModes?: boolean;
}

export interface GestureView {
  /** The extra zoom of a moved panel's placement (1 for the page itself). */
  k?: number;
  /** The page, for edge and centre snapping; null when the art sits in a moved panel's own space. */
  extent?: { w: number; h: number } | null;
}

/**
 * The state and gestures of the Procreate-style transform box, shared by the paint and line tools: the
 * box, its pivot, drags on a handle, two-finger pinch and twist, snapping, and the bar controls.
 * It never touches the art: callers read `matrix()` and apply it however they store things.
 */
export function createTransformBox(o: TransformBoxOptions) {
  let orig: OBox | null = null;
  let box: OBox | null = null;
  let pivot: Pt = { x: 0, y: 0 };
  let pivotOn = false;
  let scaleMode: ScaleMode = 'freeform';
  let snapping = false;
  let drag: { grab: BoxGrab; from: Pt; start: OBox; startPivot: Pt; moved: boolean; k: number; extent: GestureView['extent'] } | null = null;
  let readout: { text: string; at: Pt } | null = null;
  let guides: { x?: number; y?: number } | null = null;
  let pinchBase: OBox | null = null;
  let cached: { box: OBox; m: Mat | null } | null = null;
  // Distort (4 corners) and Warp (4 × 4 nodes): points in document units, row-major
  let nodes: Pt[] | null = null;
  let meshMoved = false;
  let meshCache: { nodes: Pt[]; mode: ScaleMode; mesh: Mesh } | null = null;
  let nodeDrag: { index: number; from: Pt; start: Pt[]; moved: boolean; k: number } | null = null;
  let nodeBase: Pt[] | null = null;
  const inMesh = () => !!o.meshModes && (scaleMode === 'distort' || scaleMode === 'warp');
  function ensureNodes(): Pt[] | null {
    if (!inMesh() || !box) return null;
    if (!nodes) {
      const quad = artCorners(box);
      nodes = scaleMode === 'distort' ? quad : warpNodes(quad);
      meshMoved = false;
    }
    return nodes;
  }
  /** Outer ring of the node grid, in order, for hit-testing "inside". */
  const hull = (pts: Pt[]): Pt[] => (scaleMode === 'distort' ? pts : [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4].map((i) => pts[i]!));
  function insideHull(poly: Pt[], p: Pt): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function set(next: OBox): boolean {
    if (!orig || !changeMatrix(orig, next)) return false;
    box = next;
    return true;
  }

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  function sizeText(b: OBox): string {
    const x = b.w / orig!.w, y = b.h / orig!.h;
    return Math.abs(x - y) < 0.005 ? pct(x) : `${pct(x)} × ${pct(y)}`;
  }

  const api = {
    /** Begin a box around freshly selected art. */
    start(b: OBox): void { api.clear(); orig = b; box = b; },
    /** The art now sits where the box is (a move was committed): the box becomes the new starting point. */
    rebase(b?: OBox): void { if (box) { box = { ...(b ?? box), fx: 1, fy: 1 }; orig = box; cached = null; nodes = null; meshMoved = false; meshCache = null; } },
    clear(): void {
      orig = null; box = null; drag = null; readout = null; guides = null; pinchBase = null; cached = null;
      nodes = null; meshMoved = false; meshCache = null; nodeDrag = null; nodeBase = null;
      pivot = { x: 0, y: 0 }; pivotOn = false;
    },
    reset(): void { if (orig) { box = orig; nodes = null; meshMoved = false; pivot = { x: 0, y: 0 }; o.changed(); o.chrome(); } },
    active: () => !!box,
    dragging: () => !!drag || !!nodeDrag,
    /** What the current drag took hold of. */
    grab: (): BoxGrab | null => drag?.grab ?? (nodeDrag ? { kind: 'resize', sx: 1, sy: 1 } : null),
    box: () => box,
    orig: () => orig,
    moved: () => (inMesh() ? meshMoved : !!box && !!orig && !sameBox(box, orig)),
    /** In Distort or Warp: the mesh the art is bent through; null otherwise. */
    mesh(): Mesh | null {
      const pts = ensureNodes();
      if (!pts) return null;
      if (meshCache?.nodes !== pts || meshCache.mode !== scaleMode) meshCache = { nodes: pts, mode: scaleMode, mesh: scaleMode === 'distort' ? distortMesh(pts) : warpMesh(pts) };
      return meshCache.mesh;
    },
    /** The matrix that carries the art from where it was selected to where the box is now. */
    matrix(): Mat | null {
      if (!box || !orig || inMesh()) return null;
      if (cached?.box !== box) cached = { box, m: changeMatrix(orig, box) };
      return cached.m;
    },
    /** The pivot in document units, or null while it is hidden. */
    pivot: () => (box && pivotOn ? pivotPoint(box, pivot) : null),

    /** A press at `p`. True when it took hold of the box (the caller then leaves the press alone). */
    down(p: Pt, e: Pick<PointerEvent, 'pointerType'>, view: GestureView = {}): boolean {
      if (!box) return false;
      const k = view.k ?? 1, s = o.scale() * k;
      const pts = ensureNodes();
      if (pts) {
        const reach = (e.pointerType === 'touch' ? 13 : 8) / s;
        let best = -1, bestD = Infinity;
        pts.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bestD) { bestD = d; best = i; } });
        if (bestD <= reach) { nodeDrag = { index: best, from: p, start: pts, moved: false, k }; return true; }
        if (insideHull(hull(pts), p)) { nodeDrag = { index: -1, from: p, start: pts, moved: false, k }; return true; }
        return false;
      }
      const grab = grabBox(boxFrame(box, s), p, s, { touch: e.pointerType === 'touch', pivot: api.pivot() });
      if (!grab) return false;
      drag = { grab, from: p, start: box, startPivot: pivot, moved: false, k, extent: view.extent };
      return true;
    },

    move(p: Pt, e: Pick<PointerEvent, 'shiftKey' | 'altKey'>): void {
      if (nodeDrag) {
        const s = o.scale() * nodeDrag.k;
        if (!nodeDrag.moved && Math.hypot(p.x - nodeDrag.from.x, p.y - nodeDrag.from.y) * s < 2) return;
        nodeDrag.moved = true;
        let dx = p.x - nodeDrag.from.x, dy = p.y - nodeDrag.from.y;
        if (e.shiftKey && nodeDrag.index < 0) { if (Math.abs(dy) > Math.abs(dx)) dx = 0; else dy = 0; }
        const { index, start } = nodeDrag;
        nodes = start.map((q, i) => (index < 0 || i === index ? { x: q.x + dx, y: q.y + dy } : q));
        meshMoved = true;
        o.changed();
        return;
      }
      if (!drag || !orig) return;
      const s = o.scale() * drag.k;
      if (!drag.moved && Math.hypot(p.x - drag.from.x, p.y - drag.from.y) * s < 2) return;
      drag.moved = true;
      const { grab, start, from } = drag;
      guides = null;
      if (grab.kind === 'move') {
        let next = moveBox(start, { x: p.x - from.x, y: p.y - from.y }, e.shiftKey);
        if (snapping && drag.extent) {
          const snap = snapBoxToPage(next, drag.extent, 8 / s);
          next = snap.box;
          guides = snap.guides;
        }
        readout = null;
        set(next);
      } else if (grab.kind === 'rotate') {
        const about = pivotPoint(start, drag.startPivot);
        const hard = e.shiftKey ? { step: 15, tol: 180 } : snapping ? { step: 15, tol: 3.5 } : null;
        const r = rotateOBox(start, about, from, p, orig.a, hard);
        set(r.box);
        readout = { text: `${Math.round(r.degrees * 10) / 10}°`, at: p };
      } else if (grab.kind === 'pivot') {
        pivot = pivotFraction(start, p);
        readout = null;
      } else {
        const next = resizeOBox(start, grab.sx, grab.sy, from, p, {
          uniform: scaleMode === 'uniform' || e.shiftKey, centre: e.altKey, min: o.minSize, snapTo: snapping ? orig : null,
        });
        if (set(next)) readout = { text: sizeText(next), at: p };
      }
      o.changed();
    },

    up(): void { drag = null; nodeDrag = null; readout = null; guides = null; o.changed(); },

    /** Abandon the gesture in progress (a second finger landed, or the pointer was lost). */
    cancel(): void {
      if (drag) { box = drag.start; pivot = drag.startPivot; }
      if (nodeDrag) nodes = nodeDrag.start;
      nodeDrag = null;
      drag = null; readout = null; guides = null;
      o.changed();
    },

    /** Two fingers: pinch to scale, twist to turn, drift to move. Null ends the gesture. True when it was ours. */
    pinch(g: PinchGesture | null): boolean {
      if (!g) { pinchBase = null; nodeBase = null; readout = null; return false; }
      if (!box || !orig) return false;
      if (drag || nodeDrag) api.cancel();
      const pts = ensureNodes();
      if (pts) {
        nodeBase ??= pts;
        const c = Math.cos(g.turn), sn = Math.sin(g.turn);
        nodes = nodeBase.map((q) => {
          const x = (q.x - g.anchor.x) * g.scale, y = (q.y - g.anchor.y) * g.scale;
          return { x: g.anchor.x + c * x - sn * y + g.to.x - g.anchor.x, y: g.anchor.y + sn * x + c * y + g.to.y - g.anchor.y };
        });
        meshMoved = true;
        o.changed();
        return true;
      }
      pinchBase ??= box;
      const next = pinchBox(pinchBase, g.anchor, { x: g.to.x - g.anchor.x, y: g.to.y - g.anchor.y }, g.scale, g.turn);
      if (next.w < o.minSize || next.h < o.minSize || !set(next)) return true;
      o.changed();
      return true;
    },

    flip(axis: 'h' | 'v'): void { if (box && set(flipBox(box, axis))) o.changed(); },
    rotateBy(degrees: number): void { if (box && set(turnBox(box, degrees))) o.changed(); },
    fit(extent: { w: number; h: number }): void { if (box && set(fitBox(box, extent))) o.changed(); },
    /** Degrees of turn from the original, for hints. */
    angle: () => (box && orig ? wrapDegrees((box.a - orig.a) * 180 / Math.PI) : 0),

    overlay(g: CanvasRenderingContext2D, scale: number, view: GestureView = {}): void {
      if (!box) return;
      const pts = ensureNodes();
      if (pts) { drawMeshHandles(g, api.mesh()!, pts, scale, view.k ?? 1); return; }
      drawTransformBox(g, box, {
        scale, k: view.k ?? 1, pivot: api.pivot(), readout, guides, extent: view.extent ?? undefined,
      });
    },

    /** The bar: how it scales, snapping, the pivot, flips, turn, fit and reset. */
    controls(view: {
      extent?: () => { w: number; h: number } | null;
      /** For tools that apply each change as it happens: called with a label after a button changes the box. */
      commit?: (label: string) => void;
      /** Offer Reset (tools that apply as they go have nothing to reset to). Default true. */
      reset?: boolean;
    } = {}): HTMLElement[] {
      const bent = inMesh();
      const on = !!box && !bent;
      const toggle = (label: string, pressed: boolean, title: string, run: () => void) =>
        h('button', { class: 'btn', type: 'button', 'aria-pressed': String(pressed), disabled: !on, title, onclick: run }, label);
      const action = (label: string, title: string, run: () => void, disabled = !on, glyph?: IconName) =>
        h('button', { class: 'btn', type: 'button', disabled, title, onclick: run }, glyph ? icon(glyph, 16) : null, label);
      const extent = view.extent?.() ?? null;
      return [
        seg<ScaleMode>([
          { id: 'freeform', label: 'Freeform', icon: 'scaleFreeform', hint: 'Each side stretches on its own' },
          { id: 'uniform', label: 'Uniform', icon: 'scaleUniform', hint: 'Keep proportions. Shift does this for one drag' },
          ...(o.meshModes ? [
            { id: 'distort' as const, label: 'Distort', icon: 'scaleDistort' as const, hint: 'Pull each corner on its own, with perspective' },
            { id: 'warp' as const, label: 'Warp', icon: 'scaleWarp' as const, hint: 'Bend the art by pulling points on a grid' },
          ] : []),
        ], scaleMode, (v) => { scaleMode = v; nodes = null; meshMoved = false; nodeBase = null; o.chrome(); o.changed(); }, 'Transform scale'),
        toggle('Snapping', snapping, 'Snap turns to 15°, size to 100%, and position to the page edges and centre', () => { snapping = !snapping; o.chrome(); }),
        toggle('Pivot', pivotOn, 'Show the pivot the box turns about. Drag it to move it', () => { pivotOn = !pivotOn; o.chrome(); o.changed(); }),
        action('Flip horizontal', 'Mirror left and right', () => { api.flip('h'); view.commit?.('Flip selection horizontally'); }),
        action('Flip vertical', 'Mirror top and bottom', () => { api.flip('v'); view.commit?.('Flip selection vertically'); }),
        action('Rotate 45°', 'Turn a further 45° about the centre', () => { api.rotateBy(45); view.commit?.('Rotate selection'); }),
        ...(extent ? [action('Fit to page', 'Scale to fill the page, keeping proportions', () => { api.fit(extent); view.commit?.('Fit selection to page'); })] : []),
        ...(view.reset === false ? [] : [action('Reset', 'Put it back as it was selected', () => api.reset(), !api.moved(), 'resetBox')]),
      ];
    },
  };
  return api;
}
