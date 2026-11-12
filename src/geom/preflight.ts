import { PT, sheetOf, strokesOfType, type Book, type Letter, type Page } from '../doc/model';
import type { Panel } from './carve';
import { printOf } from './printkinds';
import { letterForLine, parseLine, readingOrderIssues } from './lettering';
import { readabilityAll } from './readability';
import { centreCrossing, revealIssues } from './composition';
import { imageDpi } from './placement';

/** Print preflight that reads like a checklist (PLAN §3 Print). Pure apart from `box`. */

export type Level = 'ok' | 'warn' | 'info';
export interface Check {
  level: Level;
  text: string;
}

/** Defaults (US comic book); a book's own are in `book.print` (geom/printkinds.ts). */
export const SAFE_IN = 0.25;
export const BLEED_IN = 0.125;

/** A letter's bounding box in points. Injected so tests can run without a canvas to measure on. */
export type LetterBox = (l: Letter) => { x0: number; y0: number; x1: number; y1: number };

export function preflightPage(book: Book, page: Page, panels: Panel[], box: LetterBox): Check[] {
  const out: Check[] = [];
  const sheet = sheetOf(book);
  out.push(book.dpi >= 300 ? { level: 'ok', text: `Line art at ${book.dpi} dpi.` } : { level: 'warn', text: `Art is ${book.dpi} dpi; print wants 300 or more.` });
  out.push(panels.length > 1 ? { level: 'ok', text: `${panels.length} panels.` } : { level: 'info', text: 'One panel (a splash page).' });
  const ink = strokesOfType(page, 'ink').filter((s) => !s.erase).length;
  const art = page.groups.filter((g) => g.visible).flatMap((g) => g.layers.filter((l) => l.visible && l.prints && l.image));
  if (!ink && !art.length) out.push({ level: 'warn', text: 'No ink on this page yet.' });
  if (ink) out.push({ level: 'ok', text: `${ink} ink strokes.` });
  for (const layer of art) {
    const im = layer.image!;
    const dpi = imageDpi(im);
    const min = Math.min(300, book.dpi);
    out.push({ level: dpi < min ? 'warn' : 'ok', text: layer.name + ' is ' + dpi + ' dpi at its placed size.' });
  }
  if (strokesOfType(page, 'pencil').length) out.push({ level: 'info', text: 'Pencil stays out of print and export.' });
  // readability at every output (print, digest, phone)
  const levels = page.balloons.map((l) => readabilityAll(l, sheet));
  const bad = levels.filter((r) => r.level === 'bad').length;
  const risk = levels.filter((r) => r.level === 'risk').length;
  if (bad) out.push({ level: 'warn', text: `${bad} balloon${bad === 1 ? '' : 's'} won't read well at some output size.` });
  if (risk) out.push({ level: 'warn', text: `${risk} balloon${risk === 1 ? '' : 's'} at risk at some output size.` });
  if (page.balloons.length && !bad && !risk) out.push({ level: 'ok', text: 'All lettering reads well at its output sizes.' });
  const safeIn = printOf(book).safe;
  const safe = safeIn * PT;
  const W = page.widthIn * PT;
  const H = page.heightIn * PT;
  const unsafe = page.balloons.filter((l) => {
    const b = box(l);
    return b.x0 < safe || b.y0 < safe || b.x1 > W - safe || b.y1 > H - safe;
  });
  if (unsafe.length) out.push({ level: 'warn', text: `${unsafe.length} balloon${unsafe.length === 1 ? '' : 's'} outside the safe area (${safeIn}″ in from the trim); lettering may be cut.` });
  else if (page.balloons.length) out.push({ level: 'ok', text: 'All lettering inside the safe area.' });
  const unlettered = page.beats.reduce((n, b) => n + b.lines.filter((raw, i) => parseLine(raw).text && !b.dialogue?.[i]?.omit && !letterForLine(page, b, i)).length, 0);
  if (unlettered) out.push({ level: 'warn', text: `${unlettered} script line${unlettered === 1 ? '' : 's'} not lettered.` });
  const order = readingOrderIssues(page, panels);
  if (order.length) out.push({ level: 'warn', text: `${order.length} balloon${order.length === 1 ? '' : 's'} out of reading order.` });
  if (centreCrossing(page)) out.push({ level: 'info', text: 'A gutter crossing sits at the centre of the page.' });
  for (const issue of revealIssues(book, page, panels)) out.push({ level: 'warn', text: issue.text });
  return out;
}
