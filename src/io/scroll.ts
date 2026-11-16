import type { Studio } from '../app/studio';
import { sheetOf, type Book, type Page } from '../doc/model';
import { bookFileStem, publicationLabel } from './publication';
import { crc32, writeZip, type ZipFile } from '../engine/io/zip';
import { lettersReady } from '../render/fonts';
import { renderPage } from '../render/page';
import { encodeImage, makeCanvas } from './canvasops';
import type { Progress } from './exports';
import { pagesIn, type PageRange } from './printexport';
import { blankEdgeRows, clampQuality, clampSlice, clampWidth, DEFAULT_QUALITY, formatBytes, formatInfo, stripCount, type WebFormat } from './webformat';

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
  /** Strip width in pixels (default 800). */
  width?: number;
  /** Tallest single image in pixels (default 1280). The episode is cut into strips this tall. */
  sliceHeight?: number;
  /** Image format for the package (default PNG). The long single image is always PNG. */
  format?: WebFormat;
  /** 0.3 to 1 for WebP and JPG. */
  quality?: number;
  /** Cut empty margin from the very top of the first page and bottom of the last. */
  trim?: boolean;
}

/** The options with every default filled in and clamped to its limits. */
export function resolveScroll(o: ScrollOptions) {
  const format = o.format ?? 'png';
  return {
    width: clampWidth(o.width ?? SCROLL_WIDTH),
    sliceHeight: clampSlice(o.sliceHeight ?? SCROLL_HEIGHT),
    format,
    info: formatInfo(format),
    quality: clampQuality(o.quality ?? DEFAULT_QUALITY),
    trim: !!o.trim,
    // JPG cannot be transparent: flatten onto white
    background: o.background ?? (format === 'jpeg' ? '#ffffff' : null),
  };
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

export function scrollReader(title: string, author: string, slices: Slice[], background: string | null, width = SCROLL_WIDTH, publication = ''): string {
  const color = background && /^#[0-9a-f]{6}$/i.test(background) ? background : '#ffffff';
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#efefec;color:#202225;font:16px/1.5 system-ui,sans-serif}
header{max-width:${width}px;margin:auto;padding:24px 20px}h1,p{margin:0}main{max-width:${width}px;margin:auto;background:${color}}
img{display:block;width:100%;height:auto}
</style>
<header><h1>${html(title)}</h1>${publication ? `<p>${html(publication)}</p>` : ''}${author ? `<p>${html(author)}</p>` : ''}</header>
<main aria-label="Comic episode">
${slices.map((s, i) => `<img src="${html(s.file)}" width="${s.width}" height="${s.height}" alt="${html(s.alt)}"${i > 0 ? ' loading="lazy"' : ''}>`).join('\n')}
</main>
</html>`;
}

/** Empty margin above the first page and below the last, found by drawing them at the strip width. */
async function measureTrim(studio: Studio, book: Book, pages: Page[], width: number): Promise<{ top: number; bottom: number }> {
  const render = async (page: Page, edge: 'top' | 'bottom') => {
    const h = Math.max(1, Math.round(page.heightIn * width / page.widthIn));
    const canvas = makeCanvas(width, h);
    const art = studio.ensureArt(page);
    try {
      await studio.residency.pin(art);
      await lettersReady(page.balloons.map((l) => l.cap));
      renderPage(canvas.getContext('2d')!, page, art, { scale: width / page.widthIn, printOnly: true, sheet: sheetOf(book) });
      const rows = blankEdgeRows(canvas.getContext('2d')!.getImageData(0, 0, width, h).data, width, h, Math.round(width * 0.02));
      return edge === 'top' ? rows.top : rows.bottom;
    } finally {
      studio.residency.unpin(art);
      canvas.width = canvas.height = 0;
    }
  };
  return { top: await render(pages[0]!, 'top'), bottom: await render(pages[pages.length - 1]!, 'bottom') };
}

async function scrollPlan(studio: Studio, book: Book, options: ScrollOptions) {
  const pages = pagesIn(book, options.range);
  if (!pages.length) throw new Error('Choose at least one page.');
  const o = resolveScroll(options);
  const trim = o.trim ? await measureTrim(studio, book, pages, o.width) : { top: 0, bottom: 0 };
  const bands = pages.map((page, i) => {
    const full = Math.max(1, Math.round(page.heightIn * o.width / page.widthIn));
    // trim never eats a whole page: always leave at least one row
    const from = i === 0 ? Math.min(trim.top, full - 1) : 0;
    const to = i === pages.length - 1 ? Math.min(trim.bottom, full - from - 1) : 0;
    return { page, number: book.pages.indexOf(page) + 1, from, height: full - from - to, breakRows: breakHeight(options, i, pages.length, o.width) };
  });
  return { bands, total: bands.reduce((sum, band) => sum + band.height + band.breakRows, 0), ...o };
}

/** Before exporting: how tall the episode is and how many images it becomes (edge trimming not counted). */
export function scrollEstimate(book: Book, options: ScrollOptions): { width: number; rows: number; images: number } {
  const pages = pagesIn(book, options.range);
  const o = resolveScroll(options);
  const rows = pages.reduce((sum, p, i) => sum + Math.max(1, Math.round(p.heightIn * o.width / p.widthIn)) + breakHeight(options, i, pages.length, o.width), 0);
  return { width: o.width, rows, images: pages.length ? stripCount(rows, o.sliceHeight) : 0 };
}

/** Both download formats consume the same rendered strips, one at a time. */
async function* renderScrollStrips(studio: Studio, book: Book, options: ScrollOptions, progress: Progress, plan: Awaited<ReturnType<typeof scrollPlan>>) {
  const { bands, total, width: W, sliceHeight: SLICE, background } = plan;
  const canvas = makeCanvas(W, Math.min(SLICE, total));
  const g = canvas.getContext('2d')!;
  let y = 0;
  let written = 0;
  let label = '';
  const fillBackground = () => {
    if (background) { g.fillStyle = background; g.fillRect(0, 0, canvas.width, canvas.height); }
  };
  const advance = () => {
    written += canvas.height;
    label = '';
    y = 0;
    if (written < total) {
      canvas.height = Math.min(SLICE, total - written);
      fillBackground();
    }
  };
  try {
    fillBackground();
    for (const [i, { page, number, from, height, breakRows }] of bands.entries()) {
      progress(`Preparing page ${number} · ${i + 1} of ${bands.length}`);
      const art = studio.ensureArt(page);
      const pageScale = W / page.widthIn;
      const band = makeCanvas(W, Math.min(height, SLICE));
      const b = band.getContext('2d')!;
      try {
        await studio.residency.pin(art);
        await lettersReady(page.balloons.map((l) => l.cap));
        let top = 0;
        while (top < height) {
          const rows = Math.min(height - top, canvas.height - y);
          b.resetTransform();
          b.clearRect(0, 0, band.width, band.height);
          b.setTransform(1, 0, 0, 1, 0, -(from + top));
          renderPage(b, page, art, { scale: pageScale, printOnly: true, sheet: sheetOf(book) });
          g.drawImage(band, 0, 0, W, rows, 0, y, W, rows);
          label ||= page.title ? `Page ${number} · ${page.title}` : 'Comic page ' + number;
          y += rows;
          top += rows;
          if (y === canvas.height) {
            yield { canvas, label };
            advance();
          }
        }
      } finally {
        studio.residency.unpin(art);
        band.width = band.height = 0;
      }
      // Clip at strip edges so a divider lines up across strips without a full-height canvas.
      let top = 0;
      while (top < breakRows) {
        const rows = Math.min(breakRows - top, canvas.height - y);
        g.save();
        g.beginPath();
        g.rect(0, y, W, rows);
        g.clip();
        g.translate(0, y - top);
        paintBreak(g, options.breakArt, W, breakRows);
        g.restore();
        y += rows;
        top += rows;
        if (y === canvas.height) {
          yield { canvas, label };
          advance();
        }
      }
    }
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function exportScroll(studio: Studio, options: ScrollOptions, progress: Progress): Promise<Blob> {
  const book = studio.book!;
  const plan = await scrollPlan(studio, book, options);
  const { info, quality, width } = plan;
  const files: ZipFile[] = [];
  const slices: Slice[] = [];
  const stem = bookFileStem(book);
  let largest = 0;
  for await (const { canvas, label } of renderScrollStrips(studio, book, options, progress, plan)) {
    const file = `images/${stem}-${String(slices.length + 1).padStart(4, '0')}.${info.ext}`;
    const data = await encodeImage(canvas, info.mime, info.lossy ? quality : undefined);
    largest = Math.max(largest, data.length);
    files.push({ name: file, data });
    slices.push({ file, width: canvas.width, height: canvas.height, alt: label });
  }
  const total = files.reduce((sum, f) => sum + f.data.length, 0);
  const encoder = new TextEncoder();
  files.push({ name: 'index.html', data: encoder.encode(scrollReader(book.title, book.author, slices, plan.background, width, publicationLabel(book.publication))) });
  files.push({ name: 'episode.json', data: encoder.encode(JSON.stringify({ title: book.title, author: book.author, publication: book.publication, width, format: info.short, slices }, null, 2)) });
  files.push({ name: 'READ ME.txt', data: encoder.encode(scrollReadMe(book.title, slices.length, width, plan.sliceHeight, info.short, total, largest)) });
  progress(`${slices.length} image${slices.length === 1 ? '' : 's'}, ${formatBytes(total)} in all, largest ${formatBytes(largest)}`);
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}

function scrollReadMe(title: string, images: number, width: number, slice: number, format: string, total: number, largest: number): string {
  return `${title}
${'='.repeat(title.length)}

This package holds your comic episode as ${images} numbered ${format} image${images === 1 ? '' : 's'} (${width} px wide, up to ${slice} px tall each).
Total size: ${formatBytes(total)}. Largest image: ${formatBytes(largest)}.

TO PUBLISH
  1. Upload the images in the images folder, in order by the number at the end of each filename (0001 first).
  2. Or put the whole folder on any web host and share the link to index.html. It is a simple reader page.
  3. Check the upload rules of the site you publish on. Width, height and file size limits differ from site to site.
     If a file is too big, go back to inkflo and choose "Small and fast", or lower the quality.

BEFORE YOU POST
  - Is every drawing, character, font and sound yours, or used with permission? Credit anyone who helped.
  - Does each page read clearly on a phone? Zoom out and check the lettering.
  - Keep your .inkflo book file somewhere safe. It is the editable original; these images are not.

index.html and episode.json are optional extras. Most sites only need the images.
`;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, -4)));
  return chunk;
}

/** Write one PNG from the rendered rows, independent of the browser's maximum canvas height. */
export async function exportScrollPng(studio: Studio, options: ScrollOptions, progress: Progress): Promise<Blob> {
  const book = studio.book!;
  const plan = await scrollPlan(studio, book, { ...options, format: 'png' });
  if (!Number.isSafeInteger(plan.total) || plan.total < 1 || plan.total > 0x7fffffff) {
    throw new Error('The selected page range is too tall for a PNG. Choose a smaller range.');
  }

  const header = new Uint8Array(13);
  const dimensions = new DataView(header.buffer);
  dimensions.setUint32(0, plan.width);
  dimensions.setUint32(4, plan.total);
  header.set([8, 6], 8); // 8-bit RGBA
  const chunks: BlobPart[] = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk('IHDR', header),
  ];

  const deflate = new CompressionStream('deflate');
  const strips = renderScrollStrips(studio, book, { ...options, format: 'png' }, progress, plan);
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const { value, done } = await strips.next();
        if (done) { controller.close(); return; }
        const { canvas } = value;
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        const stride = canvas.width * 4;
        const rows = new Uint8Array((stride + 1) * canvas.height);
        // Each PNG scanline starts with filter type 0 (None).
        for (let y = 0; y < canvas.height; y++) {
          rows.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
        }
        controller.enqueue(rows);
      } catch (error) {
        await strips.return(undefined);
        throw error;
      }
    },
    async cancel() { await strips.return(undefined); },
  });
  const reader = source.pipeThrough(deflate).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(pngChunk('IDAT', value));
    }
  } finally {
    await reader.cancel();
  }
  chunks.push(pngChunk('IEND', new Uint8Array()));
  return new Blob(chunks, { type: 'image/png' });
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
