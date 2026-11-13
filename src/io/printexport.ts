import type { Studio } from '../app/studio';
import { sheetOf, type Book, type LayerType, type Page } from '../doc/model';
import type { PageArt } from '../draw/residency';
import { writeZip, type ZipFile } from '../engine/io/zip';
import { groupLabel } from '../geom/groups';
import { derivePanels } from '../geom/carve';
import { bookletSheets, checkCount, miniZineCells, printOrder, printOf, readerSpreads } from '../geom/printkinds';
import { lettersReady } from '../render/fonts';
import { drawLayerBitmap, renderPage } from '../render/page';
import { encodePng, makeCanvas } from './canvasops';
import { withPages, type Progress } from './exports';
import { browserDeflate, PdfDoc, PdfPage, type PdfImage } from './pdf';

/**
 * Print it (the guided path) and Export files (the artist path), EXPLORE-DESK-UI §12 and §15.
 * Everything renders through `renderPage` (rule 5); this file only arranges pages on sheets.
 */

const PT = 72;
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export type Separation = 'all' | 'inks' | 'colours' | 'pencils' | 'lettering';
export const SEPARATION_LABEL: Record<Separation, string> = {
  all: 'Finished pages',
  inks: 'Inks only',
  colours: 'Colours only',
  pencils: 'Pencils only',
  lettering: 'Lettering only',
};

export interface PageRange {
  from: number;
  to: number;
}

export function pagesIn(book: Book, range?: PageRange): Page[] {
  if (!range) return book.pages;
  const a = Math.max(1, Math.min(range.from, range.to));
  const b = Math.min(book.pages.length, Math.max(range.from, range.to));
  return book.pages.slice(a - 1, b);
}

const ALL_OFF: Record<LayerType, boolean> = { pencil: false, ink: false, colour: false, tone: false, reference: false };

/**
 * One page at `dpi`, trim size, for a separation. `background` 'white' paints paper white under
 * separations; finished pages always have their own paper.
 */
export async function renderSeparation(page: Page, art: PageArt | null, dpi: number, book: Book, sep: Separation, background: 'white' | 'transparent' = 'white', borders = true): Promise<HTMLCanvasElement> {
  const c = makeCanvas(Math.round(page.widthIn * dpi), Math.round(page.heightIn * dpi));
  const g = c.getContext('2d')!;
  const sheet = sheetOf(book);
  if (sep === 'all' || sep === 'lettering') await lettersReady(page.balloons.map((l) => l.cap));
  if (sep === 'all') {
    renderPage(g, page, art, { scale: dpi, printOnly: true, sheet });
    return c;
  }
  const types = { ...ALL_OFF, ...(sep === 'inks' ? { ink: true } : sep === 'colours' ? { colour: true, tone: true } : sep === 'pencils' ? { pencil: true } : {}) };
  renderPage(g, page, art, {
    scale: dpi, types, printOnly: sep !== 'pencils', frame: false, frameInk: sep === 'inks' && borders,
    knockoutPanels: sep !== 'lettering', whiteBackground: background === 'white', balloons: sep === 'lettering', sheet,
  });
  return c;
}

/** The page with bleed: the trim render centred, edge pixels stretched into the bleed. */
function withBleed(trim: HTMLCanvasElement, bleedPx: number): HTMLCanvasElement {
  if (bleedPx <= 0) return trim;
  const w = trim.width;
  const h = trim.height;
  const c = makeCanvas(w + bleedPx * 2, h + bleedPx * 2);
  const g = c.getContext('2d')!;
  const b = bleedPx;
  g.imageSmoothingEnabled = false;
  g.drawImage(trim, b, b);
  // edges, then corners (each a 1-pixel strip stretched)
  g.drawImage(trim, 0, 0, w, 1, b, 0, w, b);
  g.drawImage(trim, 0, h - 1, w, 1, b, h + b, w, b);
  g.drawImage(trim, 0, 0, 1, h, 0, b, b, h);
  g.drawImage(trim, w - 1, 0, 1, h, w + b, b, b, h);
  g.drawImage(trim, 0, 0, 1, 1, 0, 0, b, b);
  g.drawImage(trim, w - 1, 0, 1, 1, w + b, 0, b, b);
  g.drawImage(trim, 0, h - 1, 1, 1, 0, h + b, b, b);
  g.drawImage(trim, w - 1, h - 1, 1, 1, w + b, h + b, b, b);
  return c;
}

async function pdfImage(doc: PdfDoc, c: HTMLCanvasElement): Promise<PdfImage> {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  return doc.addImage(d, c.width, c.height);
}

function blankCanvas(page: Page, dpi: number): HTMLCanvasElement {
  const c = makeCanvas(Math.round(page.widthIn * dpi), Math.round(page.heightIn * dpi));
  const g = c.getContext('2d')!;
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export type PrintMode = 'shop' | 'pod' | 'booklet' | 'minizine';
export type Paper = 'letter' | 'a4';
const PAPER: Record<Paper, { w: number; h: number; label: string }> = { letter: { w: 11, h: 8.5, label: 'Letter' }, a4: { w: 11.693, h: 8.268, label: 'A4' } };

export interface PrintOptions {
  mode: PrintMode;
  paper: Paper;
  marks: boolean;
  /** Pixels per inch for the page images (book dpi by default). */
  dpi?: number;
}

/** What a print export will contain, for the preview before exporting. */
export interface PrintPlan {
  order: (number | null)[];
  message: string;
  sheets?: number;
}

export function planPrint(book: Book, mode: PrintMode): PrintPlan {
  const spec = printOf(book);
  const n = book.pages.length;
  if (mode === 'minizine') {
    const order = Array.from({ length: 8 }, (_, i) => (i < n ? i : null));
    const message = n > 8 ? `A mini-zine holds 8 pages: pages 9–${n} are left out.` : n < 8 ? `${8 - n} blank page${8 - n === 1 ? '' : 's'} will fill the 8 spots.` : '';
    return { order, message, sheets: 1 };
  }
  const binding = mode === 'booklet' ? 'saddle' : spec.binding === 'web' ? 'none' : spec.binding;
  const order = printOrder(n, binding, spec.blanks);
  const check = checkCount(n, binding);
  return { order, message: check.message, sheets: mode === 'booklet' ? order.length / 4 : undefined };
}

/** The guided print PDFs. */
export async function exportPrintPdf(studio: Studio, opt: PrintOptions, progress: Progress = () => {}): Promise<Blob> {
  const book = studio.book!;
  const spec = printOf(book);
  const dpi = opt.dpi ?? book.dpi;
  const plan = planPrint(book, opt.mode);
  const doc = new PdfDoc(browserDeflate, book.title);
  return withPages(studio, async (artOf) => {
    const first = book.pages[0]!;
    const render = async (slot: number | null): Promise<HTMLCanvasElement> => {
      if (slot === null) return blankCanvas(first, dpi);
      const page = book.pages[slot]!;
      return renderSeparation(page, artOf(page), dpi, book, 'all');
    };

    if (opt.mode === 'shop' || opt.mode === 'pod') {
      const bleedPx = Math.round(spec.bleed * dpi);
      const margin = opt.mode === 'shop' && opt.marks ? 0.375 : 0;
      for (const [i, slot] of plan.order.entries()) {
        progress(`Page ${i + 1} of ${plan.order.length}…`);
        await yieldToUi();
        const page = slot === null ? first : book.pages[slot]!;
        let canvas: HTMLCanvasElement;
        if (slot !== null && bleedPx && page.layout?.panelTransforms?.length) {
          const art = artOf(page);
          await lettersReady(page.balloons.map((l) => l.cap));
          canvas = makeCanvas(Math.round(page.widthIn * dpi) + bleedPx * 2, Math.round(page.heightIn * dpi) + bleedPx * 2);
          const g = canvas.getContext('2d')!;
          g.fillStyle = page.layout.gutterPaper ?? '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
          g.translate(bleedPx, bleedPx);
          renderPage(g, page, art, { scale: dpi, bleed: bleedPx / dpi, printOnly: true, sheet: sheetOf(book) });
        } else canvas = withBleed(await render(slot), bleedPx);
        const img = await pdfImage(doc, canvas);
        const tw = page.widthIn * PT;
        const th = page.heightIn * PT;
        const b = spec.bleed * PT;
        const m = margin * PT;
        const p = new PdfPage(tw + 2 * (b + m), th + 2 * (b + m));
        p.image(img, m, m, tw + 2 * b, th + 2 * b);
        if (margin) {
          p.cropMarks(m + b, m + b, tw, th, b + 3);
          p.text(`${book.title} - ${slot === null ? 'blank' : `page ${slot + 1}`}`, m + b, 9, 6);
        }
        doc.addPage(p, { trim: [m + b, m + b, m + b + tw, m + b + th], bleed: [m, m, m + tw + 2 * b, m + th + 2 * b] });
      }
    } else if (opt.mode === 'booklet') {
      const paper = PAPER[opt.paper];
      const W = paper.w * PT;
      const H = paper.h * PT;
      const sheets = bookletSheets(plan.order.length);
      doc.addPage(instructions(book, opt, plan, W, H));
      const half = W / 2;
      const inset = 0.2 * PT;
      const place = async (p: PdfPage, slot: number | null, x0: number) => {
        const s = plan.order[slot ?? -1];
        const page = s === null || s === undefined ? first : book.pages[s]!;
        const img = await pdfImage(doc, await render(s ?? null));
        const k = Math.min((half - inset * 2) / (page.widthIn * PT), (H - inset * 2) / (page.heightIn * PT));
        const w = page.widthIn * PT * k;
        const h = page.heightIn * PT * k;
        // pages sit against the fold, so the spread reads as one
        const x = x0 === 0 ? half - w : half;
        p.image(img, x, (H - h) / 2, w, h);
      };
      for (const [i, sh] of sheets.entries()) {
        progress(`Sheet ${i + 1} of ${sheets.length}…`);
        await yieldToUi();
        for (const side of [sh.front, sh.back]) {
          const p = new PdfPage(W, H);
          await place(p, side.left, 0);
          await place(p, side.right, 1);
          p.line(half, H - 10, half, H - 22, 0.25, 0.6).line(half, 10, half, 22, 0.25, 0.6);
          doc.addPage(p);
        }
      }
    } else {
      const paper = PAPER[opt.paper];
      const W = paper.w * PT;
      const H = paper.h * PT;
      const cw = W / 4;
      const ch = H / 2;
      progress('Laying out the mini-zine…');
      const p = new PdfPage(W, H);
      for (const cell of miniZineCells()) {
        const s = plan.order[cell.slot] ?? null;
        const page = s === null ? first : book.pages[s]!;
        const img = await pdfImage(doc, await render(s));
        const k = Math.min((cw - 8) / (page.widthIn * PT), (ch - 8) / (page.heightIn * PT));
        const w = page.widthIn * PT * k;
        const h = page.heightIn * PT * k;
        // PDF y is up: row 0 (top of the sheet) is the upper half
        const y0 = cell.row === 0 ? ch : 0;
        p.image(img, cell.col * cw + (cw - w) / 2, y0 + (ch - h) / 2, w, h, cell.rotated);
      }
      for (let c = 1; c < 4; c++) p.line(c * cw, 0, c * cw, H, 0.4, 0.75, [4, 3]);
      p.line(0, ch, cw, ch, 0.4, 0.75, [4, 3]).line(3 * cw, ch, W, ch, 0.4, 0.75, [4, 3]);
      p.line(cw, ch, 3 * cw, ch, 0.8, 0); // the one cut
      doc.addPage(p);
      doc.addPage(zineInstructions(W, H));
    }
    progress('Writing the PDF…');
    return new Blob([(await doc.build()) as BlobPart], { type: 'application/pdf' });
  });
}

function instructions(book: Book, opt: PrintOptions, plan: PrintPlan, W: number, H: number): PdfPage {
  const p = new PdfPage(W, H);
  const paper = PAPER[opt.paper].label;
  let y = H - 64;
  const line = (s: string, size = 11, bold = false, gap = 18) => {
    p.text(s, 54, y, size, bold);
    y -= gap;
  };
  line(`How to print "${book.title}" as a booklet`, 18, true, 30);
  line(`1. This first page is just instructions. Print pages 2-${1 + (plan.sheets ?? 0) * 2} only.`);
  line(`2. Paper: ${paper}, landscape. Print on both sides (duplex), "flip on short edge".`);
  line('3. Scale: "Actual size" (or 100%), not "Fit to page".');
  line('4. No duplex printer? Print the odd pages, put the stack back in, then print the even pages.', 11, false, 18);
  line('   Try one sheet first to check which way round your printer feeds paper.', 11, false, 26);
  line(`5. Stack the ${plan.sheets} sheet${plan.sheets === 1 ? '' : 's'} in order, fold in half, and staple along the fold.`, 11, false, 30);
  if (plan.message) line(plan.message, 11, true, 26);
  line(`Pages in order: ${plan.order.map((s) => (s === null ? 'blank' : String(s + 1))).join(', ')}`, 9, false, 16);
  line('Made with inkflo.', 9);
  return p;
}

function zineInstructions(W: number, H: number): PdfPage {
  const p = new PdfPage(W, H);
  let y = H - 64;
  const line = (s: string, size = 11, bold = false) => {
    p.text(s, 54, y, size, bold);
    y -= size + 9;
  };
  line('How to fold the mini-zine', 18, true);
  line('1. Print page 1 only, one side, "Actual size". Dashed lines are folds; the solid line is the one cut.');
  line('2. Fold in half the long way (picture up), then unfold. Fold in half the short way, then in quarters.');
  line('3. Unfold, and cut along the solid line in the middle (only between the two inner folds).');
  line('4. Fold the long way again, push the ends together so the cut opens into a diamond, and flatten.');
  line('5. Wrap the pages around so page 1 (the cover) is on the front.');
  line('Made with inkflo.', 9);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Export files

export type ImageFormat = 'png' | 'jpg' | 'webp';
const MIME: Record<ImageFormat, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

async function encode(c: HTMLCanvasElement, f: ImageFormat): Promise<Uint8Array> {
  if (f === 'png') return encodePng(c);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, MIME[f], 0.92));
  if (!blob) throw new Error(`This browser can't write ${f.toUpperCase()}.`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Grey: luminance, alpha kept. Hard black: lines become pure black or white (no grey). */
export function tone(c: HTMLCanvasElement, mode: 'colour' | 'grey' | 'hard'): void {
  if (mode === 'colour') return;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    if (mode === 'grey') d[i] = d[i + 1] = d[i + 2] = y;
    else {
      // over white: dark enough → solid black, else nothing
      const over = 255 - ((255 - y) * d[i + 3]!) / 255;
      const ink = over < 128;
      d[i] = d[i + 1] = d[i + 2] = 0;
      d[i + 3] = ink ? 255 : 0;
    }
  }
  g.putImageData(img, 0, 0);
}

export interface FilesOptions {
  format: ImageFormat;
  seps: Separation[];
  background: 'white' | 'transparent';
  colour: 'colour' | 'grey' | 'hard';
  borders: boolean;
  range?: PageRange;
  dpi?: number;
}

/** Page images per separation in a zip: `inks/page-001.png` and so on. */
export async function exportPageFiles(studio: Studio, opt: FilesOptions, progress: Progress = () => {}): Promise<Blob> {
  const book = studio.book!;
  const dpi = opt.dpi ?? book.dpi;
  const pages = pagesIn(book, opt.range);
  const files: ZipFile[] = [];
  const bg = opt.format === 'jpg' ? 'white' : opt.background;
  await withPages(studio, async (artOf) => {
    for (const page of pages) {
      const n = book.pages.indexOf(page) + 1;
      for (const sep of opt.seps) {
        progress(`${SEPARATION_LABEL[sep]}: page ${n}…`);
        await yieldToUi();
        const c = await renderSeparation(page, artOf(page), dpi, book, sep, bg, opt.borders);
        tone(c, sep === 'inks' || sep === 'pencils' ? opt.colour : opt.colour === 'hard' ? 'grey' : opt.colour);
        const folder = opt.seps.length > 1 ? `${sep}/` : '';
        files.push({ name: `${folder}page-${String(n).padStart(3, '0')}.${opt.format}`, data: await encode(c, opt.format) });
      }
    }
  });
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9 _.-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'layer';

/** Every layer separately, `page-001/02-panel-2/ink.png`: transparent, page-sized, so they stack. */
export async function exportLayerFiles(studio: Studio, range?: PageRange, progress: Progress = () => {}): Promise<Blob> {
  const book = studio.book!;
  const files: ZipFile[] = [];
  await withPages(studio, async (artOf) => {
    for (const page of pagesIn(book, range)) {
      const n = book.pages.indexOf(page) + 1;
      const art = artOf(page);
      const panels = derivePanels(page);
      const dir = `page-${String(n).padStart(3, '0')}`;
      // bottom of the stack first, so names sort in stacking order
      const groups = [...page.groups].reverse();
      for (const [gi, group] of groups.entries()) {
        const gdir = `${String(gi + 1).padStart(2, '0')}-${safe(groupLabel(page, panels, group))}`;
        const layers = [...group.layers].reverse();
        for (const [li, layer] of layers.entries()) {
          const c = art.planes[layer.id];
          if (!c || !c.width) continue;
          progress(`Page ${n}: ${layer.name}…`);
          await yieldToUi();
          const placed = layer.image ? makeCanvas(art.width, art.height) : c;
          if (layer.image) drawLayerBitmap(placed.getContext('2d')!, c, art.width, art.height, book.dpi, layer.image);
          files.push({ name: `${dir}/${gdir}/${String(li + 1).padStart(2, '0')}-${safe(layer.name)}.png`, data: await encodePng(placed) });
        }
      }
      if (page.balloons.length) {
        const c = await renderSeparation(page, art, book.dpi, book, 'lettering', 'transparent');
        files.push({ name: `${dir}/99-lettering.png`, data: await encodePng(c) });
      }
    }
  });
  if (!files.length) throw new Error('No drawn layers in those pages yet.');
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}

/** Reader spreads as a PDF (two pages side by side, cover alone), for proofing on screen. */
export async function exportSpreadsPdf(studio: Studio, progress: Progress = () => {}): Promise<Blob> {
  const book = studio.book!;
  const spec = printOf(book);
  const doc = new PdfDoc(browserDeflate, book.title);
  const dpi = Math.min(book.dpi, 150);
  return withPages(studio, async (artOf) => {
    const first = book.pages[0]!;
    const w = first.widthIn * PT;
    const h = first.heightIn * PT;
    for (const [i, pair] of readerSpreads(book.pages.length, spec.rtl).entries()) {
      progress(`Spread ${i + 1}…`);
      await yieldToUi();
      const p = new PdfPage(w * 2, h);
      for (const [side, slot] of pair.entries()) {
        if (slot === null) continue;
        const page = book.pages[slot]!;
        const img = await pdfImage(doc, await renderSeparation(page, artOf(page), dpi, book, 'all'));
        p.image(img, side * w, 0, w, h);
      }
      doc.addPage(p);
    }
    return new Blob([(await doc.build()) as BlobPart], { type: 'application/pdf' });
  });
}
