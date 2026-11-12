import { defaultCaption, readCaption, type CaptionSpec } from '../engine/lettering/spec';
import { readStyle, type CaptionStyle } from '../engine/lettering/styles';
import { BUNDLED_FONTS } from '../engine/lettering/fonts';
import { readBrush } from '../engine/core/brushlib';
import type { BrushSettings } from '../engine/core/brush';
import type { DialogueLine, ModularGrid, PlacedImage } from './model';
import { baseGroups, DEFAULT_SHEET, groupOf, LAYER_TYPES, newLayer, PT, STAGES, type Letter, type LetterSheet, type Beat, type Book, type Cut, type Fill, type GroupKind, type Layer, type LayerGroup, type Page, type PageLayout, type Pt, type Stage, type StageState, type Stroke } from './model';

/**
 * `book.json`: the stored form of a book. Used for the IndexedDB library and inside `.inkflo` zips.
 *
 * Rules (carried over from 2Dope's format rules):
 * - additive change = no schema bump; breaking change = bump + a migration here;
 * - a file from a newer schema is refused, never half-read;
 * - everything is validated on load, and a file is read back and validated before every write.
 */

export const FORMAT = 'inkflo-book';
export const SCHEMA = 6;

/** Asset keys of one page's layer bitmaps, by layer id (`null` = blank, nothing stored). */
export type PageArtKeys = Record<string, string | null>;

export interface BookFile {
  format: typeof FORMAT;
  schema: number;
  savedBy: string;
  book: Book;
  /**
   * Rendered layer bitmaps per page id, then per layer id (asset keys). The strokes and fills
   * they were drawn from are on the layers in `book.pages[].groups`. Pages with nothing rendered
   * may be absent.
   */
  art: Record<string, PageArtKeys>;
}

export class SchemaError extends Error {}

// ---------------------------------------------------------------------------------------------
// Validation helpers

type Obj = Record<string, unknown>;

function fail(path: string, what: string): never {
  throw new SchemaError(`book.json: ${path} ${what}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'should be an object');
  return v as Obj;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'should be a list');
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'should be text');
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'should be a number');
  return v;
}

function pos(v: unknown, path: string): number {
  const n = num(v, path);
  if (n <= 0) fail(path, 'should be above zero');
  return n;
}

function optStr(v: unknown, path: string): string | undefined {
  return v === undefined ? undefined : str(v, path);
}

function oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) fail(path, `should be one of ${options.join(', ')}`);
  return v as T;
}

function pt(v: unknown, path: string): Pt {
  const o = obj(v, path);
  return { x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`) };
}

function pts(v: unknown, path: string): Pt[] {
  return arr(v, path).map((p, i) => pt(p, `${path}[${i}]`));
}

function relativePoint(v: unknown, path: string): Pt {
  const p = pt(v, path);
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) fail(path, 'should be within the trim');
  return p;
}

function cut(v: unknown, path: string): Cut {
  const o = obj(v, path);
  const c: Cut = { id: str(o.id, `${path}.id`), mode: oneOf(o.mode, ['across', 'panel'] as const, `${path}.mode`), pts: pts(o.pts, `${path}.pts`) };
  if (c.pts.length < 2) fail(`${path}.pts`, 'needs at least two points');
  if (o.extended !== undefined && o.extended !== null) c.extended = pts(o.extended, `${path}.extended`);
  return c;
}

function beat(v: unknown, path: string): Beat {
  const o = obj(v, path);
  const b: Beat = { id: str(o.id, `${path}.id`), desc: str(o.desc, `${path}.desc`), lines: arr(o.lines, `${path}.lines`).map((l, i) => str(l, `${path}.lines[${i}]`)) };
  if (o.dialogue !== undefined) {
    b.dialogue = arr(o.dialogue, `${path}.dialogue`).map((v, i) => {
      const key = `${path}.dialogue[${i}]`;
      const raw = obj(v, key);
      const line: DialogueLine = { id: str(raw.id, `${key}.id`) };
      if (raw.panel !== undefined) line.panel = relativePoint(raw.panel, `${key}.panel`);
      if (raw.preset !== undefined) line.preset = str(raw.preset, `${key}.preset`);
      if (raw.omit === true) line.omit = true;
      return line;
    });
    if (b.dialogue.length !== b.lines.length) fail(`${path}.dialogue`, 'should have one entry per line');
    if (new Set(b.dialogue.map((line) => line.id)).size !== b.dialogue.length) fail(`${path}.dialogue`, 'has duplicate line IDs');
  }
  if (o.reveal !== undefined) {
    const r = obj(o.reveal, `${path}.reveal`);
    b.reveal = { pageId: str(r.pageId, `${path}.reveal.pageId`), beatId: str(r.beatId, `${path}.reveal.beatId`) };
  }
  if (o.card !== undefined) {
    const c = obj(o.card, `${path}.card`);
    const ratio = pos(c.ratio, `${path}.card.ratio`);
    if (ratio < 0.25 || ratio > 4) fail(`${path}.card.ratio`, 'should be between 0.25 and 4');
    const strokes = arr(c.strokes, `${path}.card.strokes`);
    if (strokes.length > 100) fail(`${path}.card.strokes`, 'has more than 100 strokes');
    b.card = { ratio, strokes: strokes.map((s, i) => {
      const points = pts(s, `${path}.card.strokes[${i}]`);
      if (points.length > 512 || points.some(({ x, y }) => x < 0 || x > 1 || y < 0 || y > 1)) fail(`${path}.card.strokes[${i}]`, 'needs at most 512 points within the card');
      return points;
    }) };
  }
  return b;
}

function modularGrid(v: unknown, path: string): ModularGrid {
  const o = obj(v, path);
  const weights = (value: unknown, key: string) => {
    const a = arr(value, key);
    if (!a.length || a.length > 12) fail(key, 'needs 1–12 weights');
    return a.map((w, i) => {
      const n = pos(w, `${key}[${i}]`);
      if (n < 0.01 || n > 100) fail(key, 'weights should be between 0.01 and 100');
      return n;
    });
  };
  const gutter = num(o.gutter, `${path}.gutter`);
  if (gutter < 0 || gutter > 0.6) fail(`${path}.gutter`, 'should be from 0 to 0.6 inch');
  return { columns: weights(o.columns, `${path}.columns`), rows: weights(o.rows, `${path}.rows`), gutter };
}

function stroke(v: unknown, path: string): Stroke {
  const o = obj(v, path);
  const s: Stroke = { pts: pts(o.pts, `${path}.pts`), w: pos(o.w, `${path}.w`), brushId: str(o.brushId, `${path}.brushId`), seed: num(o.seed, `${path}.seed`) };
  if (!s.pts.length) fail(`${path}.pts`, 'needs at least one point');
  if (o.erase === true) s.erase = true;
  if (o.opacity !== undefined) {
    const opacity = num(o.opacity, `${path}.opacity`);
    if (opacity <= 0 || opacity > 1) fail(`${path}.opacity`, 'should be greater than 0 and no more than 1');
    s.opacity = opacity;
  }
  if (o.clip === true) s.clip = true;
  if (o.pass === 'pencil' || o.pass === 'ink') s.pass = o.pass;
  if (!Number.isInteger(s.seed)) fail(`${path}.seed`, 'should be a whole number');
  if (o.pressure !== undefined && o.pressure !== null) {
    const p = arr(o.pressure, `${path}.pressure`).map((x, i) => {
      const n = num(x, `${path}.pressure[${i}]`);
      if (n < 0 || n > 1) fail(`${path}.pressure[${i}]`, 'should be from 0 to 1');
      return n;
    });
    if (p.length !== s.pts.length) fail(`${path}.pressure`, `should have one value per point (${s.pts.length})`);
    s.pressure = p;
  }
  if (o.pw !== undefined) {
    const pw = arr(o.pw, `${path}.pw`).map((x, i) => {
      const n = num(x, `${path}.pw[${i}]`);
      if (n < 0 || n > 10) fail(`${path}.pw[${i}]`, 'should be from 0 to 10');
      return n;
    });
    if (pw.length !== s.pts.length) fail(`${path}.pw`, `should have one value per point (${s.pts.length})`);
    s.pw = pw;
  }
  if (o.flat !== undefined) {
    const f = arr(o.flat, `${path}.flat`);
    if (f.length !== 2 || typeof f[0] !== 'boolean' || typeof f[1] !== 'boolean') fail(`${path}.flat`, 'should be two true/false values');
    s.flat = [f[0] as boolean, f[1] as boolean];
  }
  return s;
}

function bool(v: unknown, path: string, def: boolean): boolean {
  if (v === undefined) return def;
  if (typeof v !== 'boolean') fail(path, 'should be true or false');
  return v;
}

function unit(v: unknown, path: string, def: number): number {
  if (v === undefined) return def;
  const n = num(v, path);
  if (n < 0 || n > 1) fail(path, 'should be from 0 to 1');
  return n;
}

function layer(v: unknown, path: string): Layer {
  const o = obj(v, path);
  const type = oneOf(o.type, LAYER_TYPES, `${path}.type`);
  const d = newLayer(type, str(o.id, `${path}.id`));
  return {
    id: d.id,
    name: o.name === undefined ? d.name : str(o.name, `${path}.name`),
    type,
    visible: bool(o.visible, `${path}.visible`, true),
    locked: bool(o.locked, `${path}.locked`, false),
    opacity: unit(o.opacity, `${path}.opacity`, 1),
    prints: bool(o.prints, `${path}.prints`, d.prints),
    fillRef: bool(o.fillRef, `${path}.fillRef`, d.fillRef),
    overFrame: bool(o.overFrame, `${path}.overFrame`, false),
    ...(o.vector === true ? { vector: true } : {}),
    ...(o.image !== undefined ? { image: placedImage(o.image, `${path}.image`) } : {}),
    strokes: arr(o.strokes ?? [], `${path}.strokes`).map((x, i) => stroke(x, `${path}.strokes[${i}]`)),
    fills: arr(o.fills ?? [], `${path}.fills`).map((x, i) => fill(x, `${path}.fills[${i}]`)),
  };
}

function placedImage(v: unknown, path: string): PlacedImage {
  const o = obj(v, path);
  const pixelWidth = pos(o.pixelWidth, `${path}.pixelWidth`);
  const pixelHeight = pos(o.pixelHeight, `${path}.pixelHeight`);
  if (!Number.isInteger(pixelWidth) || !Number.isInteger(pixelHeight) || Math.max(pixelWidth, pixelHeight) > 8192 || pixelWidth * pixelHeight > 16_000_000) {
    fail(path, 'has unsupported source bitmap dimensions');
  }
  return {
    x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`),
    width: pos(o.width, `${path}.width`), height: pos(o.height, `${path}.height`),
    rotation: num(o.rotation, `${path}.rotation`),
    pixelWidth, pixelHeight,
    ...(o.credit === undefined ? {} : { credit: str(o.credit, `${path}.credit`) }),
  };
}

function group(v: unknown, path: string): LayerGroup {
  const o = obj(v, path);
  const kind = oneOf<GroupKind>(o.kind, ['background', 'panel', 'gutter', 'over'] as const, `${path}.kind`);
  const g: LayerGroup = {
    id: str(o.id, `${path}.id`),
    kind,
    visible: bool(o.visible, `${path}.visible`, true),
    locked: bool(o.locked, `${path}.locked`, false),
    opacity: unit(o.opacity, `${path}.opacity`, 1),
    mask: bool(o.mask, `${path}.mask`, kind === 'panel' || kind === 'gutter'),
    layers: arr(o.layers ?? [], `${path}.layers`).map((x, i) => layer(x, `${path}.layers[${i}]`)),
  };
  if (o.name !== undefined) g.name = str(o.name, `${path}.name`);
  if (o.collapsed === true) g.collapsed = true;
  if (o.anchor !== undefined && o.anchor !== null) g.anchor = pt(o.anchor, `${path}.anchor`);
  if (kind === 'panel' && !g.anchor) fail(`${path}.anchor`, 'is needed on a panel group');
  return g;
}

/** Ids of a page's layer and group objects must be unique within the page. */
function checkIds(groups: LayerGroup[], path: string): void {
  const seen = new Set<string>();
  for (const g of groups) {
    for (const id of [g.id, ...g.layers.map((l) => l.id)]) {
      if (seen.has(id)) fail(path, `has two layers or groups with id ${id}`);
      seen.add(id);
    }
  }
}

/**
 * Schema 1 kept a page's art as three page-wide passes (`art: {pencil, ink, fills}` plus pass
 * bitmaps). They become layers in the Background group, so nothing is lost: it still renders
 * under the panels' gutters exactly as before.
 */
export const V1_LAYER = { pencil: (page: string) => `${page}-pencil`, ink: (page: string) => `${page}-ink`, colour: (page: string) => `${page}-colour` };

function migrateV1Art(o: Obj, path: string, pageId: string, keys: Obj | undefined): LayerGroup[] {
  const groups = baseGroups();
  const bg = groups.find((g) => g.kind === 'background')!;
  const a = o.art === undefined || o.art === null ? {} : obj(o.art, `${path}.art`);
  const pencil = arr(a.pencil ?? [], `${path}.art.pencil`).map((x, i) => stroke(x, `${path}.art.pencil[${i}]`));
  const ink = arr(a.ink ?? [], `${path}.art.ink`).map((x, i) => stroke(x, `${path}.art.ink[${i}]`));
  const fills = arr(a.fills ?? [], `${path}.art.fills`).map((x, i) => fill(x, `${path}.art.fills[${i}]`));
  // top of the stack first, like the UI lists them
  if (pencil.length || keys?.pencil) bg.layers.push({ ...newLayer('pencil', V1_LAYER.pencil(pageId)), strokes: pencil });
  if (ink.length || keys?.ink) bg.layers.push({ ...newLayer('ink', V1_LAYER.ink(pageId)), strokes: ink });
  if (fills.length || keys?.colour) bg.layers.push({ ...newLayer('colour', V1_LAYER.colour(pageId)), fills });
  return groups;
}

function fill(v: unknown, path: string): Fill {
  const o = obj(v, path);
  const gap = num(o.gap, `${path}.gap`);
  if (gap < 0) fail(`${path}.gap`, 'should not be negative');
  const f: Fill = { at: pt(o.at, `${path}.at`), color: str(o.color, `${path}.color`), gap };
  if (o.threshold !== undefined) {
    const t = num(o.threshold, `${path}.threshold`);
    if (!Number.isInteger(t) || t < 1 || t > 254) fail(`${path}.threshold`, 'should be a whole number from 1 to 254');
    f.threshold = t;
  }
  if (o.grow !== undefined) {
    const g = num(o.grow, `${path}.grow`);
    if (Math.abs(g) > 0.5) fail(`${path}.grow`, 'should be within half an inch');
    f.grow = g;
  }
  if (o.refer !== undefined) f.refer = oneOf(o.refer, ['all'] as const, `${path}.refer`);
  if (o.exact === true) f.exact = true;
  if (o.lasso !== undefined) {
    const l = pts(o.lasso, `${path}.lasso`);
    if (l.length < 3) fail(`${path}.lasso`, 'needs at least 3 points');
    f.lasso = l;
  }
  if (o.leftover !== undefined) {
    const lo = obj(o.leftover, `${path}.leftover`);
    const path2 = pts(lo.path, `${path}.leftover.path`);
    if (!path2.length) fail(`${path}.leftover.path`, 'is empty');
    f.leftover = { path: path2, r: pos(lo.r, `${path}.leftover.r`) };
  }
  return f;
}

function layout(v: unknown, path: string): PageLayout | undefined {
  if (v === undefined || v === null) return undefined;
  const o = obj(v, path);
  const gutter = num(o.gutter, `${path}.gutter`);
  const border = num(o.border, `${path}.border`);
  const curve = num(o.curve, `${path}.curve`);
  if (gutter < 0 || gutter > 2) fail(`${path}.gutter`, 'should be from 0 to 2 inches');
  if (border < 0 || border > 0.5) fail(`${path}.border`, 'should be from 0 to 0.5 inches');
  if (!Number.isInteger(curve) || curve < 0 || curve > 5) fail(`${path}.curve`, 'should be a whole number from 0 to 5');
  return { gutter, border, curve };
}

function source(o: Obj, path: string): Letter['src'] | undefined {
  if (o.src === undefined || o.src === null) return undefined;
  const src = obj(o.src, `${path}.src`);
  const line = num(src.line, `${path}.src.line`);
  if (!Number.isInteger(line) || line < 0) fail(`${path}.src.line`, 'should be a whole number from 0');
  return { beat: str(src.beat, `${path}.src.beat`), line, ...(src.lineId === undefined ? {} : { lineId: str(src.lineId, `${path}.src.lineId`) }) };
}

/**
 * Schemas 1–2 kept a simple ellipse balloon in inches (`x, y, rx, ry, text, tail, style`).
 * It becomes a live caption in points with the same place, size, words and tail.
 */
function migrateBalloon(o: Obj, path: string): Letter {
  const style = oneOf(o.style, ['speech', 'caption', 'sfx'] as const, `${path}.style`);
  const x = num(o.x, `${path}.x`) * PT;
  const y = num(o.y, `${path}.y`) * PT;
  const cap = defaultCaption(x, y, style === 'caption' ? 'box' : style);
  cap.text = str(o.text, `${path}.text`);
  cap.minSize = [pos(o.rx, `${path}.rx`) * PT * 0.85, pos(o.ry, `${path}.ry`) * PT * 0.85];
  if (style === 'speech' && o.tail !== undefined && o.tail !== null) {
    const t = pt(o.tail, `${path}.tail`);
    cap.tails = [{ x: t.x * PT, y: t.y * PT, join: 'merged', width: 1.2 }];
  } else cap.tails = [];
  const l: Letter = { id: str(o.id, `${path}.id`), cap };
  const src = source(o, path);
  if (src) l.src = src;
  return l;
}

function letterOf(v: unknown, path: string): Letter {
  const o = obj(v, path);
  if (o.cap === undefined) return migrateBalloon(o, path);
  let cap: CaptionSpec;
  try {
    cap = readCaption(o.cap);
  } catch (e) {
    fail(`${path}.cap`, `is not a readable caption (${e instanceof Error ? e.message : String(e)})`);
  }
  const l: Letter = { id: str(o.id, `${path}.id`), cap };
  const src = source(o, path);
  if (src) l.src = src;
  if (o.speaker !== undefined) l.speaker = str(o.speaker, `${path}.speaker`);
  if (o.smallOk === true) l.smallOk = true;
  if (o.generated === true) l.generated = true;
  return l;
}

function sheet(v: unknown, path: string): LetterSheet | undefined {
  if (v === undefined || v === null) return undefined;
  const o = obj(v, path);
  const pt = (x: unknown, p: string, d: number) => {
    if (x === undefined) return d;
    const n = num(x, p);
    if (n < 3 || n > 96) fail(p, 'should be from 3 to 96 pt');
    return n;
  };
  const sz = obj(o.sizes ?? {}, `${path}.sizes`);
  const characters: Record<string, CaptionStyle> = {};
  for (const [who, st] of Object.entries(obj(o.characters ?? {}, `${path}.characters`))) {
    try {
      characters[who] = readStyle(st);
    } catch (e) {
      fail(`${path}.characters.${who}`, `is not a readable style (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  const presets = o.presets === undefined ? undefined : Object.fromEntries(
    Object.entries(obj(o.presets, `${path}.presets`)).map(([id, st]) => {
      try {
        return [id, readStyle(st)] as const;
      } catch (e) {
        return fail(`${path}.presets.${id}`, `is not a readable style (${e instanceof Error ? e.message : String(e)})`);
      }
    }),
  );
  const font = o.font === undefined ? DEFAULT_SHEET.font : str(o.font, `${path}.font`);
  return {
    sizes: { small: pt(sz.small, `${path}.sizes.small`, DEFAULT_SHEET.sizes.small), body: pt(sz.body, `${path}.sizes.body`, DEFAULT_SHEET.sizes.body), big: pt(sz.big, `${path}.sizes.big`, DEFAULT_SHEET.sizes.big) },
    warnPt: pt(o.warnPt, `${path}.warnPt`, DEFAULT_SHEET.warnPt),
    minPt: pt(o.minPt, `${path}.minPt`, DEFAULT_SHEET.minPt),
    font: BUNDLED_FONTS.some((f) => f.id === font) ? font : DEFAULT_SHEET.font,
    characters,
    ...(presets ? { presets } : {}),
    ...(o.checks !== undefined ? { checks: arr(o.checks, `${path}.checks`).map((c, i) => str(c, `${path}.checks[${i}]`)).slice(0, 8) } : {}),
  };
}

function stageState(v: unknown, path: string): Record<Stage, StageState> {
  const o = obj(v, path);
  const out = {} as Record<Stage, StageState>;
  for (const s of STAGES) {
    const n = o[s] ?? 0;
    if (n !== 0 && n !== 1 && n !== 2) fail(`${path}.${s}`, 'should be 0, 1 or 2');
    out[s] = n;
  }
  return out;
}

function page(v: unknown, path: string, v1Keys?: Obj): Page {
  const o = obj(v, path);
  const lay = layout(o.layout, `${path}.layout`);
  const id = str(o.id, `${path}.id`);
  const groups = v1Keys !== undefined || o.groups === undefined ? migrateV1Art(o, path, id, v1Keys) : arr(o.groups, `${path}.groups`).map((g, i) => group(g, `${path}.groups[${i}]`));
  checkIds(groups, `${path}.groups`);
  const pg: Page = {
    id,
    widthIn: pos(o.widthIn, `${path}.widthIn`),
    heightIn: pos(o.heightIn, `${path}.heightIn`),
    cuts: arr(o.cuts, `${path}.cuts`).map((c, i) => cut(c, `${path}.cuts[${i}]`)),
    beats: arr(o.beats, `${path}.beats`).map((b, i) => beat(b, `${path}.beats[${i}]`)),
    groups,
    balloons: arr(o.balloons, `${path}.balloons`).map((b, i) => letterOf(b, `${path}.balloons[${i}]`)),
    state: stageState(o.state, `${path}.state`),
    updatedAt: num(o.updatedAt, `${path}.updatedAt`),
  };
  if (lay) pg.layout = lay;
  if (o.grid !== undefined) pg.grid = modularGrid(o.grid, `${path}.grid`);
  if (o.downbeat !== undefined) pg.downbeat = relativePoint(o.downbeat, `${path}.downbeat`);
  if (o.autoLetter === true) pg.autoLetter = true;
  groupOf(pg, 'over');
  groupOf(pg, 'background');
  return pg;
}

function book(v: unknown, v1Art?: Obj): Book {
  const o = obj(v, 'book');
  const pages = arr(o.pages, 'book.pages').map((p, i) => {
    const id = obj(p, `book.pages[${i}]`).id;
    const keys = v1Art ? (typeof id === 'string' && v1Art[id] ? obj(v1Art[id], `art.${id}`) : {}) : undefined;
    return page(p, `book.pages[${i}]`, keys);
  });
  const ids = new Set<string>();
  for (const p of pages) {
    if (ids.has(p.id)) fail('book.pages', `has two pages with id ${p.id}`);
    ids.add(p.id);
  }
  const b: Book = {
    id: str(o.id, 'book.id'),
    title: str(o.title, 'book.title'),
    author: str(o.author, 'book.author'),
    dpi: pos(o.dpi, 'book.dpi'),
    pages,
    lastStage: oneOf(o.lastStage, STAGES, 'book.lastStage'),
    createdAt: num(o.createdAt, 'book.createdAt'),
    updatedAt: num(o.updatedAt, 'book.updatedAt'),
  };
  if (o.print !== undefined) {
    const p = obj(o.print, 'book.print');
    const bleed = num(p.bleed, 'book.print.bleed');
    const safe = num(p.safe, 'book.print.safe');
    if (bleed < 0 || bleed > 1) fail('book.print.bleed', 'should be from 0 to 1 inch');
    if (safe < 0 || safe > 2) fail('book.print.safe', 'should be from 0 to 2 inches');
    b.print = {
      kind: str(p.kind, 'book.print.kind'),
      bleed,
      safe,
      binding: oneOf(p.binding, ['saddle', 'perfect', 'hardcover', 'none', 'web'] as const, 'book.print.binding'),
      rtl: bool(p.rtl, 'book.print.rtl', false),
      blanks: p.blanks === undefined ? 'end' : oneOf(p.blanks, ['end', 'beforeBack', 'afterCover'] as const, 'book.print.blanks'),
    };
  }
  const lettering = sheet(o.lettering, 'book.lettering');
  if (o.fixedGrid !== undefined) b.fixedGrid = modularGrid(o.fixedGrid, 'book.fixedGrid');
  if (lettering) b.lettering = lettering;
  if (o.brushes !== undefined) {
    const brushes: Record<string, BrushSettings> = {};
    const entries = Object.entries(obj(o.brushes, 'book.brushes'));
    if (entries.length > 500) fail('book.brushes', 'has more than 500 brushes');
    for (const [id, v] of entries) {
      const br = readBrush(v);
      if (!br) fail(`book.brushes.${id}`, 'is not a readable brush');
      brushes[id] = br;
    }
    b.brushes = brushes;
  }
  const folderId = optStr(o.folderId, 'book.folderId');
  if (folderId !== undefined) b.folderId = folderId;
  const last = optStr(o.lastPageId, 'book.lastPageId');
  if (last !== undefined && ids.has(last)) b.lastPageId = last; // a stale pointer is dropped, not fatal
  return b;
}

function artKeys(v: unknown, path: string, layerIds: Set<string>): PageArtKeys {
  const o = obj(v, path);
  const out: PageArtKeys = {};
  for (const [id, k] of Object.entries(o)) {
    if (!layerIds.has(id)) continue; // a deleted layer's bitmap: drop it
    out[id] = k === null ? null : str(k, `${path}.${id}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** Validate parsed JSON as a book file. Throws `SchemaError` with a readable path on failure. */
export function validateBookFile(v: unknown): BookFile {
  const o = obj(v, 'file');
  if (o.format !== FORMAT) throw new SchemaError('This is not an inkflo book.');
  const schema = num(o.schema, 'schema');
  if (!Number.isInteger(schema) || schema < 1) fail('schema', 'should be a whole number from 1');
  if (schema > SCHEMA) throw new SchemaError(`This book was saved by a newer inkflo (schema ${schema}; this version reads up to ${SCHEMA}). Update inkflo to open it.`);
  const rawArt = obj(o.art ?? {}, 'art');
  const b = book(o.book, schema === 1 ? rawArt : undefined);
  const pages = new Map(b.pages.map((p) => [p.id, p]));
  const art: Record<string, PageArtKeys> = {};
  for (const [id, keys] of Object.entries(rawArt)) {
    const pg = pages.get(id);
    if (!pg) continue; // art for a deleted page: drop it
    let k = obj(keys, `art.${id}`);
    if (schema === 1) k = { [V1_LAYER.pencil(id)]: k.pencil ?? null, [V1_LAYER.ink(id)]: k.ink ?? null, [V1_LAYER.colour(id)]: k.colour ?? null };
    art[id] = artKeys(k, `art.${id}`, new Set(pg.groups.flatMap((g) => g.layers.map((l) => l.id))));
  }
  return { format: FORMAT, schema: SCHEMA, savedBy: typeof o.savedBy === 'string' ? o.savedBy : 'unknown', book: b, art };
}

export function parseBookFile(json: string): BookFile {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new SchemaError('book.json is not valid JSON.');
  }
  return validateBookFile(v);
}

/** Serialise a book file, reading it back through validation first so a bad file is never written. */
export function stringifyBookFile(file: BookFile): string {
  const json = JSON.stringify(file);
  parseBookFile(json);
  return json;
}

/** Every asset key a book file uses. */
export function assetsOf(file: BookFile): Set<string> {
  const s = new Set<string>();
  for (const keys of Object.values(file.art)) for (const k of Object.values(keys)) if (k) s.add(k);
  return s;
}
