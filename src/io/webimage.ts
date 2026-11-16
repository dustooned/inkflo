import type { Studio } from '../app/studio';
import { sheetOf, type Page } from '../doc/model';
import { lettersReady } from '../render/fonts';
import { loadMarks, markKeys } from '../render/marks';
import { renderPage } from '../render/page';
import { encodeImage, makeCanvas } from './canvasops';
import { clampQuality, DEFAULT_QUALITY, formatInfo, type WebFormat } from './webformat';

/** Phone-friendly default: wide enough for a sharp strip on a modern phone, small enough to post. */
export const WEB_WIDTH = 1600;
export const WEB_MIN = 200;
/** Browser canvases are safe up to about this many pixels on every platform we target. */
export const WEB_MAX_PIXELS = 32_000_000;

/** The pixel size a page exports at for a given width (height keeps the page's proportions). */
export function webSize(page: Pick<Page, 'widthIn' | 'heightIn'>, width: number): { width: number; height: number; tooLarge: boolean } {
  const w = Math.max(WEB_MIN, Math.round(width));
  const h = Math.max(1, Math.round(w * page.heightIn / page.widthIn));
  return { width: w, height: h, tooLarge: w > 16_384 || h > 16_384 || w * h > WEB_MAX_PIXELS };
}

/** One page as a PNG at `width` pixels, through the shared renderer (marks and lettering included). */
export async function exportWebImage(studio: Studio, page: Page, width: number, format: WebFormat = 'png', quality = DEFAULT_QUALITY): Promise<Blob> {
  const book = studio.book!;
  const size = webSize(page, width);
  if (size.tooLarge) throw new Error(`${size.width} × ${size.height} px is too large for the browser. Choose a smaller width.`);
  await lettersReady(page.balloons.map((l) => l.cap));
  await loadMarks(markKeys(book), (k) => studio.store.getAsset(k));
  const art = studio.ensureArt(page);
  const canvas = makeCanvas(size.width, size.height);
  try {
    await studio.residency.pin(art);
    const info = formatInfo(format);
    const g = canvas.getContext('2d')!;
    // JPG cannot be see-through: paint white first
    if (!info.alpha) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height); }
    renderPage(g, page, art, { scale: size.width / page.widthIn, printOnly: true, sheet: sheetOf(book) });
    return new Blob([await encodeImage(canvas, info.mime, info.lossy ? clampQuality(quality) : undefined) as BlobPart], { type: info.mime });
  } finally {
    studio.residency.unpin(art);
    canvas.width = canvas.height = 0;
  }
}
