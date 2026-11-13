import type { Page, TextFrame } from '../doc/model';
import { letterFont } from './fonts';

/**
 * Type frames: set text for illustrated novels, picture books, poems and single-image stories.
 * A frame flows paragraphs into one to three columns with real typographic controls: size,
 * leading, tracking, alignment (justified too), first-line indent, paragraph space, drop caps,
 * capitals and small capitals. Layout is a pure function of a measuring callback, so it can be
 * tested without a canvas; drawing goes through the shared page renderer, so exports match.
 */

/** Typeface choices beyond the bundled comic fonts: the reader's system faces of each kind. */
export const TYPE_FACES: { id: string; label: string; css: string }[] = [
  { id: 'serif', label: 'Serif (book text)', css: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  { id: 'book', label: 'Book (Georgia, Times)', css: 'Georgia, "Times New Roman", Times, serif' },
  { id: 'sans', label: 'Sans serif', css: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' },
  { id: 'mono', label: 'Typewriter', css: '"Courier Prime", "Courier New", Courier, ui-monospace, monospace' },
];

export const DEFAULT_TYPE: Omit<TextFrame, 'id' | 'x' | 'y' | 'w' | 'h' | 'text'> = {
  font: 'serif', size: 11, leading: 1.4, tracking: 0, align: 'justify', valign: 'top', columns: 1, gutter: 0.25,
  indent: 1.5, paraSpace: 0, dropCap: 0, caps: 'none', bold: false, italic: false, color: '#1d1e22', background: null, padding: 0,
};

/** One-click styles for common page designs. */
export const TYPE_PRESETS: { label: string; style: Partial<TextFrame> }[] = [
  { label: 'Novel body', style: { font: 'serif', size: 11, leading: 1.45, tracking: 0, align: 'justify', indent: 1.5, paraSpace: 0, dropCap: 0, caps: 'none', bold: false, italic: false } },
  { label: 'Chapter opening', style: { font: 'serif', size: 12, leading: 1.5, align: 'justify', indent: 0, paraSpace: 0.6, dropCap: 3, caps: 'none' } },
  { label: 'Title', style: { font: 'serif', size: 36, leading: 1.1, tracking: 40, align: 'center', valign: 'middle', indent: 0, paraSpace: 0.2, dropCap: 0, caps: 'all', bold: false } },
  { label: 'Poem', style: { font: 'book', size: 12, leading: 1.6, align: 'left', indent: 0, paraSpace: 0.8, dropCap: 0, caps: 'none', italic: false } },
  { label: 'Pull quote', style: { font: 'serif', size: 18, leading: 1.25, align: 'center', valign: 'middle', indent: 0, paraSpace: 0.4, italic: true, caps: 'none' } },
  { label: 'Picture-book', style: { font: 'sans', size: 16, leading: 1.45, align: 'left', indent: 0, paraSpace: 0.8, dropCap: 0, caps: 'none' } },
];

export interface SetWord { text: string; x: number; size: number }
export interface SetLine { x: number; y: number; words: SetWord[] }
export interface TypeLayout { lines: SetLine[]; drop: { text: string; x: number; y: number; size: number } | null; overset: boolean }

/** Measure `text` at `size` px (tracking included). */
export type Measure = (text: string, size: number) => number;

/** Lay out a frame in pixels (`scale` px per inch). Lines' y is the baseline. */
export function layoutType(f: TextFrame, scale: number, measure: Measure): TypeLayout {
  const pad = (f.padding ?? 0) * scale;
  const cols = Math.max(1, Math.min(3, Math.round(f.columns)));
  const gutter = f.gutter * scale;
  const innerW = f.w * scale - pad * 2, innerH = f.h * scale - pad * 2;
  const colW = (innerW - gutter * (cols - 1)) / cols;
  const fontPx = f.size / 72 * scale;
  const lineH = fontPx * f.leading;
  const small = f.caps === 'small';
  const wordSize = small ? fontPx * 0.82 : fontPx;
  const caps = (s: string) => (f.caps === 'none' ? s : s.toUpperCase());
  const space = measure(' ', wordSize);
  const lines: SetLine[] = [];
  let drop: TypeLayout['drop'] = null;
  if (colW <= 1 || innerH <= 1 || fontPx <= 0) return { lines, drop, overset: !!f.text.trim() };

  let col = 0;
  let y = fontPx; // first baseline
  const colX = () => pad + col * (colW + gutter);
  /** Move to the next baseline, flowing into the next column; false when the frame is full. */
  const fits = (): boolean => {
    if (y <= innerH + 0.5) return true;
    if (col + 1 >= cols) return false;
    col++;
    y = fontPx;
    return true;
  };
  const nextLine = (): boolean => { y += lineH; return fits(); };

  const paragraphs = f.text.replace(/\r/g, '').split('\n');
  let overset = false;
  let dropLines = 0, dropW = 0;
  for (const [pi, para] of paragraphs.entries()) {
    let words = caps(para).split(/\s+/).filter(Boolean);
    if (!words.length) {
      // an empty line: a blank line of space
      if (pi > 0 && !nextLine()) { overset = true; break; }
      continue;
    }
    if (pi === 0 && f.dropCap >= 2 && words[0]!.length > 0) {
      const letter = words[0]![0]!;
      const size = lineH * (f.dropCap - 1) + fontPx * 0.92;
      dropW = measure(letter, size) + fontPx * 0.25;
      dropLines = f.dropCap;
      drop = { text: letter, x: colX(), y: y + lineH * (f.dropCap - 1), size };
      words = [words[0]!.slice(1), ...words.slice(1)].filter(Boolean);
    }
    let first = true;
    let lineIndex = 0;
    while (words.length) {
      const inDrop = pi === 0 && lineIndex < dropLines;
      const indent = (first && pi > 0 && f.indent > 0 && f.align !== 'center' ? f.indent * fontPx : 0) + (inDrop ? dropW : 0);
      const avail = colW - indent;
      const line: string[] = [];
      let width = 0;
      while (words.length) {
        const w = measure(words[0]!, wordSize);
        const next = line.length ? width + space + w : w;
        if (line.length && next > avail) break;
        line.push(words.shift()!);
        width = next;
      }
      const last = !words.length;
      const gaps = line.length - 1;
      const extra = avail - width;
      const x0 = colX() + indent + (f.align === 'right' ? extra : f.align === 'center' ? extra / 2 : 0);
      const gap = f.align === 'justify' && !last && gaps > 0 ? space + extra / gaps : space;
      let x = x0;
      const set: SetWord[] = line.map((text) => {
        const word = { text, x, size: wordSize };
        x += measure(text, wordSize) + gap;
        return word;
      });
      lines.push({ x: x0, y, words: set });
      first = false;
      lineIndex++;
      if (!nextLine()) { overset = words.length > 0 || pi < paragraphs.length - 1; break; }
    }
    if (overset) break;
    if (f.paraSpace > 0 && pi < paragraphs.length - 1) y += f.paraSpace * fontPx;
    if (!fits()) { overset = pi < paragraphs.length - 1; break; }
  }

  // vertical alignment for single-column frames: move the block within the frame
  if (cols === 1 && lines.length && f.valign !== 'top') {
    const used = lines.at(-1)!.y + lineH - fontPx - (lines[0]!.y - fontPx);
    const shift = Math.max(0, (innerH - used) * (f.valign === 'middle' ? 0.5 : 1));
    for (const l of lines) l.y += shift;
    if (drop) drop.y += shift;
  }
  return { lines, drop, overset };
}

/** The CSS font for a frame at `px` size. */
export function typeFont(f: Pick<TextFrame, 'font' | 'bold' | 'italic'>, px: number): string {
  const face = TYPE_FACES.find((t) => t.id === f.font);
  if (face) return `${f.italic ? 'italic ' : ''}${f.bold ? '700 ' : '400 '}${px}px ${face.css}`;
  return letterFont({ font: f.font, bold: f.bold, italic: f.italic }, px);
}

/** Draw every type frame on the page (scale px per inch, page origin at 0,0). */
export function drawTypeFrames(g: CanvasRenderingContext2D, page: Page, scale: number): void {
  for (const f of page.texts ?? []) drawTypeFrame(g, f, scale);
}

export function drawTypeFrame(g: CanvasRenderingContext2D, f: TextFrame, scale: number): TypeLayout {
  g.save();
  g.translate(f.x * scale, f.y * scale);
  if (f.rotation) {
    g.translate(f.w * scale / 2, f.h * scale / 2);
    g.rotate(f.rotation * Math.PI / 180);
    g.translate(-f.w * scale / 2, -f.h * scale / 2);
  }
  if (f.background) { g.fillStyle = f.background; g.fillRect(0, 0, f.w * scale, f.h * scale); }
  g.beginPath();
  g.rect(0, 0, f.w * scale, f.h * scale);
  g.clip();
  const ctx = g as CanvasRenderingContext2D & { letterSpacing?: string };
  const track = (size: number) => { if ('letterSpacing' in ctx) ctx.letterSpacing = `${f.tracking / 1000 * size}px`; };
  const measure: Measure = (text, size) => { g.font = typeFont(f, size); track(size); return g.measureText(text).width; };
  const layout = layoutType(f, scale, measure);
  g.fillStyle = f.color;
  g.textBaseline = 'alphabetic';
  if (layout.drop) {
    g.font = typeFont({ ...f, bold: f.bold }, layout.drop.size);
    track(layout.drop.size);
    g.fillText(layout.drop.text, layout.drop.x, layout.drop.y);
  }
  for (const line of layout.lines) for (const w of line.words) {
    g.font = typeFont(f, w.size);
    track(w.size);
    g.fillText(w.text, w.x, line.y);
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  g.restore();
  return layout;
}
