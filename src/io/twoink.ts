import type { Studio } from '../app/studio';
import { sheetOf, type Book, type Page } from '../doc/model';
import { crc32, writeZip, type ZipFile } from '../engine/io/zip';
import { lettersReady } from '../render/fonts';
import { renderPage } from '../render/page';
import { encodePng, makeCanvas } from './canvasops';
import type { Progress } from './exports';
import { pagesIn, type PageRange } from './printexport';

export type InkPair = [string, string];
type Output = 'light' | 'dark' | 'proof';

/** Coverage curves: ink 1 carries the highlights and midtones, ink 2 builds the shadows. */
export function coverage(darkness: number): [number, number] {
  return [Math.min(1, 1.5 * darkness), Math.max(0, (darkness - 0.25) / 0.75)];
}

export function inkMix(inks: InkPair, a: number, b: number): [number, number, number] {
  const channel = (i: number) => {
    const n = 1 + 2 * i;
    const light = parseInt(inks[0].slice(n, n + 2), 16) / 255;
    const dark = parseInt(inks[1].slice(n, n + 2), 16) / 255;
    return Math.round(255 * (1 - a * (1 - light)) * (1 - b * (1 - dark)));
  };
  return [channel(0), channel(1), channel(2)];
}

/** Set PNG pixels per metre, replacing the canvas encoder's default density if present. */
export function pngAtDpi(png: Uint8Array, dpi: number): Uint8Array {
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  const density = Math.round(dpi / 0.0254);
  view.setUint32(8, density);
  view.setUint32(12, density);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const input = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let start = 33;
  let end = start;
  for (let i = start; i + 12 <= png.length;) {
    const size = input.getUint32(i) + 12;
    if (input.getUint32(i + 4) === 0x70485973) {
      start = i;
      end = i + size;
      break;
    }
    if (input.getUint32(i + 4) === 0x49444154) break;
    i += size;
  }
  const bytes = new Uint8Array(png.length + chunk.length - (end - start));
  bytes.set(png.subarray(0, start));
  bytes.set(chunk, start);
  bytes.set(png.subarray(end), start + chunk.length);
  return bytes;
}

function recolour(source: ImageData, target: ImageData, inks: InkPair, kind: Output): void {
  // Each luminosity maps to one pair of plate densities and one proof colour.
  const lookup = Array.from({ length: 256 }, (_, i) => {
    const [a, b] = coverage(1 - i / 255);
    if (kind === 'proof') return inkMix(inks, a, b);
    const grey = Math.round(255 * (1 - (kind === 'light' ? a : b)));
    return [grey, grey, grey];
  });
  const { data } = target;
  for (let i = 0; i < data.length; i += 4) {
    const s = source.data;
    const grey = 0.2126 * s[i]! + 0.7152 * s[i + 1]! + 0.0722 * s[i + 2]!;
    const colour = lookup[Math.round(255 - (255 - grey) * s[i + 3]! / 255)]!;
    data[i] = colour[0]!;
    data[i + 1] = colour[1]!;
    data[i + 2] = colour[2]!;
    data[i + 3] = 255;
  }
}

async function renderSource(studio: Studio, book: Book, page: Page, dpi: number): Promise<HTMLCanvasElement> {
  const art = studio.ensureArt(page);
  try {
    await studio.residency.pin(art);
    await lettersReady(page.balloons.map((l) => l.cap));
    const c = makeCanvas(Math.max(1, Math.round(page.widthIn * dpi)), Math.max(1, Math.round(page.heightIn * dpi)));
    renderPage(c.getContext('2d', { willReadFrequently: true })!, page, art, { scale: dpi, printOnly: true, whitePaper: true, sheet: sheetOf(book) });
    return c;
  } finally {
    studio.residency.unpin(art);
  }
}

export async function twoInkProof(studio: Studio, page: Page, inks: InkPair): Promise<HTMLCanvasElement> {
  const c = await renderSource(studio, studio.book!, page, Math.min(72, 540 / Math.max(page.widthIn, page.heightIn)));
  const g = c.getContext('2d')!;
  const source = g.getImageData(0, 0, c.width, c.height);
  recolour(source, source, inks, 'proof');
  g.putImageData(source, 0, 0);
  return c;
}

export async function exportTwoInks(studio: Studio, inks: InkPair, dpi: number, range: PageRange, progress: Progress): Promise<Blob> {
  const book = studio.book!;
  const pages = pagesIn(book, range);
  if (!pages.length) throw new Error('Choose at least one page.');
  const files: ZipFile[] = [];
  const sizes: string[] = [];
  for (const page of pages) {
    const n = book.pages.indexOf(page) + 1;
    const stem = 'page-' + String(n).padStart(3, '0') + '.png';
    progress('Separating page ' + n + '…');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const c = await renderSource(studio, book, page, dpi);
    const g = c.getContext('2d')!;
    const source = g.getImageData(0, 0, c.width, c.height);
    const target = g.createImageData(c.width, c.height);
    for (const [kind, folder] of [['light', 'plate-1'], ['dark', 'plate-2'], ['proof', 'proof']] as const) {
      recolour(source, target, inks, kind);
      g.putImageData(target, 0, 0);
      files.push({ name: folder + '/' + stem, data: pngAtDpi(await encodePng(c), dpi) });
    }
    sizes.push(stem + '  ' + page.widthIn + ' × ' + page.heightIn + ' in  (' + c.width + ' × ' + c.height + ' px)');
    c.width = c.height = 0;
  }
  const notes = ['inkflo two-ink separations', 'Plate 1: ' + inks[0] + ' (highlights and midtones)', 'Plate 2: ' + inks[1] + ' (shadows)',
    'Plate images use black for full ink, white for paper and grey for partial coverage. The proof simulates overprinting.',
    'Continuous-tone, trim-size PNGs at ' + dpi + ' dpi. Use your printer’s screening and registration settings.', '', ...sizes];
  files.push({ name: 'print-notes.txt', data: new TextEncoder().encode(notes.join('\n')) });
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}
