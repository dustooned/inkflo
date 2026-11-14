import type { Studio } from '../app/studio';
import { sheetOf, type Page } from '../doc/model';
import { lettersReady } from '../render/fonts';
import { loadMarks, markKeys } from '../render/marks';
import { renderPage } from '../render/page';
import { encodePng, makeCanvas } from './canvasops';

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
export async function exportWebImage(studio: Studio, page: Page, width: number): Promise<Blob> {
  const book = studio.book!;
  const size = webSize(page, width);
  if (size.tooLarge) throw new Error(`${size.width} × ${size.height} px is too large for the browser. Choose a smaller width.`);
  await lettersReady(page.balloons.map((l) => l.cap));
  await loadMarks(markKeys(book), (k) => studio.store.getAsset(k));
  const art = studio.ensureArt(page);
  const canvas = makeCanvas(size.width, size.height);
  try {
    await studio.residency.pin(art);
    renderPage(canvas.getContext('2d')!, page, art, { scale: size.width / page.widthIn, printOnly: true, sheet: sheetOf(book) });
    return new Blob([await encodePng(canvas) as BlobPart], { type: 'image/png' });
  } finally {
    studio.residency.unpin(art);
    canvas.width = canvas.height = 0;
  }
}
