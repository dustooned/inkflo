import type { Studio } from '../app/studio';
import { sheetOf, type Book } from '../doc/model';
import { crc32, writeZip, type ZipFile } from '../engine/io/zip';
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

function scrollPlan(book: Book, options: ScrollOptions) {
  const pages = pagesIn(book, options.range);
  if (!pages.length) throw new Error('Choose at least one page.');
  const heightOf = (p: typeof pages[number]) => Math.max(1, Math.round(p.heightIn * SCROLL_WIDTH / p.widthIn));
  const bands = pages.map((page, i) => ({
    page, number: book.pages.indexOf(page) + 1, height: heightOf(page), breakRows: breakHeight(options, i, pages.length),
  }));
  return { bands, total: bands.reduce((sum, band) => sum + band.height + band.breakRows, 0) };
}

/** Both download formats consume the same rendered strips, one at a time. */
async function* renderScrollStrips(studio: Studio, book: Book, options: ScrollOptions, progress: Progress, plan: ReturnType<typeof scrollPlan>) {
  const { bands, total } = plan;
  const canvas = makeCanvas(SCROLL_WIDTH, Math.min(SCROLL_HEIGHT, total));
  const g = canvas.getContext('2d')!;
  let y = 0;
  let written = 0;
  let label = '';
  const fillBackground = () => {
    if (options.background) { g.fillStyle = options.background; g.fillRect(0, 0, canvas.width, canvas.height); }
  };
  const advance = () => {
    written += canvas.height;
    label = '';
    y = 0;
    if (written < total) {
      canvas.height = Math.min(SCROLL_HEIGHT, total - written);
      fillBackground();
    }
  };
  try {
    fillBackground();
    for (const [i, { page, number, height, breakRows }] of bands.entries()) {
      progress(`Preparing page ${number} · ${i + 1} of ${bands.length}`);
      const art = studio.ensureArt(page);
      const pageScale = SCROLL_WIDTH / page.widthIn;
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
          label ||= 'Comic page ' + number;
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
        g.rect(0, y, SCROLL_WIDTH, rows);
        g.clip();
        g.translate(0, y - top);
        paintBreak(g, options.breakArt, SCROLL_WIDTH, breakRows);
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
  const files: ZipFile[] = [];
  const slices: Slice[] = [];
  for await (const { canvas, label } of renderScrollStrips(studio, book, options, progress, scrollPlan(book, options))) {
    const file = 'images/' + String(slices.length + 1).padStart(4, '0') + '.png';
    files.push({ name: file, data: await encodePng(canvas) });
    slices.push({ file, width: canvas.width, height: canvas.height, alt: label });
  }
  const encoder = new TextEncoder();
  files.push({ name: 'index.html', data: encoder.encode(scrollReader(book.title, book.author, slices, options.background)) });
  files.push({ name: 'episode.json', data: encoder.encode(JSON.stringify({ title: book.title, author: book.author, slices }, null, 2)) });
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
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
  const plan = scrollPlan(book, options);
  if (!Number.isSafeInteger(plan.total) || plan.total < 1 || plan.total > 0x7fffffff) {
    throw new Error('The selected page range is too tall for a PNG. Choose a smaller range.');
  }

  const header = new Uint8Array(13);
  const dimensions = new DataView(header.buffer);
  dimensions.setUint32(0, SCROLL_WIDTH);
  dimensions.setUint32(4, plan.total);
  header.set([8, 6], 8); // 8-bit RGBA
  const chunks: BlobPart[] = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk('IHDR', header),
  ];

  const deflate = new CompressionStream('deflate');
  const strips = renderScrollStrips(studio, book, options, progress, plan);
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
