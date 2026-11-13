import type { CaptionSpec, LetterSize } from '../engine/lettering/spec';
import type { CaptionStyle } from '../engine/lettering/styles';
import type { BrushSettings } from '../engine/core/brush';

/**
 * The book document (BUILD-HANDOFF §3). This is the truth every desk edits.
 *
 * Panels, gutters, thumbnails and print sheets are derived from it and never stored (rule 1).
 * Art is a tree of typed layers in groups (EXPLORE-DESK-UI §2, §13): a Background group under
 * the panels, a group per detected panel (masked to the panel), and an Over-panels group on top.
 * Each layer keeps its strokes and fills as data; its pixels live on a canvas managed by
 * `draw/residency.ts` and are saved as content-addressed PNG assets (`doc/schema.ts`).
 */

export type Stage = 'script' | 'layout' | 'draw' | 'caption' | 'print';
export const STAGES: readonly Stage[] = ['script', 'layout', 'draw', 'caption', 'print'];

/** The line passes a brush can draw in (its colour and print behaviour). */
export type Pass = 'pencil' | 'ink' | 'colour';
export const PASSES: readonly Pass[] = ['pencil', 'ink', 'colour'];

export type CutMode = 'across' | 'panel';
export type StageState = 0 | 1 | 2; // todo / wip / done

export interface Pt {
  x: number;
  y: number;
}

export interface Cut {
  id: string;
  mode: CutMode;
  /** Raw stroke, page units (inches from the trim's top-left). */
  pts: Pt[];
  /** Frozen path for mode "panel"; absent for "across". */
  extended?: Pt[];
  /** Two cubic handles between the first and last boundary points. */
  handles?: [Pt, Pt];
}

export interface Beat {
  id: string;
  desc: string;
  lines: string[];
  dialogue?: DialogueLine[];
  reveal?: { pageId: string; beatId: string };
  card?: { ratio: number; strokes: Pt[][] };
}

export interface DialogueLine {
  id: string;
  /** A relative point inside the assigned panel. Absent uses the beat's reading order. */
  panel?: Pt;
  preset?: string;
  omit?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Lettering (EXPLORE-DESK-UI §6, §18)

/** Points per inch: lettering is stored in points, the unit printers and letterers use. */
export const PT = 72;

/**
 * One balloon, caption box or sound effect. `cap` is 2Dope's live caption model (balloon shape,
 * tails, font, colours…; `engine/lettering/spec.ts`) with every position and length in **points
 * on the page** (1/72 in). Type size comes from the book's style sheet (`LetterSheet`).
 */
export interface Letter {
  id: string;
  cap: CaptionSpec;
  /** Continuation of another balloon on the same page. Only the first balloon owns the script line. */
  continuation?: { after: string; join: 'merge' | 'stack' | 'separate' };
  /** Clockwise degrees around the caption centre. Tail tips stay in page coordinates. */
  rotation?: number;
  /** The script line this lettering comes from: beat id and line index. */
  src?: { beat: string; line: number; lineId?: string };
  /** Starter lettering may be repositioned or removed automatically until refined. */
  generated?: boolean;
  /** Who speaks (from "MAYA: …"), for character styles and renames. */
  speaker?: string;
  /** Small on purpose (whispers, background chatter): the readability guard leaves it alone. */
  smallOk?: boolean;
}

/** Kept as the old name for code that only needs "a balloon". */
export type Balloon = Letter;

/** The book's lettering style sheet: house sizes in pt, readability limits, and character styles. */
export interface LetterSheet {
  /** Type size in pt for Small, Body and Big. */
  sizes: Record<LetterSize, number>;
  /** Below this (pt, at print size) lettering is "at risk". */
  warnPt: number;
  /** Below this it "won't read well", and Keep readable snaps up to it. */
  minPt: number;
  /** Default font for new balloons (a bundled font id). */
  font: string;
  /** Character styles by speaker name in capitals. */
  characters: Record<string, CaptionStyle>;
  presets?: Record<string, CaptionStyle>;
  /** Extra outputs to check lettering at, besides print (readability TARGETS names). */
  checks?: string[];
}

export const DEFAULT_SHEET: LetterSheet = {
  sizes: { small: 7.5, body: 9, big: 15 },
  warnPt: 8,
  minPt: 6.5,
  font: 'comic-neue',
  characters: {},
};

export function sheetOf(book: Pick<Book, 'lettering'>): LetterSheet {
  return book.lettering ?? DEFAULT_SHEET;
}

/** One pen stroke as data (BUILD-HANDOFF §3). Page units; `pressure` is parallel to `pts`. */
export interface Stroke {
  pts: Pt[];
  pressure?: number[];
  /** Base width in page units. */
  w: number;
  brushId: string;
  /** Seed for the brush's deterministic jitter (engine `core/rng.ts`). */
  seed: number;
  /** An eraser stroke on this layer (additive). */
  erase?: boolean;
  /** Tool opacity multiplier, independent of the brush preset. */
  opacity?: number;
  /** Optional brush colour. Older strokes use the ink or pencil default. */
  color?: string;
  /** Clipped to the panel its first point is in, as drawn (schema 1 data; no longer drawn). */
  clip?: boolean;
  /** Drawn with this pass's colour (pencil blue / ink black); default: the layer type's. */
  pass?: 'pencil' | 'ink';
  /** Vector lines: a width multiplier per point (adjusted after drawing; missing = 1). */
  pw?: number[];
  /** Vector lines: ends left square by an eraser cut (no taper) at [start, end]. */
  flat?: [boolean, boolean];
  /** Vector lines drawn with the procedural appearance of their brush preset. */
  styledVector?: boolean;
}

/**
 * One colour fill, replayable (draw/fillkit.ts). A plain bucket is a seed point, colour and gap
 * closing; the optional fields are the fill family's other kinds and settings.
 */
export interface Fill {
  at: Pt;
  color: string;
  /** Gap closing in page units. */
  gap: number;
  /** Line alpha (1–254) at or above which a pixel is a wall; default 24. */
  threshold?: number;
  /** Grow (+) or shrink (−) the area past its edge, page units. */
  grow?: number;
  /** Read walls from every visible line layer, not just the group's reference layers. */
  refer?: 'all';
  /** A seed on a line is refused instead of moved (drag fill). */
  exact?: boolean;
  /** Enclose and fill: every closed area inside this loop. */
  lasso?: Pt[];
  /** Leftover brush: unfilled specks under this path take the colour around them. */
  leftover?: { path: Pt[]; r: number };
}

// ---------------------------------------------------------------------------------------------
// Layers

export type LayerType = 'pencil' | 'ink' | 'colour' | 'tone' | 'reference';
export const LAYER_TYPES: readonly LayerType[] = ['pencil', 'ink', 'colour', 'tone', 'reference'];

export interface PlacedImage {
  /** Centre and size in inches on the page. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Dimensions of the stored source bitmap. */
  pixelWidth: number;
  pixelHeight: number;
  credit?: string;
}

export interface PixelTransform {
  polygon: Pt[];
  /** Canvas affine matrix in page inches. */
  matrix: [number, number, number, number, number, number];
  /** Replay this move after these many strokes and fills on the layer. */
  strokes: number;
  fills: number;
}

export interface SmudgeStroke {
  kind: 'smudge';
  points: (Pt & { pressure: number })[];
  size: number;
  strength: number;
  strokes: number;
  fills: number;
}

export type PixelEdit = PixelTransform | SmudgeStroke;

export const TONE_SHAPES = ['dot', 'square', 'diamond', 'line', 'cross'] as const;
export interface ScreenTone {
  shape: typeof TONE_SHAPES[number];
  frequency: number;
  density: number;
  angle: number;
  color: string;
  /** Freehand mask in page inches. Otherwise the layer group's mask applies. */
  region?: Pt[];
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  /** 0–1 */
  opacity: number;
  /** In print and exports. */
  prints: boolean;
  /** Colour fills read this layer's lines as walls. */
  fillRef: boolean;
  /** In a panel group: drawn above the borders and gutters, unmasked (the pop-out). */
  overFrame: boolean;
  /**
   * A vector layer (CSP style): its strokes stay editable, drawn as outlines, and its bitmap is
   * only a cache redrawn from them after every edit. No raster strokes or fills on it.
   */
  vector?: boolean;
  screenTone?: ScreenTone;
  image?: PlacedImage;
  strokes: Stroke[];
  fills: Fill[];
  pixelTransforms?: PixelEdit[];
}

/** `gutter`: art in the gutters and margins, clipped to outside the panels (borderless pages). */
export type GroupKind = 'background' | 'panel' | 'gutter' | 'over';

export interface LayerGroup {
  id: string;
  kind: GroupKind;
  /** A name the user gave it; panel groups otherwise show their number and beat. */
  name?: string;
  /** Panel groups: a point inside their panel. A group belongs to the panel that holds it. */
  anchor?: Pt;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** Panel groups: layers are clipped to the panel shape. */
  mask: boolean;
  collapsed?: boolean;
  /** Top of the stack first. */
  layers: Layer[];
}

/** What each type starts with. Every one of these is a switch the user can flip per layer. */
export const TYPE_DEFAULTS: Record<LayerType, { name: string; prints: boolean; fillRef: boolean }> = {
  pencil: { name: 'Pencil', prints: false, fillRef: false },
  ink: { name: 'Ink', prints: true, fillRef: true },
  colour: { name: 'Colour', prints: true, fillRef: false },
  tone: { name: 'Tone', prints: true, fillRef: false },
  reference: { name: 'Reference', prints: false, fillRef: true },
};

/** Where a new layer of a type goes in a group's stack (higher = nearer the top). */
export const TYPE_RANK: Record<LayerType, number> = { pencil: 5, reference: 4, ink: 3, tone: 2, colour: 1 };

export function newLayer(type: LayerType, id = newId('ly')): Layer {
  const d = TYPE_DEFAULTS[type];
  return { id, name: d.name, type, visible: true, locked: false, opacity: 1, prints: d.prints, fillRef: d.fillRef, overFrame: false, strokes: [], fills: [] };
}

export function newGroup(kind: GroupKind, anchor?: Pt): LayerGroup {
  const g: LayerGroup = { id: newId('gr'), kind, visible: true, locked: false, opacity: 1, mask: kind === 'panel' || kind === 'gutter', layers: [] };
  if (anchor) g.anchor = anchor;
  return g;
}

/** Background under the panels and the Over-panels group above them. Panel groups come from the layout. */
export function baseGroups(): LayerGroup[] {
  return [newGroup('over'), newGroup('background')];
}

/** Panel layout style of a page (additive; absent = the default style). Inches. */
export interface PageLayout {
  gutter: number;
  border: number;
  curve: number;
  /** White by default. Null means transparent. */
  gutterPaper?: string | null;
  cornerRadius?: number;
  panelCorners?: { at: Pt; radius: number }[];
}

export interface ModularGrid {
  columns: number[];
  rows: number[];
  gutter: number;
}

export interface Page {
  id: string;
  /** Trim size in inches. */
  widthIn: number;
  heightIn: number;
  cuts: Cut[];
  layout?: PageLayout;
  grid?: ModularGrid;
  /** Relative position within the trim so the mark survives resizing. */
  downbeat?: Pt;
  beats: Beat[];
  autoLetter?: boolean;
  /** Top of the stack first: Over panels, then panel groups, then Background. */
  groups: LayerGroup[];
  balloons: Letter[];
  state: Record<Stage, StageState>;
  updatedAt: number;
}

export type Binding = 'saddle' | 'perfect' | 'hardcover' | 'none' | 'web';
export type BlankPlace = 'end' | 'beforeBack' | 'afterCover';

/** How the book is printed (geom/printkinds.ts). The trim is the pages' own size. */
export interface PrintSpec {
  /** A print kind id, or 'custom'. */
  kind: string;
  /** Inches. */
  bleed: number;
  safe: number;
  binding: Binding;
  /** Reads right to left (manga). */
  rtl: boolean;
  /** Where blank pages go when the page count needs them. */
  blanks: BlankPlace;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  folderId?: string;
  /**
   * Pixels per inch of the layer bitmaps. A page's bitmaps are `round(widthIn * dpi)` ×
   * `round(heightIn * dpi)`.
   */
  dpi: number;
  /** Lettering house style (absent = DEFAULT_SHEET). */
  lettering?: LetterSheet;
  /** Print kind, bleed, safe area, binding (absent = US comic book defaults). */
  print?: PrintSpec;
  fixedGrid?: ModularGrid;
  /** Exact settings of every brush strokes in this book use, by `<brush id>~<hash>` (draw/brushes.ts). */
  brushes?: Record<string, BrushSettings>;
  pages: Page[];
  lastPageId?: string;
  lastStage: Stage;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_TRIM = { widthIn: 6.625, heightIn: 10.187 };
export const DEFAULT_DPI = 300;

/** The size in pixels of a page's layer bitmaps. */
export function pagePixels(page: Pick<Page, 'widthIn' | 'heightIn'>, dpi: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(page.widthIn * dpi)), height: Math.max(1, Math.round(page.heightIn * dpi)) };
}

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function blankState(): Record<Stage, StageState> {
  return { script: 0, layout: 0, draw: 0, caption: 0, print: 0 };
}

export function newPage(now = Date.now()): Page {
  return { id: newId('pg'), ...DEFAULT_TRIM, cuts: [], beats: [], groups: baseGroups(), balloons: [], state: blankState(), updatedAt: now };
}

export function newBook(title: string, author = '', now = Date.now()): Book {
  const page = newPage(now);
  return { id: newId('bk'), title, author, dpi: DEFAULT_DPI, pages: [page], lastPageId: page.id, lastStage: 'script', createdAt: now, updatedAt: now };
}

// ---------------------------------------------------------------------------------------------
// Lookups

export function allLayers(page: Page): Layer[] {
  return page.groups.flatMap((g) => g.layers);
}

export function findLayer(page: Page, id: string): { group: LayerGroup; layer: Layer } | null {
  for (const group of page.groups) {
    const layer = group.layers.find((l) => l.id === id);
    if (layer) return { group, layer };
  }
  return null;
}

export function groupOf(page: Page, kind: 'background' | 'over' | 'gutter'): LayerGroup {
  let g = page.groups.find((x) => x.kind === kind);
  if (!g) {
    g = newGroup(kind);
    if (kind === 'over') page.groups.unshift(g);
    else if (kind === 'gutter') page.groups.splice(page.groups[0]?.kind === 'over' ? 1 : 0, 0, g);
    else page.groups.push(g);
  }
  return g;
}

/** Every stroke of a type on the page (counts, preflight). */
export function strokesOfType(page: Page, type: LayerType): Stroke[] {
  return allLayers(page).filter((l) => l.type === type).flatMap((l) => l.strokes);
}
