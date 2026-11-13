import type { Studio } from '../app/studio';
import { sheetOf } from '../doc/model';
import { writeZip, type ZipFile } from '../engine/io/zip';
import { lettersReady } from '../render/fonts';
import { renderPage } from '../render/page';
import { encodePng, makeCanvas } from './canvasops';
import type { Progress } from './exports';
import { pagesIn, type PageRange } from './printexport';

export const SCROLL_WIDTH = 800;
export const SCROLL_HEIGHT = 1280;
export const DEFAULT_SCROLL_GAP = 80;

interface Slice {
  file: string;
  width: number;
  height: number;
  alt: string;
}

/** Art shown in the break after a page (a divider, a footer, a "to be continued" banner). */
export interface BreakArt {
  image: CanvasImageSource & { width: number; height: number };
  /** Full strip width, or the image's own pixel size centred (never wider than the strip). */
  fit: 'width' | 'natural';
  /** Also after the last page, as the episode's footer. */
  end: boolean;
}

export interface ScrollOptions {
  range: PageRange;
  gap: number;
  background: string | null;
  breakArt?: BreakArt | null;
}

/** The art's drawn size in a strip `width` pixels wide. */
export function breakArtSize(art: BreakArt, width = SCROLL_WIDTH): { w: number; h: number } {
  const scale = art.fit === 'width' || art.image.width > width ? width / art.image.width : 1;
  return { w: Math.round(art.image.width * scale), h: Math.max(1, Math.round(art.image.height * scale)) };
}

/** Height of the break after page `index` of `count`: the gap, plus the art when it shows there. */
export function breakHeight(options: Pick<ScrollOptions, 'gap' | 'breakArt'>, index: number, count: number, width = SCROLL_WIDTH): number {
  const last = index === count - 1;
  const art = options.breakArt && (!last || options.breakArt.end) ? breakArtSize(options.breakArt, width).h : 0;
  const gap = last ? 0 : Math.round(Math.max(0, Math.min(960, options.gap)) * width / SCROLL_WIDTH);
  return art ? art + gap : gap;
}

/** Paint a break band (background already filled): the art centred, the gap split around it. */
function paintBreak(g: CanvasRenderingContext2D, art: BreakArt | null | undefined, width: number, height: number): void {
  if (!art) return;
  const { w, h } = breakArtSize(art, width);
  g.drawImage(art.image, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
}

const html = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function scrollReader(title: string, author: string, slices: Slice[], background: string | null): string {
  const color = background && /^#[0-9a-f]{6}$/i.test(background) ? background : '#ffffff';
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#efefec;color:#202225;font:16px/1.5 system-ui,sans-serif}
header{max-width:800px;margin:auto;padding:24px 20px}h1,p{margin:0}main{max-width:800px;margin:auto;background:${color}}
img{display:block;width:100%;height:auto}
</style>
<header><h1>${html(title)}</h1>${author ? `<p>${html(author)}</p>` : ''}</header>
<main aria-label="Comic episode">
${slices.map((s, i) => `<img src="${html(s.file)}" width="${s.width}" height="${s.height}" alt="${html(s.alt)}"${i > 0 ? ' loading="lazy"' : ''}>`).join('\n')}
</main>
</html>`;
}

/** Build contiguous strips with only one output strip and one source page resident at a time. */
export async function exportScroll(studio: Studio, options: ScrollOptions, progress: Progress): Promise<Blob> {
  const book = studio.book!;
  const pages = pagesIn(book, options.range);
  if (!pages.length) throw new Error('Choose at least one page.');
  const heightOf = (p: typeof pages[number]) => Math.max(1, Math.round(p.heightIn * SCROLL_WIDTH / p.widthIn));
  const total = pages.reduce((sum, p, i) => sum + heightOf(p) + breakHeight(options, i, pages.length), 0);
  const files: ZipFile[] = [];
  const slices: Slice[] = [];
  const canvas = makeCanvas(SCROLL_WIDTH, Math.min(SCROLL_HEIGHT, total));
  const g = canvas.getContext('2d')!;
  let y = 0;
  let written = 0;
  let label = '';
  const fillBackground = () => {
    if (options.background) { g.fillStyle = options.background; g.fillRect(0, 0, canvas.width, canvas.height); }
  };
  fillBackground();
  const flush = async () => {
    const file = 'images/' + String(slices.length + 1).padStart(4, '0') + '.png';
    files.push({ name: file, data: await encodePng(canvas) });
    slices.push({ file, width: canvas.width, height: canvas.height, alt: label });
    written += canvas.height;
    label = '';
    y = 0;
    if (written < total) {
      canvas.height = Math.min(SCROLL_HEIGHT, total - written);
      fillBackground();
    }
  };
  for (const [i, page] of pages.entries()) {
    const number = book.pages.indexOf(page) + 1;
    progress(`Preparing page ${number} · ${i + 1} of ${pages.length}`);
    const art = studio.ensureArt(page);
    const pageScale = SCROLL_WIDTH / page.widthIn;
    const height = heightOf(page);
    const band = makeCanvas(SCROLL_WIDTH, Math.min(height, SCROLL_HEIGHT));
    const b = band.getContext('2d')!;
    try {
      await studio.residency.pin(art);
      await lettersReady(page.balloons.map((l) => l.cap));
      let top = 0;
      while (top < height) {
        const rows = Math.min(height - top, canvas.height - y);
        b.resetTransform();
        b.clearRect(0, 0, band.width, band.height);
        b.setTransform(1, 0, 0, 1, 0, -top);
        renderPage(b, page, art, { scale: pageScale, printOnly: true, sheet: sheetOf(book) });
        g.drawImage(band, 0, 0, SCROLL_WIDTH, rows, 0, y, SCROLL_WIDTH, rows);
        label = label ? label : 'Comic page ' + number;
        y += rows;
        top += rows;
        if (y === canvas.height) await flush();
      }
    } finally { studio.residency.unpin(art); }
    // the break after this page: copied row by row like a page, so art that straddles two
    // strips lines up exactly when the reader stacks them
    const breakRows = breakHeight(options, i, pages.length);
    if (breakRows > 0) {
      const band = makeCanvas(SCROLL_WIDTH, breakRows);
      const bg = band.getContext('2d')!;
      if (options.background) { bg.fillStyle = options.background; bg.fillRect(0, 0, SCROLL_WIDTH, breakRows); }
      paintBreak(bg, i + 1 < pages.length || options.breakArt?.end ? options.breakArt : null, SCROLL_WIDTH, breakRows);
      let top = 0;
      while (top < breakRows) {
        const rows = Math.min(breakRows - top, canvas.height - y);
        g.clearRect(0, y, SCROLL_WIDTH, rows);
        g.drawImage(band, 0, top, SCROLL_WIDTH, rows, 0, y, SCROLL_WIDTH, rows);
        y += rows;
        top += rows;
        if (y === canvas.height) await flush();
      }
      band.width = band.height = 0;
    }
  }
  const encoder = new TextEncoder();
  files.push({ name: 'index.html', data: encoder.encode(scrollReader(book.title, book.author, slices, options.background)) });
  files.push({ name: 'episode.json', data: encoder.encode(JSON.stringify({ title: book.title, author: book.author, slices }, null, 2)) });
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}

/**
 * A small picture of the episode: the first pages of the range stacked with their breaks, at
 * `width` pixels wide. Shown in the export dialog before anything is written.
 */
export async function scrollPreview(studio: Studio, options: ScrollOptions, width = 180, maxPages = 3): Promise<HTMLCanvasElement> {
  const book = studio.book!;
  const pages = pagesIn(book, options.range).slice(0, maxPages);
  const heights = pages.map((p) => Math.max(1, Math.round(p.heightIn * width / p.widthIn)));
  const breaks = pages.map((_, i) => breakHeight(options, i, pages.length, width));
  const canvas = makeCanvas(width, Math.max(1, heights.reduce((a, b) => a + b, 0) + breaks.reduce((a, b) => a + b, 0)));
  const g = canvas.getContext('2d')!;
  if (options.background) { g.fillStyle = options.background; g.fillRect(0, 0, canvas.width, canvas.height); }
  let y = 0;
  for (const [i, page] of pages.entries()) {
    const art = studio.ensureArt(page);
    try {
      await studio.residency.pin(art);
      g.setTransform(1, 0, 0, 1, 0, y);
      renderPage(g, page, art, { scale: width / page.widthIn, printOnly: true, sheet: sheetOf(book), smoothing: 'medium' });
    } finally { studio.residency.unpin(art); }
    g.resetTransform();
    y += heights[i]!;
    if (breaks[i]) {
      g.save();
      g.translate(0, y);
      paintBreak(g, i + 1 < pages.length || options.breakArt?.end ? options.breakArt : null, width, breaks[i]!);
      g.restore();
      y += breaks[i]!;
    }
  }
  return canvas;
}
