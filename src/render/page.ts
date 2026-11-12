import { DEFAULT_SHEET, type Layer, type LayerGroup, type LayerType, type LetterSheet, type Page, type PlacedImage } from '../doc/model';
import type { PageArt } from '../draw/residency';
import { cutPath, derivePanels, layoutOf, panelAt, type Panel } from '../geom/carve';
import { paintLetter } from './caption';

/**
 * The one page renderer (rule 5). Screen, thumbnails, covers, print PNGs and every export draw
 * through `renderPage`, so what is approved on screen is what ships.
 *
 * Order: gutter paper → panel paper → Background layers → each panel group (clipped to its panel
 * when masked) → gutter bands and borders → over-frame layers → Over-panels group → balloons.
 * Gutter bands are drawn over masked art, and all ink rings are drawn before all paper fills, so
 * crossings show a clean plus.
 */

export const COLORS = {
  gutter: '#EFE7D6',
  panel: '#FFFDF7',
  ink: '#191A1F',
};

export interface RenderOptions {
  /** Pixels per inch of the target. */
  scale: number;
  /** Which layer types to draw (default: all). */
  types?: Partial<Record<LayerType, boolean>>;
  /** Leave out layers that don't print (pencil, reference): print and exports. */
  printOnly?: boolean;
  balloons?: boolean;
  /** Panel paper and gutters. Off = art only on a transparent page. */
  frame?: boolean;
  /** Use unprinted white paper for tonal separation. */
  whitePaper?: boolean;
  /** A replacement canvas for a layer (the live stroke while drawing), by layer id. */
  live?: Record<string, HTMLCanvasElement>;
  /** A temporary image transform shown while the user drags. */
  placement?: { id: string; image: PlacedImage };
  /** Pre-derived panels, when the caller already has them. */
  panels?: Panel[];
  /** Balloons to skip (being dragged on the overlay, for instance). */
  skipBalloon?: string;
  /** Only these groups' layers (export by panel). */
  onlyGroups?: Set<string>;
  /** The book's lettering style sheet (type sizes). */
  sheet?: LetterSheet;
}

/**
 * Draw `paint` (page-sized, origin at the trim) kept only inside the gutter bands: the same bands
 * the gutter paper is painted in, so gutter art fills the gutters exactly.
 */
export function inGutterBands(g: CanvasRenderingContext2D, page: Page, s: number, W: number, H: number, paint: (c: CanvasRenderingContext2D) => void): void {
  const gutter = layoutOf(page).gutter;
  if (!gutter) return;
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.ceil(W));
  off.height = Math.max(1, Math.ceil(H));
  const o = off.getContext('2d')!;
  paint(o);
  o.globalCompositeOperation = 'destination-in';
  o.lineCap = 'butt';
  o.lineJoin = 'round';
  o.lineWidth = gutter * s;
  o.strokeStyle = '#000';
  for (const c of page.cuts) o.stroke(openPath(cutPath(c, page), s));
  g.drawImage(off, 0, 0);
}

export function panelPath(pts: readonly { x: number; y: number }[], s: number): Path2D {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x * s, q.y * s) : p.moveTo(q.x * s, q.y * s)));
  p.closePath();
  return p;
}

function openPath(pts: readonly { x: number; y: number }[], s: number): Path2D {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x * s, q.y * s) : p.moveTo(q.x * s, q.y * s)));
  return p;
}

/** Gutter bands and trim border, on top of the panel art. */
export function drawGutters(g: CanvasRenderingContext2D, page: Page, s: number, opts: { paper?: boolean; whitePaper?: boolean } = {}): void {
  const { gutter, border } = layoutOf(page);
  const paths = page.cuts.map((c) => openPath(cutPath(c, page), s));
  g.save();
  g.beginPath();
  g.rect(0, 0, page.widthIn * s, page.heightIn * s);
  g.clip();
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  g.strokeStyle = COLORS.ink;
  if (gutter || border) {
    g.lineWidth = (gutter + border * 2) * s;
    for (const p of paths) g.stroke(p);
  }
  if (opts.paper === false) {
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = '#000';
  } else g.strokeStyle = opts.whitePaper ? '#FFFFFF' : COLORS.gutter;
  if (gutter) {
    g.lineWidth = gutter * s;
    for (const p of paths) g.stroke(p);
  }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = COLORS.ink;
  if (border) {
    g.lineWidth = border * s * 2;
    g.strokeRect(0, 0, page.widthIn * s, page.heightIn * s);
  }
  g.restore();
}

export function drawBalloons(g: CanvasRenderingContext2D, page: Page, s: number, sheet: LetterSheet = DEFAULT_SHEET, skip?: string): void {
  for (const l of page.balloons) if (l.id !== skip) paintLetter(g, l, sheet, s, page.widthIn, page.heightIn);
}

export function drawPagePaper(g: CanvasRenderingContext2D, page: Page, panels: Panel[], s: number, white = false): void {
  g.fillStyle = white ? '#FFFFFF' : COLORS.gutter;
  g.fillRect(0, 0, page.widthIn * s, page.heightIn * s);
  g.fillStyle = white ? '#FFFFFF' : COLORS.panel;
  for (const p of panels) g.fill(panelPath(p.pts, s));
}

/** Should this layer draw under these options? */
export function shows(layer: Layer, group: LayerGroup, opts: Pick<RenderOptions, 'types' | 'printOnly' | 'onlyGroups'>): boolean {
  if (!layer.visible || !group.visible) return false;
  if (opts.printOnly && !layer.prints) return false;
  if (opts.types && opts.types[layer.type] === false) return false;
  if (opts.onlyGroups && !opts.onlyGroups.has(group.id)) return false;
  return true;
}

/** Normal planes span the page. Imported planes are positioned in document units. */
export function drawLayerBitmap(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, w: number, h: number, scale: number, image?: PlacedImage): void {
  if (!image) {
    g.drawImage(canvas, 0, 0, w, h);
    return;
  }
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.translate(image.x * scale, image.y * scale);
  g.rotate(image.rotation * Math.PI / 180);
  const width = image.width * scale;
  const height = image.height * scale;
  g.drawImage(canvas, -width / 2, -height / 2, width, height);
  g.restore();
}

/** Draw a group's layers bottom to top (`which` picks masked or over-frame layers). */
function drawLayers(g: CanvasRenderingContext2D, group: LayerGroup, art: PageArt | null, opts: RenderOptions, W: number, H: number, which: 'all' | 'framed' | 'over'): void {
  for (let i = group.layers.length - 1; i >= 0; i--) {
    const l = group.layers[i]!;
    if (which === 'framed' && l.overFrame) continue;
    if (which === 'over' && !l.overFrame) continue;
    if (!shows(l, group, opts)) continue;
    const c = opts.live?.[l.id] ?? (art && !art.parked ? art.planes[l.id] : null);
    if (!c || !c.width) continue;
    g.globalAlpha = l.opacity * group.opacity;
    drawLayerBitmap(g, c, W, H, opts.scale, opts.placement?.id === l.id ? opts.placement.image : l.image);
  }
  g.globalAlpha = 1;
}

/** Draw a page onto a context sized `page × scale`. */
export function renderPage(g: CanvasRenderingContext2D, page: Page, art: PageArt | null, opts: RenderOptions): void {
  const s = opts.scale;
  const W = page.widthIn * s;
  const H = page.heightIn * s;
  const frame = opts.frame !== false;
  const panels = opts.panels ?? derivePanels(page);
  g.save();
  g.clearRect(0, 0, W, H);
  if (frame) drawPagePaper(g, page, panels, s, opts.whitePaper);
  g.imageSmoothingQuality = 'high';
  const bg = page.groups.filter((x) => x.kind === 'background');
  const panelGroups = page.groups.filter((x) => x.kind === 'panel');
  const over = page.groups.filter((x) => x.kind === 'over');
  for (const grp of bg) drawLayers(g, grp, art, opts, W, H, 'all');
  // panel groups, last first so the reading-order first panel is on top where groups overlap
  for (let i = panelGroups.length - 1; i >= 0; i--) {
    const grp = panelGroups[i]!;
    const panel = grp.anchor ? panelAt(panels, grp.anchor) : null;
    g.save();
    if (grp.mask) {
      if (!panel) {
        g.restore();
        continue; // a masked group with no panel has nowhere to show
      }
      g.clip(panelPath(panel.pts, s));
    }
    drawLayers(g, grp, art, opts, W, H, 'framed');
    g.restore();
  }
  if (frame) drawGutters(g, page, s, { whitePaper: opts.whitePaper });
  // the Gutters group: art in the gutters and margins (borderless pages), over the gutter paper
  for (const grp of page.groups.filter((x) => x.kind === 'gutter')) {
    if (!grp.layers.some((l) => shows(l, grp, opts))) continue;
    if (grp.mask) inGutterBands(g, page, s, W, H, (o) => drawLayers(o, grp, art, opts, W, H, 'all'));
    else drawLayers(g, grp, art, opts, W, H, 'all');
  }
  for (let i = panelGroups.length - 1; i >= 0; i--) drawLayers(g, panelGroups[i]!, art, opts, W, H, 'over');
  for (const grp of over) drawLayers(g, grp, art, opts, W, H, 'all');
  if (opts.balloons !== false) drawBalloons(g, page, s, opts.sheet, opts.skipBalloon);
  g.restore();
}

/** A small rendering of a page (thumbnails, covers). */
export function renderThumb(page: Page, art: PageArt | null, widthPx: number, into?: HTMLCanvasElement, sheet?: LetterSheet): HTMLCanvasElement {
  const s = widthPx / page.widthIn;
  const c = into ?? document.createElement('canvas');
  c.width = Math.round(page.widthIn * s);
  c.height = Math.round(page.heightIn * s);
  renderPage(c.getContext('2d')!, page, art, { scale: s, printOnly: true, sheet });
  return c;
}
