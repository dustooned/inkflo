import type { Studio } from '../app/studio';
import { PT, sheetOf, type Book, type Layer, type LayerGroup, type LayerType, type Page } from '../doc/model';
import { centreIn } from '../geom/lettering';
import type { PageArt } from '../draw/residency';
import { writeZip, type ZipFile } from '../engine/io/zip';
import { derivePanels, layoutOf, panelAt } from '../geom/carve';
import { groupPanels } from '../geom/groups';
import { captionWithLocalTails, paintBalloonGroup, sizePt, toPx } from '../render/caption';
import { captionGroups, groupWords } from '../geom/captiongroup';
import { lettersReady } from '../render/fonts';
import { drawScreenTone } from '../render/tone';
import { COLORS, drawGutters, drawLayerBitmap, gutterBandPath, inGutterBands, panelPath, renderPage, roundCorners } from '../render/page';
import { assetKey } from './capture';
import { encodePng, makeCanvas } from './canvasops';
import { DEFAULT_MOTION, motionProject, twoDopeCaption, type LayerArt, type MotionOptions, type MotionPage } from './to2dope';

export type Progress = (message: string) => void;

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/** Pages' art in memory for the duration of an export. */
export async function withPages<T>(studio: Studio, fn: (get: (p: Page) => PageArt) => Promise<T>): Promise<T> {
  const book = studio.book!;
  const arts = book.pages.map((p) => studio.ensureArt(p));
  try {
    for (const a of arts) await studio.residency.pin(a);
    return await fn((p) => studio.ensureArt(p));
  } finally {
    for (const a of arts) studio.residency.unpin(a);
  }
}

function clear(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, c.width, c.height);
  return g;
}

/** Layer types that go on a 2Dope drawing's Fill plane (under the line); the rest go on Line. */
const FILL_TYPES = new Set<LayerType>(['colour', 'tone']);

/** Draw a group's printing, visible layers that pass `pick`, bottom to top, page-sized. */
function paintLayers(g: CanvasRenderingContext2D, group: LayerGroup, art: PageArt, W: number, H: number, scale: number, pick: (l: Layer) => boolean): void {
  if (!group.visible) return;
  for (let i = group.layers.length - 1; i >= 0; i--) {
    const l = group.layers[i]!;
    if (!l.visible || !l.prints || !pick(l)) continue;
    g.globalAlpha = l.opacity * group.opacity;
    if (l.screenTone) drawScreenTone(g, l.screenTone, W, H, scale);
    const c = art.planes[l.id];
    if (!c || !c.width) continue;
    drawLayerBitmap(g, c, W, H, scale, l.image);
  }
  g.globalAlpha = 1;
}

function isBlankCanvas(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}

/** Erase the gutter bands (inside the current clip). */
function cutBands(g: CanvasRenderingContext2D, page: Page, s: number): void {
  const { gutter } = layoutOf(page);
  if (!gutter) return;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = gutter * s;
  g.strokeStyle = '#000';
  g.stroke(gutterBandPath(page, s));
  g.restore();
}

/** A balloon's layer name: the speaker and the start of the line. */
function balloonName(page: Page, i: number): string {
  const b = page.balloons[i]!;
  const beat = b.src ? page.beats.find((x) => x.id === b.src!.beat) : null;
  const raw = beat?.lines[b.src!.line] ?? '';
  const who = /^\s*([^:]{1,30}):/.exec(raw)?.[1]?.trim();
  const t = b.cap.text;
  const text = t.length > 24 ? `${t.slice(0, 24)}…` : t;
  return who ? `${who}: ${text}` : b.cap.style === 'sfx' ? `SFX: ${text}` : text || `Balloon ${i + 1}`;
}

/**
 * The motion comic as a `.2dope` project zip: page comps with a layer per panel and balloon, and
 * a camera that reads the book panel by panel. Opens in 2Dope (File → Open) as a scene.
 */
export async function exportMotionComic(studio: Studio, opt: MotionOptions = DEFAULT_MOTION, progress: Progress = () => {}): Promise<Blob> {
  const book = studio.book!;
  const first = book.pages[0]!;
  const W = Math.round(first.widthIn * opt.dpi) & ~1;
  const H = Math.round(first.heightIn * opt.dpi) & ~1;
  const line = makeCanvas(W, H);
  const fill = makeCanvas(W, H);
  const assets = new Map<string, Uint8Array>();
  const store = async (c: HTMLCanvasElement): Promise<string | null> => {
    if (isBlankCanvas(c)) return null;
    const bytes = await encodePng(c);
    const key = assetKey(bytes);
    assets.set(key, bytes);
    return key;
  };

  const sheet = sheetOf(book);
  await lettersReady(book.pages.flatMap((p) => p.balloons.map((l) => l.cap)));
  const pages: MotionPage[] = await withPages(studio, async (artOf) => {
    const out: MotionPage[] = [];
    for (const [pi, page] of book.pages.entries()) {
      progress(`Page ${pi + 1} of ${book.pages.length}…`);
      await yieldToUi();
      const art = artOf(page);
      const s = W / page.widthIn;
      const panels = derivePanels(page);
      // paper
      const pg = clear(fill);
      const gutterPaper = layoutOf(page).gutterPaper;
      if (gutterPaper !== null) {
        pg.fillStyle = gutterPaper ?? COLORS.gutter;
        pg.fillRect(0, 0, W, H);
      }
      // gutter art (borderless pages) belongs to the paper: outside the panels, under them all
      for (const grp of page.groups.filter((x) => x.kind === 'gutter')) {
        if (grp.mask) inGutterBands(pg, page, s, W, H, (o) => paintLayers(o, grp, art, W, H, s, () => true));
        else paintLayers(pg, grp, art, W, H, s, () => true);
      }
      const paper: LayerArt = { line: null, fill: await store(fill) };
      // panels: Background art plus the panel's own groups, clipped to the panel
      const owners = groupPanels(page, panels);
      const bg = page.groups.filter((g) => g.kind === 'background');
      const panelArt: MotionPage['panels'] = [];
      for (const p of panels) {
        const path = panelPath(p.pts, s);
        const mine = page.groups.filter((g) => g.kind === 'panel' && owners.get(g.id) === p);
        const f = clear(fill);
        f.save();
        f.clip(path);
        f.fillStyle = COLORS.panel;
        f.fill(path);
        for (const g of [...bg, ...mine]) paintLayers(f, g, art, W, H, s, (l) => FILL_TYPES.has(l.type) && !l.overFrame);
        cutBands(f, page, s);
        roundCorners(f, page, [p], s, null);
        f.restore();
        const l = clear(line);
        l.save();
        l.clip(path);
        for (const g of [...bg, ...mine]) paintLayers(l, g, art, W, H, s, (x) => !FILL_TYPES.has(x.type) && !x.overFrame);
        cutBands(l, page, s);
        drawGutters(l, page, s, { paper: false });
        l.restore();
        const beat = page.beats[p.index];
        panelArt.push({
          index: p.index,
          bbox: { x0: p.bbox.x0 * s, y0: p.bbox.y0 * s, x1: p.bbox.x1 * s, y1: p.bbox.y1 * s },
          art: { line: await store(line), fill: await store(fill) },
          ...(beat ? { beat: { desc: beat.desc, lines: beat.lines } } : {}),
        });
        await yieldToUi();
      }
      // art over the frame: each panel group's over-frame layers, then the Over-panels group
      const extras: NonNullable<MotionPage['extras']> = [];
      for (const g of page.groups.filter((x) => x.kind === 'panel')) {
        if (!g.layers.some((x) => x.overFrame && x.prints && x.visible)) continue;
        const o = clear(line);
        paintLayers(o, g, art, W, H, s, (x) => x.overFrame);
        const p = owners.get(g.id) ?? null;
        extras.push({ name: `${p ? `Panel ${p.index + 1}` : 'Panel'} · over frame`, panelIndex: p?.index ?? null, art: { line: await store(line), fill: null } });
        void o;
      }
      for (const g of page.groups.filter((x) => x.kind === 'over')) {
        if (!g.layers.some((x) => x.prints && x.visible)) continue;
        paintLayers(clear(line), g, art, W, H, s, () => true);
        extras.push({ name: 'Over panels', panelIndex: null, art: { line: await store(line), fill: null } });
      }
      // balloons
      const balloons: MotionPage['balloons'] = [];
      for (const group of captionGroups(page.balloons)) {
        const b = group[0]!;
        const base = { name: balloonName(page, page.balloons.indexOf(b)), panelIndex: panelAt(panels, centreIn(b))?.index ?? null, text: groupWords(group) };
        if (opt.captions === 'live' && group.length === 1) {
          // a live 2Dope caption, in the comp's pixels: editable and animatable in 2Dope
          const k = s / PT;
          const pixels = captionWithLocalTails(toPx(b.cap, k), b.rotation);
          const caption = twoDopeCaption(pixels as unknown as Record<string, unknown> & { size: string }, sizePt(b.cap, sheet) * k, H);
          balloons.push({ ...base, art: { line: null, fill: null }, caption, ...(b.rotation ? { rotation: { degrees: b.rotation, pivot: [pixels.x, pixels.y] } } : {}) });
        } else {
          paintBalloonGroup(clear(line), group, sheet, s, page.widthIn, page.heightIn);
          balloons.push({ ...base, art: { line: await store(line), fill: null } });
        }
      }
      out.push({ title: `Page ${pi + 1}`, paper, panels: panelArt, balloons, extras });
    }
    return out;
  });

  progress('Writing the 2Dope project…');
  const project = motionProject(book.title, pages, { width: W, height: H }, opt);
  const files: ZipFile[] = [{ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(project, null, 1)) }];
  for (const [name, data] of assets) files.push({ name, data });
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}

/** Every page rendered at the book's dpi as PNG bytes (pencil left out, as in print). */
async function pagePngs(studio: Studio, progress: Progress): Promise<Uint8Array[]> {
  const book = studio.book!;
  return withPages(studio, async (artOf) => {
    const out: Uint8Array[] = [];
    for (const [i, page] of book.pages.entries()) {
      progress(`Rendering page ${i + 1} of ${book.pages.length}…`);
      await yieldToUi();
      out.push(await renderPagePng(page, artOf(page), book.dpi, sheetOf(book)));
    }
    return out;
  });
}

export async function renderPagePng(page: Page, art: PageArt | null, dpi: number, sheet = sheetOf({})): Promise<Uint8Array> {
  const c = makeCanvas(Math.round(page.widthIn * dpi), Math.round(page.heightIn * dpi));
  await lettersReady(page.balloons.map((l) => l.cap));
  renderPage(c.getContext('2d')!, page, art, { scale: dpi, printOnly: true, sheet });
  return encodePng(c);
}

const pad = (n: number) => String(n).padStart(3, '0');

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function comicInfo(book: Book): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${xml(book.title)}</Title>
  <Writer>${xml(book.author)}</Writer>
  <PageCount>${book.pages.length}</PageCount>
  <Notes>Made with inkflo.</Notes>
  <Pages>
${book.pages.map((_, i) => `    <Page Image="${i}"${i === 0 ? ' Type="FrontCover"' : ''} />`).join('\n')}
  </Pages>
</ComicInfo>
`;
}

/** Comic archive: page PNGs plus ComicInfo.xml, read by comic readers. */
export async function exportCbz(studio: Studio, progress: Progress = () => {}): Promise<Blob> {
  const book = studio.book!;
  const pngs = await pagePngs(studio, progress);
  const files: ZipFile[] = pngs.map((data, i) => ({ name: `${pad(i + 1)}.png`, data }));
  files.push({ name: 'ComicInfo.xml', data: new TextEncoder().encode(comicInfo(book)) });
  return new Blob([writeZip(files) as BlobPart], { type: 'application/vnd.comicbook+zip' });
}

/** Plain page images in a zip. */
export async function exportPageImages(studio: Studio, progress: Progress = () => {}): Promise<Blob> {
  const pngs = await pagePngs(studio, progress);
  return new Blob([writeZip(pngs.map((data, i) => ({ name: `page-${pad(i + 1)}.png`, data }))) as BlobPart], { type: 'application/zip' });
}
