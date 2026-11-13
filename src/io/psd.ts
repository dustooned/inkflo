import type { Layer as PsdLayer, Psd } from 'ag-psd';
import type { Studio } from '../app/studio';
import { pagePixels, PT, sheetOf, TYPE_DEFAULTS, type Book, type Layer, type LayerGroup, type Page } from '../doc/model';
import type { PageArt } from '../draw/residency';
import { writeZip, type ZipFile } from '../engine/io/zip';
import { derivePanels, panelAt, panelStack } from '../geom/carve';
import { groupLabel, panelForGroup, syncGroups } from '../geom/groups';
import { captionGroups, groupWords } from '../geom/captiongroup';
import { lettersReady } from '../render/fonts';
import { drawMarks } from '../render/marks';
import { clearGutterPaper, drawBalloons, drawGutters, drawPagePaper, paintPlacedFrame, placedPanelPath, renderPage } from '../render/page';
import { makeCanvas } from './canvasops';
import type { Progress } from './exports';
import { pagesIn, type PageRange } from './printexport';

export type PsdMode = 'art' | 'template';

/** Keep transparent pixels outside each layer out of the file. */
function cropped(g: CanvasRenderingContext2D): Pick<PsdLayer, 'imageData' | 'top' | 'left'> {
  const { width, height } = g.canvas;
  const full = g.getImageData(0, 0, width, height);
  const pixels = new Uint32Array(full.data.buffer);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!(pixels[y * width + x]! >>> 24)) continue;
      x0 = Math.min(x, x0);
      x1 = Math.max(x, x1);
      y0 = Math.min(y, y0);
      y1 = y;
    }
  }
  if (x1 < 0) return {};
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w === width && h === height) return { imageData: full };
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const offset = ((y0 + row) * width + x0) * 4;
    data.set(full.data.subarray(offset, offset + w * 4), row * w * 4);
  }
  return { left: x0, top: y0, imageData: { width: w, height: h, data } };
}

/** Convert the page renderer's stack into a layered RGB document. */
export function pagePsd(book: Book, page: Page, art: PageArt | null, dpi: number, mode: PsdMode): Psd {
  const { width, height } = pagePixels(page, dpi);
  if (width < 1 || height < 1 || width > 30_000 || height > 30_000 || width * height > 32_000_000) {
    throw new Error('This page is too large for layered browser export. Choose a lower resolution.');
  }
  const panels = derivePanels(page);
  const source = { ...page, groups: mode === 'template' ? [] : page.groups.map((g) => ({ ...g })) };
  syncGroups(source, panels);
  const sheet = sheetOf(book);
  const canvas = makeCanvas(width, height);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const painted = (name: string, paint: () => void): PsdLayer => {
    g.clearRect(0, 0, width, height);
    paint();
    return { name, ...cropped(g) };
  };
  const layer = (grp: LayerGroup, l: Layer): PsdLayer => ({
    ...(l.screenTone || art?.planes[l.id]?.width ? painted(l.name, () => {
      const only = { ...grp, visible: true, opacity: 1, layers: [{ ...l, visible: true, opacity: 1 }] };
      renderPage(g, { ...source, groups: [only] }, art, { scale: dpi, panels, frame: false, balloons: false });
      if (grp.kind === 'background' || (grp.kind === 'panel' && !l.overFrame && !panelForGroup(panels, grp)?.transform)) clearGutterPaper(g, page, panels, dpi);
    }) : { name: l.name }),
    hidden: !l.visible,
    opacity: l.opacity * grp.opacity,
    protected: l.locked || grp.locked ? { composite: true } : undefined,
  });
  const group = (grp: LayerGroup, over = false): PsdLayer | null => {
    const name = groupLabel(source, panels, grp);
    if (mode === 'template') {
      if (grp.kind !== 'panel' || over) return null;
      const panel = panelForGroup(panels, grp);
      if (!panel) return null;
      // Opaque white inside the panel, black outside. Apps that support group masks
      // can use this clip immediately when students draw on the empty layers.
      const maskLayer = painted('', () => {
        g.fillStyle = '#fff';
        g.fill(placedPanelPath(page, panel, dpi));
      });
      const imageData = maskLayer.imageData;
      if (imageData) {
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = imageData.data[i + 3]!;
        }
      }
      return {
        name,
        children: (['colour', 'ink', 'pencil'] as const).map((type) => ({ name: TYPE_DEFAULTS[type].name })),
        ...(imageData ? { mask: { left: maskLayer.left ?? 0, top: maskLayer.top ?? 0, imageData, defaultColor: 0 } } : {}),
      };
    }
    const layers = grp.kind === 'panel' ? grp.layers.filter((l) => l.overFrame === over) : grp.layers;
    if (over && !layers.length) return null;
    return {
      name: over ? name + ' · Over frame' : name,
      children: [...layers].reverse().map((l) => layer(grp, l)),
      hidden: !grp.visible,
      opened: !grp.collapsed,
    };
  };
  const lettering = captionGroups(page.balloons);
  const letteringLayer: PsdLayer = lettering.some((group) => group.length > 1)
    ? { name: 'Lettering', children: lettering.map((group, i) => {
      const root = group[0]!;
      const panel = panelAt(panels, { x: root.cap.x / PT, y: root.cap.y / PT });
      const label = groupWords(group).replace(/\s+/g, ' ').slice(0, 44) || `Caption ${i + 1}`;
      return painted((panel ? `Panel ${panel.index + 1} · ` : '') + label, () => drawBalloons(g, { ...page, balloons: group }, dpi, sheet));
    }).reverse() }
    : page.balloons.length ? painted('Lettering', () => drawBalloons(g, page, dpi, sheet)) : { name: 'Lettering' };
  const fixed = source.groups.filter((grp) => grp.kind === 'panel' && !panelForGroup(panels, grp)?.transform);
  const placed = panelStack(panels).reverse().flatMap((panel) => {
    if (!panel.transform) return [];
    const groups = source.groups.filter((grp) => grp.kind === 'panel' && panelForGroup(panels, grp) === panel);
    return [
      ...groups.map((grp) => group(grp, true)),
      painted(`Panel ${panel.index + 1} border`, () => paintPlacedFrame(g, page, panel, dpi, 'ink')),
      ...groups.map((grp) => group(grp)),
      painted(`Panel ${panel.index + 1} paper`, () => paintPlacedFrame(g, page, panel, dpi, 'paper')),
    ];
  });
  const markLayer: PsdLayer | null = (page.marks ?? []).some((m) => !m.hidden) ? painted('Artist mark', () => drawMarks(g, page, dpi)) : null;
  const children: (PsdLayer | null)[] = [
    letteringLayer,
    markLayer,
    ...source.groups.filter((grp) => grp.kind === 'over').map((grp) => group(grp)),
    ...placed,
    ...fixed.map((grp) => group(grp, true)),
    ...source.groups.filter((grp) => grp.kind === 'gutter').map((grp) => group(grp)),
    painted('Panel borders and gutters', () => drawGutters(g, page, dpi)),
    ...fixed.map((grp) => group(grp)),
    ...source.groups.filter((grp) => grp.kind === 'background').map((grp) => group(grp)),
    painted('Paper', () => drawPagePaper(g, page, panels, dpi, false, true)),
  ];
  renderPage(g, source, mode === 'art' ? art : null, { scale: dpi, panels, sheet });
  const imageData = g.getImageData(0, 0, width, height);
  canvas.width = canvas.height = 0;
  return {
    width, height, imageData,
    // The writer serializes PSD layer records in the order supplied, back to front.
    children: children.filter((l) => l !== null).reverse(),
    imageResources: { resolutionInfo: {
      horizontalResolution: dpi, verticalResolution: dpi,
      horizontalResolutionUnit: 'PPI', verticalResolutionUnit: 'PPI',
      widthUnit: 'Inches', heightUnit: 'Inches',
    } },
  };
}

export interface PsdPlan {
  /** 1-based page numbers, in book order. */
  pages: number[];
  file: string;
  /** "Page 2" or "Pages 2–5 (4 PSDs in a ZIP)". */
  pagesLabel: string;
  trimLabel: string;
  pixelsLabel: string;
  contents: string[];
  /** Too large for browser export at this resolution. */
  tooLarge: boolean;
}

const inches = (n: number) => String(Math.round(n * 1000) / 1000) + '″';

/** What a drawing export will write, shown before download. Pure, so tests can check it. */
export function psdPlan(book: Book, range: PageRange, mode: PsdMode, dpi: number, stem: string): PsdPlan {
  const pages = pagesIn(book, range);
  const numbers = pages.map((p) => book.pages.indexOf(p) + 1);
  const base = stem + (mode === 'template' ? '-template' : '');
  const single = numbers.length === 1;
  const file = single ? base + '-page-' + numbers[0] + '.psd' : base + '-pages-' + numbers[0] + '-' + numbers[numbers.length - 1] + '.zip';
  const sizes = [...new Set(pages.map((p) => p.widthIn + '×' + p.heightIn))];
  const first = pages[0];
  const px = first ? pagePixels(first, dpi) : { width: 0, height: 0 };
  const mixed = sizes.length > 1;
  const tooLarge = pages.some((p) => {
    const { width, height } = pagePixels(p, dpi);
    return width > 30_000 || height > 30_000 || width * height > 32_000_000;
  });
  const contents = mode === 'template'
    ? [
      'Each panel group: blank Pencil, Ink and Colour layers, masked to the panel shape.',
      'Panel borders and gutters, and the paper.',
      'Lettering as pixels on its own layer, split by caption group when balloons are grouped.',
      'No artwork. Your drawing starts on the blank layers.',
    ]
    : [
      'Every panel group with its artwork layers (pencil, ink, colour, tones, placed images).',
      'Background, gutter and over-panel groups, borders and the paper.',
      'Lettering as pixels on its own layer, split by caption group when balloons are grouped.',
      'Vector ink and screentones are rendered as pixels.',
    ];
  contents.push('Edit lettering, cuts and script in the .inkflo book, then export again.');
  return {
    pages: numbers,
    file,
    pagesLabel: !numbers.length ? 'No pages' : single ? 'Page ' + numbers[0] : 'Pages ' + numbers[0] + '–' + numbers[numbers.length - 1] + ' (' + numbers.length + ' PSDs in a ZIP)',
    trimLabel: first ? (mixed ? 'Mixed sizes, first page ' : '') + inches(first.widthIn) + ' × ' + inches(first.heightIn) + ' trim, no bleed' : '',
    pixelsLabel: first ? px.width.toLocaleString('en-US') + ' × ' + px.height.toLocaleString('en-US') + ' px at ' + dpi + ' dpi' : '',
    contents,
    tooLarge,
  };
}

export async function exportPsd(studio: Studio, range: PageRange, mode: PsdMode, dpi: number, progress: Progress): Promise<Blob> {
  const book = studio.book!;
  const pages = pagesIn(book, range);
  if (!pages.length) throw new Error('Choose at least one page.');
  const { writePsdUint8Array } = await import('ag-psd');
  const files: ZipFile[] = [];
  for (const page of pages) {
    const n = book.pages.indexOf(page) + 1;
    progress('Writing PSD for page ' + n + '…');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await lettersReady(page.balloons.map((l) => l.cap));
    const art = mode === 'art' ? studio.ensureArt(page) : null;
    try {
      if (art) await studio.residency.pin(art);
      const bytes = writePsdUint8Array(pagePsd(book, page, art, dpi, mode));
      if (pages.length === 1) return new Blob([bytes as BlobPart], { type: 'image/vnd.adobe.photoshop' });
      files.push({ name: 'page-' + String(n).padStart(3, '0') + '.psd', data: bytes });
    } finally {
      if (art) studio.residency.unpin(art);
    }
  }
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}
