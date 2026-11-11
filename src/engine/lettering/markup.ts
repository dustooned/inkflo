// Vendored from 2Dope src/lettering/markup.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Per-word styling inside a caption's words, as light markup students can see and type:
 *   *bold*   _italic_   [#e02020]coloured words[/]
 * The Caption panel's B, I and colour buttons add these around the selected words. Portable: no DOM.
 */

export interface Run { text: string; bold: boolean; italic: boolean; color: string | null }
export interface MarkupState { bold: boolean; italic: boolean; colors: string[] }

const TOKEN = /\[#([0-9a-f]{6})\]|\[\/\]|\*|_/gi;

export const freshState = (): MarkupState => ({ bold: false, italic: false, colors: [] });

/** The words without markup (what is measured, counted and read aloud). */
export function stripMarkup(t: string): string { return t.replace(TOKEN, ''); }

/** Does this text use any markup? */
export function hasMarkup(t: string): boolean { TOKEN.lastIndex = 0; const r = TOKEN.test(t); TOKEN.lastIndex = 0; return r; }

/** Does it make any words bold (so measuring allows for the wider bold letters)? */
export function hasBold(t: string): boolean { return t.includes('*'); }

/**
 * Split one line into styled runs, starting from `state` and leaving it where the line ends (bold,
 * italic and colour carry on to the next line, as in the words the student typed).
 */
export function runsOf(line: string, state: MarkupState): Run[] {
  const out: Run[] = [];
  let at = 0;
  const push = (text: string) => {
    if (!text) return;
    const color = state.colors.at(-1) ?? null, last = out.at(-1);
    if (last && last.bold === state.bold && last.italic === state.italic && last.color === color) last.text += text;
    else out.push({ text, bold: state.bold, italic: state.italic, color });
  };
  for (const m of line.matchAll(TOKEN)) {
    push(line.slice(at, m.index));
    const tok = m[0];
    if (tok === '*') state.bold = !state.bold;
    else if (tok === '_') state.italic = !state.italic;
    else if (tok === '[/]') state.colors.pop();
    else state.colors.push(`#${m[1]!.toLowerCase()}`);
    at = m.index! + tok.length;
  }
  push(line.slice(at));
  return out;
}

/** Wrap part of a text in markup (the panel's B, I and colour buttons). Returns the text and the new selection. */
export function wrapMarkup(text: string, start: number, end: number, kind: 'bold' | 'italic' | { color: string }): { text: string; start: number; end: number } {
  const [open, close] = kind === 'bold' ? ['*', '*'] : kind === 'italic' ? ['_', '_'] : [`[${kind.color.toLowerCase()}]`, '[/]'];
  // a selection that starts or ends on spaces wraps just the words
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  if (start === end) return { text, start, end };
  return { text: text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end), start: start + open.length, end: end + open.length };
}
