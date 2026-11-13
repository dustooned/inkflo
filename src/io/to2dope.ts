/**
 * Motion comic → 2Dope (BUILD-HANDOFF M6: "the same file opens in 2Dope as a scene").
 *
 * Writes a standard `.2dope` project (2Dope's `project.json`, schema 3, plus `assets/*.png`):
 * - one comp per page, with one drawings layer per panel (its ink on the Line plane, its paper
 *   and colour on the Fill plane), one layer per balloon (appearing when the camera reaches its
 *   panel), and a paper layer underneath;
 * - a main "Motion comic" comp that plays the pages in order, with a camera keyed to show each
 *   page whole and then move panel to panel in reading order, easing between holds.
 *
 * Nothing here is rendered: this module builds the JSON from layer descriptions (pure, tested
 * against 2Dope's own validator); `io/motionrender.ts` paints the PNGs in the browser.
 *
 * Format reference: 2Dope docs/project-format.md ("project.json", "How a frame is built").
 */

export const TWO_DOPE_SCHEMA = 3;
export const CAPTION_SCHEMA = 10;

/** 2Dope's lettering sizes as a share of the frame height, and its scale range. */
const SIZE_FRACTION = { small: 0.026, body: 0.034, big: 0.06 } as const;

/**
 * A caption already in comp pixels, with its type size (px), as 2Dope stores it: 2Dope sizes
 * lettering as Small/Body/Big × scale (0.5–3) of the frame height, so the step whose scale is
 * nearest 1 is chosen. Very small print sizes come out a little larger (scale floor 0.5), which
 * suits a screen anyway.
 */
export function twoDopeCaption(cap: Record<string, unknown> & { size: string; scale?: number }, sizePx: number, frameH: number): Record<string, unknown> {
  let best: { size: keyof typeof SIZE_FRACTION; scale: number } | null = null;
  for (const size of ['small', 'body', 'big'] as const) {
    const scale = Math.max(0.5, Math.min(3, sizePx / (SIZE_FRACTION[size] * frameH)));
    if (!best || Math.abs(Math.log(scale)) < Math.abs(Math.log(best.scale))) best = { size, scale };
  }
  const out: Record<string, unknown> = { ...cap, size: best!.size };
  if (Math.abs(best!.scale - 1) > 1e-3) out.scale = Number(best!.scale.toFixed(3));
  else delete out.scale;
  return out;
}

type Vec2 = [number, number];
interface Side {
  interp: 'linear' | 'hold' | 'bezier';
  slope?: number;
  influence?: number;
}
interface Key<T> {
  f: number;
  v: T;
  in: Side;
  out: Side;
}
interface PropFile<T> {
  value: T;
  keys?: Key<T>[];
}
export interface TwoDopeLayer {
  id: string;
  name: string;
  kind: 'drawings' | 'comp' | 'camera';
  start: number;
  in: number;
  out: number | null;
  parent: null;
  visible: boolean;
  locked: boolean;
  label: number;
  blend: 'normal';
  transform: { anchor: PropFile<Vec2>; position: PropFile<Vec2>; scale: PropFile<Vec2>; rotation: PropFile<number>; opacity: PropFile<number> };
  exposures?: { drawing: string; length: number; note?: string; dialogue?: string; action?: string }[];
  play?: 'once';
  comp?: string;
  /** A live caption (2Dope format 10). */
  caption?: Record<string, unknown>;
  zoom?: PropFile<number>;
}
export interface TwoDopeComp {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number | null;
  background: string | null;
  folder: string | null;
  layers: TwoDopeLayer[];
}
export interface TwoDopeProject {
  format: '2dope';
  schema: number;
  savedBy: string;
  name: string;
  created: string;
  modified: string;
  canvas: { width: number; height: number };
  fps: number;
  main: string;
  comps: Record<string, TwoDopeComp>;
  folders: Record<string, { name: string; parent: string | null }>;
  drawings: Record<string, { num: number; line: string | null; fill: string | null; vectors: never[] }>;
}

export interface MotionOptions {
  /** Pixels per inch of the 2Dope canvas. */
  dpi: number;
  fps: number;
  /** Seconds the whole page shows before the camera moves in. */
  pageHold: number;
  /** Seconds the camera holds on each panel. */
  panelHold: number;
  /** Seconds each camera move takes. */
  move: number;
  /** The motion comic's frame: 16:9 video, or the page's own shape (vertical). */
  frame: 'wide' | 'page';
  /** Balloons as live 2Dope captions (editable, animatable) or as images (exact print look). */
  captions: 'live' | 'image';
}

export const DEFAULT_MOTION: MotionOptions = { dpi: 150, fps: 24, pageHold: 1.5, panelHold: 2, move: 0.6, frame: 'wide', captions: 'live' };

/** The main comp's size: 16:9 HD (at most 1920×1080, even numbers for video), or the page. */
export function frameSize(page: { width: number; height: number }, frame: MotionOptions['frame']): { width: number; height: number } {
  if (frame === 'page') return page;
  const h = Math.min(page.height, 1080) & ~1;
  return { width: Math.round((h * 16) / 9) & ~1, height: h };
}

/** A rendered layer: its asset keys (`assets/<hash>.png`) or null for an empty plane. */
export interface LayerArt {
  line: string | null;
  fill: string | null;
}

export interface MotionPage {
  title: string;
  /** Page size in pixels at the export dpi (every page must match the project canvas). */
  paper: LayerArt;
  panels: { index: number; bbox: { x0: number; y0: number; x1: number; y1: number }; art: LayerArt; beat?: { desc: string; lines: string[] } }[];
  balloons: { name: string; panelIndex: number | null; art: LayerArt; text: string; caption?: Record<string, unknown>; rotation?: { degrees: number; pivot: Vec2 } }[];
  /** Art drawn over the frame (over-frame layers, Over-panels group): above the panels, under the balloons. */
  extras?: { name: string; panelIndex: number | null; art: LayerArt }[];
}

const still = <T>(value: T): PropFile<T> => ({ value });

function transform(w: number, h: number): TwoDopeLayer['transform'] {
  return { anchor: still<Vec2>([w / 2, h / 2]), position: still<Vec2>([w / 2, h / 2]), scale: still<Vec2>([100, 100]), rotation: still(0), opacity: still(100) };
}

function layer(id: string, name: string, kind: TwoDopeLayer['kind'], w: number, h: number, extra: Partial<TwoDopeLayer> = {}): TwoDopeLayer {
  return { id, name, kind, start: 0, in: 0, out: null, parent: null, visible: true, locked: false, label: 0, blend: 'normal', transform: transform(w, h), ...extra };
}

/**
 * Camera position and zoom (%) that frame a box. `box` is in main-comp pixels; `view` is the
 * main comp's size. Zoom never goes below `floor` (the whole-page view).
 */
export function frameBox(b: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, margin = 0.9, floor = 100): { pos: Vec2; zoom: number } {
  const bw = Math.max(1, b.x1 - b.x0);
  const bh = Math.max(1, b.y1 - b.y0);
  const zoom = Math.max(floor, Math.min(800, Math.min(w / bw, h / bh) * margin * 100));
  return { pos: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], zoom };
}

/** Panel order on a page: reading order, from the derived panels. */
export interface PageTiming {
  start: number;
  length: number;
  /** Frame (page time) the camera arrives at each panel, by panel index. */
  arrive: Map<number, number>;
}

export function pageTiming(panelCount: number, opt: MotionOptions, start: number): PageTiming {
  const f = (s: number) => Math.max(1, Math.round(s * opt.fps));
  const arrive = new Map<number, number>();
  let t = f(opt.pageHold);
  if (panelCount > 1) {
    for (let i = 0; i < panelCount; i++) {
      t += f(opt.move);
      arrive.set(i, t);
      t += f(opt.panelHold);
    }
  } else {
    arrive.set(0, 0);
    t += f(opt.panelHold);
  }
  return { start, length: t, arrive };
}

const EASE: Side = { interp: 'bezier', slope: 0, influence: 0.4 };
const HOLD: Side = { interp: 'hold' };

/**
 * Build the `.2dope` project for rendered pages. `size` is the page (and drawing canvas) size in
 * pixels. Page comps are page-sized; the main comp is `frameSize(size, opt.frame)` and shows each
 * page whole (fitted to its height) before the camera moves in.
 */
export function motionProject(name: string, pages: MotionPage[], size: { width: number; height: number }, opt: MotionOptions = DEFAULT_MOTION, now = new Date()): TwoDopeProject {
  const { width: W, height: H } = size;
  const view = frameSize(size, opt.frame);
  const MW = view.width;
  const MH = view.height;
  // page → main comp: centred, scaled so the whole page fits
  const k = Math.min(MW / W, MH / H);
  const toMain = (x: number, y: number): Vec2 => [MW / 2 + (x - W / 2) * k, MH / 2 + (y - H / 2) * k];
  const drawings: TwoDopeProject['drawings'] = {};
  const comps: Record<string, TwoDopeComp> = {};
  let dn = 0;
  const drawing = (art: LayerArt) => {
    dn += 1;
    const id = `d${dn}`;
    drawings[id] = { num: dn, line: art.line, fill: art.fill, vectors: [] };
    return id;
  };

  const posKeys: Key<Vec2>[] = [];
  const zoomKeys: Key<number>[] = [];
  const key = (f: number, pos: Vec2, zoom: number, inSide: Side, outSide: Side) => {
    const last = posKeys[posKeys.length - 1];
    if (last && last.f >= f) return; // keys must be strictly increasing
    posKeys.push({ f, v: pos, in: inSide, out: outSide });
    zoomKeys.push({ f, v: zoom, in: inSide, out: outSide });
  };

  const mainLayers: TwoDopeLayer[] = [];
  let clock = 0;
  pages.forEach((page, pi) => {
    const cid = `page${pi + 1}`;
    const timing = pageTiming(page.panels.length, opt, clock);
    const len = timing.length;
    const layers: TwoDopeLayer[] = [];
    // balloons on top, each appearing when the camera reaches its panel
    page.balloons.forEach((b, bi) => {
      const at = b.panelIndex === null ? 0 : (timing.arrive.get(b.panelIndex) ?? 0);
      const xform = transform(W, H);
      if (b.rotation) {
        xform.anchor = still(b.rotation.pivot);
        xform.position = still(b.rotation.pivot);
        xform.rotation = still(b.rotation.degrees);
      }
      layers.push(layer(`${cid}b${bi + 1}`, b.name, 'drawings', W, H, { in: at, transform: xform, exposures: [{ drawing: drawing(b.art), length: len, dialogue: b.text }], ...(b.caption ? { caption: b.caption } : {}) }));
    });
    // over-frame art, appearing with its panel
    (page.extras ?? []).forEach((x, xi) => {
      const at = x.panelIndex === null ? 0 : (timing.arrive.get(x.panelIndex) ?? 0);
      layers.push(layer(`${cid}x${xi + 1}`, x.name, 'drawings', W, H, { in: at, exposures: [{ drawing: drawing(x.art), length: len }] }));
    });
    // Panels in stacking order, frontmost first. Camera timing uses reading order.
    page.panels.forEach((p) => {
      const exposure: NonNullable<TwoDopeLayer['exposures']>[number] = { drawing: drawing(p.art), length: len };
      if (p.beat?.desc) exposure.action = p.beat.desc;
      if (p.beat?.lines.length) exposure.dialogue = p.beat.lines.join('\n');
      layers.push(layer(`${cid}p${p.index + 1}`, `Panel ${p.index + 1}`, 'drawings', W, H, { exposures: [exposure] }));
    });
    layers.push(layer(`${cid}paper`, 'Paper', 'drawings', W, H, { locked: true, exposures: [{ drawing: drawing(page.paper), length: len }] }));
    comps[cid] = { name: page.title, width: W, height: H, fps: opt.fps, duration: len, background: null, folder: 'pages', layers };
    const pl = layer(`L${cid}`, page.title, 'comp', W, H, { comp: cid, start: clock, in: clock, out: clock + len, play: 'once' });
    pl.transform.position = still<Vec2>([MW / 2, MH / 2]);
    pl.transform.scale = still<Vec2>([k * 100, k * 100]);
    mainLayers.push(pl);

    // camera: whole page, then each panel in reading order
    const full: Vec2 = [MW / 2, MH / 2];
    key(clock, full, 100, HOLD, EASE);
    if (page.panels.length > 1) {
      const holdEnd = Math.round(opt.pageHold * opt.fps);
      key(clock + holdEnd, full, 100, EASE, EASE);
      const ordered = [...page.panels].sort((a, b) => a.index - b.index);
      ordered.forEach((p, i) => {
        const arrive = clock + timing.arrive.get(p.index)!;
        const [x0, y0] = toMain(p.bbox.x0, p.bbox.y0);
        const [x1, y1] = toMain(p.bbox.x1, p.bbox.y1);
        const { pos, zoom } = frameBox({ x0, y0, x1, y1 }, MW, MH);
        const isLast = i === ordered.length - 1;
        key(arrive, pos, zoom, EASE, EASE);
        const leave = arrive + Math.max(1, Math.round(opt.panelHold * opt.fps));
        // the next page starts by cutting to its full view, so the last hold ends on a hold key
        if (leave < clock + len || !isLast) key(Math.min(leave, clock + len - 1), pos, zoom, EASE, isLast ? HOLD : EASE);
        else posKeys[posKeys.length - 1]!.out = HOLD;
      });
    }
    clock += len;
  });

  const camera = layer('camera', 'Camera', 'camera', MW, MH, {
    zoom: zoomKeys.length > 1 ? { value: 100, keys: zoomKeys } : still(100),
  });
  camera.transform.position = posKeys.length > 1 ? { value: [MW / 2, MH / 2], keys: posKeys } : still<Vec2>([MW / 2, MH / 2]);
  comps.main = { name: 'Motion comic', width: MW, height: MH, fps: opt.fps, duration: clock, background: '#EFE7D6', folder: null, layers: [camera, ...mainLayers.reverse()] };

  const iso = now.toISOString();
  return {
    format: '2dope',
    // live captions need a 2Dope that reads format 10; plain images open in any 2Dope from schema 3
    schema: pages.some((p) => p.balloons.some((b) => b.caption)) ? CAPTION_SCHEMA : TWO_DOPE_SCHEMA,
    savedBy: 'inkflo 0.0.1',
    name,
    created: iso,
    modified: iso,
    canvas: { width: W, height: H },
    fps: opt.fps,
    main: 'main',
    comps,
    folders: { pages: { name: 'Pages', parent: null } },
    drawings,
  };
}
