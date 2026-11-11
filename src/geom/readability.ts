import { PT, type Letter, type LetterSheet } from '../doc/model';
import type { CaptionSpec } from '../engine/lettering/spec';

/**
 * Readable lettering (EXPLORE-DESK-UI §18). Every check is at the real output size: print in
 * points, screens in pixels. Thresholds come from the book's style sheet. Pure, so it is tested.
 */

export type Level = 'good' | 'risk' | 'bad';
export type FixId = 'enlarge' | 'thicken' | 'backing' | 'heavier' | 'contrast';

export interface Issue {
  level: Exclude<Level, 'good'>;
  text: string;
  fix?: FixId;
}

export interface Readability {
  level: Level;
  /** Type size at print, pt. */
  pt: number;
  issues: Issue[];
}

/** An output the page will be seen at: a print size (pt scale factor) or a screen width. */
export interface Target {
  name: string;
  /** Printed: size multiplier relative to the trim (digest reduction < 1). */
  factor?: number;
  /** Screen: page width in px. Text is then judged in px (16 good, 12 at risk). */
  widthPx?: number;
}

export const TARGETS: Target[] = [
  { name: 'Print', factor: 1 },
  { name: 'Digest (5 × 7.5 in)', factor: 5 / 6.625 },
  { name: 'Phone (800 px wide)', widthPx: 800 },
];

/** Thinnest line a press holds reliably, pt. */
export const MIN_LINE_PT = 0.25;

/** Size steps a balloon's scale snaps to (× the house size). */
export const SCALE_STEPS = [0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];

export function basePt(c: CaptionSpec, sheet: LetterSheet): number {
  return sheet.sizes[c.size];
}

export function letterPt(c: CaptionSpec, sheet: LetterSheet): number {
  return basePt(c, sheet) * (c.scale ?? 1);
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const worst = (a: Level, b: Level): Level => (a === 'bad' || b === 'bad' ? 'bad' : a === 'risk' || b === 'risk' ? 'risk' : 'good');

/** How readable a letter is at one target (default: print at trim size). */
export function readability(l: Letter, sheet: LetterSheet, target: Target = TARGETS[0]!): Readability {
  const c = l.cap;
  const pt = letterPt(c, sheet);
  const issues: Issue[] = [];
  // type size
  if (!l.smallOk) {
    if (target.widthPx) {
      const px = (pt / PT) * (target.widthPx / 6.625);
      if (px < 12) issues.push({ level: 'bad', text: `${px.toFixed(0)} px on a ${target.name.toLowerCase()} screen; below 12 px won't read.`, fix: 'enlarge' });
      else if (px < 16) issues.push({ level: 'risk', text: `${px.toFixed(0)} px on ${target.name.toLowerCase()}; 16 px or more reads comfortably.`, fix: 'enlarge' });
    } else {
      const at = pt * (target.factor ?? 1);
      const where = target.factor && target.factor !== 1 ? ` at ${target.name.toLowerCase()}` : '';
      if (at < sheet.minPt) issues.push({ level: 'bad', text: `${at.toFixed(1)} pt${where}; below ${sheet.minPt} pt won't read well.`, fix: 'enlarge' });
      else if (at < sheet.warnPt) issues.push({ level: 'risk', text: `${at.toFixed(1)} pt${where}; ${sheet.warnPt} pt or more is safer.`, fix: 'enlarge' });
    }
  }
  // the balloon's border
  if (c.style !== 'sfx' && c.inkWidth > 0) {
    const line = c.inkWidth * pt * (target.factor ?? 1);
    if (line < MIN_LINE_PT) issues.push({ level: 'risk', text: `Balloon border ${line.toFixed(2)} pt; thinner than ${MIN_LINE_PT} pt may not print.`, fix: 'thicken' });
  }
  // contrast
  if (c.style === 'sfx') {
    if (!c.textOutline || c.textOutlineWidth <= 0) issues.push({ level: 'risk', text: 'Sound effect without an outline can vanish into the art.', fix: 'backing' });
  } else {
    const ratio = contrast(c.textColor, c.fill);
    if (ratio < 3) issues.push({ level: 'bad', text: `Text and balloon contrast ${ratio.toFixed(1)}:1; needs at least 4.5:1.`, fix: 'contrast' });
    else if (ratio < 4.5) issues.push({ level: 'risk', text: `Text and balloon contrast ${ratio.toFixed(1)}:1; 4.5:1 or more is safer.`, fix: 'contrast' });
  }
  // light faces at small sizes
  if (!c.bold && pt * (target.factor ?? 1) < sheet.warnPt + 1 && /indie-flower|architects-daughter/.test(c.font)) {
    issues.push({ level: 'risk', text: 'A light hand-lettered font at a small size; try bold or a heavier face.', fix: 'heavier' });
  }
  return { level: issues.reduce<Level>((a, i) => worst(a, i.level), 'good'), pt, issues };
}

/** The outputs a book is checked at: print always, digest and phone when the style sheet asks. */
export function targetsFor(sheet: LetterSheet): Target[] {
  return TARGETS.filter((t) => t.name === 'Print' || (sheet.checks ?? []).includes(t.name));
}

/** The worst result across the book's targets. */
export function readabilityAll(l: Letter, sheet: LetterSheet, targets: Target[] = targetsFor(sheet)): { level: Level; byTarget: { target: Target; r: Readability }[] } {
  const byTarget = targets.map((target) => ({ target, r: readability(l, sheet, target) }));
  return { level: byTarget.reduce<Level>((a, t) => worst(a, t.r.level), 'good'), byTarget };
}

/**
 * Snap a scale to the nearest step, and (with Keep readable) never below the minimum size.
 * `free` (Alt held) skips the steps but still keeps the minimum.
 */
export function snapScale(c: CaptionSpec, sheet: LetterSheet, scale: number, keepReadable: boolean, free = false): number {
  let s = free ? scale : SCALE_STEPS.reduce((best, x) => (Math.abs(x - scale) < Math.abs(best - scale) ? x : best), SCALE_STEPS[0]!);
  if (keepReadable) s = Math.max(s, sheet.minPt / basePt(c, sheet));
  return Math.max(0.5, Math.min(3, Number(s.toFixed(3))));
}

/** One-click fixes. Each returns a new caption; the letter's own `smallOk` is left alone. */
export function applyFix(c: CaptionSpec, sheet: LetterSheet, fix: FixId): CaptionSpec {
  const out: CaptionSpec = { ...c };
  switch (fix) {
    case 'enlarge':
      out.scale = Math.max(c.scale ?? 1, Math.min(3, sheet.warnPt / basePt(c, sheet)));
      break;
    case 'thicken':
      out.inkWidth = Math.min(0.6, Math.max(c.inkWidth, (MIN_LINE_PT * 1.4) / letterPt(c, sheet)));
      break;
    case 'backing':
      out.textOutline = c.textOutline ?? (contrast(c.textColor, '#111111') > contrast(c.textColor, '#ffffff') ? '#111111' : '#ffffff');
      out.textOutlineWidth = Math.max(c.textOutlineWidth, 0.18);
      break;
    case 'heavier':
      out.bold = true;
      break;
    case 'contrast':
      out.textColor = contrast('#111111', c.fill) >= contrast('#ffffff', c.fill) ? '#111111' : '#ffffff';
      break;
  }
  return out;
}

/** Every fix the guard would apply to a letter at print (for "Fix all on this page"). */
export function safeFixes(l: Letter, sheet: LetterSheet): FixId[] {
  return [...new Set(readability(l, sheet).issues.map((i) => i.fix).filter((f): f is FixId => !!f))];
}
