import { newId, PT, sheetOf, type Beat, type Book, type DialogueLine, type Letter, type LetterSheet, type Page, type Pt } from '../doc/model';
import { BALLOON_STYLES, defaultCaption, type BalloonStyle, type CaptionSpec } from '../engine/lettering/spec';
import { applyStyle, captureStyle, type CaptionStyle } from '../engine/lettering/styles';
import { panelAt, pointInPoly, type Panel } from './carve';
import { anchorFor } from './groups';

/**
 * Lettering that follows the script (EXPLORE-DESK-UI §6, §16): script lines become letters,
 * edits flow both ways, speakers carry character styles. Positions are in points. Pure.
 */

export interface ParsedLine {
  speaker: string | null;
  text: string;
  /** The balloon a line wants by default. */
  style: BalloonStyle;
}

const SCRIPT_LINE = /^\s*([A-Za-z][\w .'-]{0,30}?)\s*(\((?:[^)]{1,20})\))?\s*:\s*([\s\S]*)$/;

export function dialogueText(lines: string[]): string {
  return lines.map((line) => line.replaceAll('\\', '\\\\').replaceAll('\n', '\\n')).join('\n');
}

export function linesFromDialogueText(text: string): string[] {
  return text.split('\n').map((line) => line.trim().replace(/\\([n\\])/g, (_, ch: string) => ch === 'n' ? '\n' : '\\')).filter(Boolean);
}

/** "MAYA: Too late." → speaker MAYA; "CAPTION: Midnight." → a caption box; "SFX: KRAK" → a sound effect. */
export function parseLine(line: string): ParsedLine {
  const m = SCRIPT_LINE.exec(line);
  if (!m) return { speaker: null, text: line.trim(), style: 'speech' };
  const who = m[1]!.trim();
  const how = (m[2] ?? '').toLowerCase();
  const text = m[3]!.trim();
  const key = who.toUpperCase();
  if (key === 'CAPTION' || key === 'NARRATION' || key === 'CAP') return { speaker: null, text, style: 'box' };
  if (key === 'SFX' || key === 'FX') return { speaker: null, text, style: 'sfx' };
  // "MAYA (whisper): …", "(shout)", "(thought)", "(radio)"
  const style: BalloonStyle = how.includes('whisper') ? 'whisper' : how.includes('shout') ? 'shout' : how.includes('thought') || how.includes('think') ? 'thought' : 'speech';
  return { speaker: who, text, style };
}

/** The script line for a letter (inverse of parseLine). */
export function lineFor(l: Letter): string {
  const t = l.cap.text;
  if (l.cap.style === 'box') return `CAPTION: ${t}`;
  if (l.cap.style === 'sfx') return `SFX: ${t}`;
  if (!l.speaker) return t;
  const how = l.cap.style === 'whisper' || l.cap.style === 'shout' || l.cap.style === 'thought' ? ` (${l.cap.style})` : '';
  return `${l.speaker}${how}: ${t}`;
}

export const speakerKey = (s: string) => s.trim().toUpperCase();

/** The beat whose panel this is: beats map to panels in reading order. */
export function beatForPanel(page: Page, panel: Panel | null): Beat | null {
  if (!panel) return null;
  return page.beats[panel.index] ?? null;
}

/** The next script line of a beat that no letter uses yet. */
export function nextFreeLine(page: Page, beat: Beat): number | null {
  for (let i = 0; i < beat.lines.length; i++) if (parseLine(beat.lines[i]!).text && !beat.dialogue?.[i]?.omit && !letterForLine(page, beat, i)) return i;
  return null;
}

export function sourceIndex(beat: Beat, src: NonNullable<Letter['src']>): number {
  return src.lineId === undefined ? src.line : beat.dialogue?.findIndex((line) => line.id === src.lineId) ?? -1;
}

export function sourceFor(beat: Beat, index: number): NonNullable<Letter['src']> {
  const lineId = beat.dialogue?.[index]?.id;
  return { beat: beat.id, line: index, ...(lineId ? { lineId } : {}) };
}

export function letterForLine(page: Page, beat: Beat, index: number): Letter | undefined {
  return page.balloons.find((l) => l.src?.beat === beat.id && sourceIndex(beat, l.src) === index);
}

export function bindDialogue(page: Page, beat: Beat): DialogueLine[] {
  const lines = beat.dialogue ??= beat.lines.map(() => ({ id: newId('dl') }));
  for (const l of page.balloons) {
    if (l.src?.beat === beat.id && !l.src.lineId) {
      const id = lines[l.src.line]?.id;
      if (id) l.src = { ...l.src, lineId: id };
    }
  }
  return lines;
}

/** Bulk edits match unchanged lines first, then treat remaining rows in order as edits. */
export function replaceDialogue(page: Page, beat: Beat, text: string[]): void {
  if (beat.lines.length === text.length && beat.lines.every((line, i) => line === text[i])) return;
  const meta = bindDialogue(page, beat);
  const byText = new Map<string, number[]>();
  beat.lines.forEach((line, i) => {
    const entries = byText.get(line) ?? [];
    entries.push(i);
    byText.set(line, entries);
  });
  const matches = text.map((line) => byText.get(line)?.shift());
  const used = new Set(matches);
  const remaining = meta.filter((_, i) => !used.has(i));
  beat.lines = text;
  beat.dialogue = matches.map((i) => i === undefined ? remaining.shift() ?? { id: newId('dl') } : meta[i]!);
}

export function dialoguePanel(page: Page, panels: Panel[], beat: Beat, index: number): Panel | null {
  const anchor = beat.dialogue?.[index]?.panel;
  if (anchor) {
    const found = panelAt(panels, { x: anchor.x * page.widthIn, y: anchor.y * page.heightIn });
    if (found) return found;
    // A cut can land exactly on an anchor; resolve it to the closest panel.
    const distance = (p: Panel) => Math.hypot(p.centroid.x / page.widthIn - anchor.x, p.centroid.y / page.heightIn - anchor.y);
    return panels.reduce<Panel | null>((best, p) => !best || distance(p) < distance(best) ? p : best, null);
  }
  return panels[page.beats.indexOf(beat)] ?? null;
}

export function nextPanelLine(page: Page, panels: Panel[], panel: Panel | null, ignore?: Letter): { beat: Beat; index: number } | undefined {
  if (!panel) return;
  for (const beat of page.beats) {
    for (let index = 0; index < beat.lines.length; index++) {
      if (!parseLine(beat.lines[index]!).text || beat.dialogue?.[index]?.omit || dialoguePanel(page, panels, beat, index) !== panel) continue;
      const current = letterForLine(page, beat, index);
      if (!current || current === ignore) return { beat, index };
    }
  }
}

/** A character style for a speaker, if the book has one. */
export function characterStyle(sheet: LetterSheet, speaker: string | undefined): CaptionStyle | null {
  return speaker ? (sheet.characters[speakerKey(speaker)] ?? null) : null;
}

/** Save a letter's look as its speaker's character style. */
export function withCharacterStyle(sheet: LetterSheet, speaker: string, cap: CaptionSpec): LetterSheet {
  const key = speakerKey(speaker);
  return { ...sheet, characters: { ...sheet.characters, [key]: captureStyle(cap, `char-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, key) } };
}

/**
 * A new letter at `at` (pt). Its words come from the script line when one is given; its look
 * from the speaker's character style, else the house font. Speech balloons get a tail pointing
 * down and a little left, toward where a speaker usually is.
 */
export function newLetter(book: Pick<Book, 'lettering'>, at: Pt, style: BalloonStyle, line?: { beat: Beat; index: number }): Letter {
  const sheet = sheetOf(book);
  let text = style === 'sfx' ? 'KRAK!' : style === 'box' ? 'Meanwhile…' : '…';
  let speaker: string | undefined;
  let kind = style;
  if (line) {
    const parsed = parseLine(line.beat.lines[line.index] ?? '');
    text = parsed.text;
    speaker = parsed.speaker ?? undefined;
    // the line decides the balloon unless the tool asked for a box or SFX on purpose
    if (style === 'speech') kind = parsed.style;
  }
  let cap = defaultCaption(at.x, at.y, kind);
  cap.text = text;
  if (kind !== 'sfx') cap.font = sheet.font;
  cap.tails = kind === 'sfx' || kind === 'box' ? [] : [{ x: at.x - 18, y: at.y + 60, join: kind === 'thought' ? 'bubbles' : kind === 'whisper' ? 'seam' : 'merged', width: 1.2 }];
  const st = characterStyle(sheet, speaker);
  if (st && kind !== 'sfx' && kind !== 'box') cap = applyStyle({ ...cap, style: kind }, st);
  const preset = line && line.beat.dialogue?.[line.index]?.preset;
  if (preset && sheet.presets?.[preset]) {
    cap = applyStyle(cap, sheet.presets[preset]!);
    if (cap.style === 'box') cap.tails = [];
  }
  const l: Letter = { id: newId('lt'), cap };
  if (line) l.src = sourceFor(line.beat, line.index);
  if (speaker) l.speaker = speaker;
  return l;
}

/** After script edits: linked letters take their line's words and speaker. Returns true when anything changed. */
export function syncLettersFromScript(page: Page): boolean {
  let changed = false;
  const beats = new Map(page.beats.map((b) => [b.id, b]));
  for (const l of page.balloons) {
    if (!l.src) continue;
    const beat = beats.get(l.src.beat);
    const i = beat ? sourceIndex(beat, l.src) : -1;
    const raw = beat?.lines[i];
    if (raw === undefined) continue;
    if (l.src.line !== i) {
      l.src.line = i;
      changed = true;
    }
    const p = parseLine(raw);
    if (l.cap.text !== p.text) {
      l.cap = { ...l.cap, text: p.text };
      changed = true;
    }
    const speaker = p.speaker ?? undefined;
    if (l.speaker !== speaker) {
      if (speaker) l.speaker = speaker;
      else delete l.speaker;
      changed = true;
    }
  }
  return changed;
}

/** After a lettering edit: the linked script line takes the letter's words. */
export function syncScriptFromLetter(page: Page, l: Letter): boolean {
  if (!l.src) return false;
  const beat = page.beats.find((b) => b.id === l.src!.beat);
  if (!beat) return false;
  const i = sourceIndex(beat, l.src);
  const old = beat.lines[i];
  if (old === undefined) return false;
  const parsed = parseLine(old);
  const sameSpeaker = (parsed.speaker ?? '') === (l.speaker ?? '');
  if (sameSpeaker && parsed.text === l.cap.text) return false;
  const colon = SCRIPT_LINE.test(old) ? old.indexOf(':') : -1;
  const next = sameSpeaker ? (colon < 0 ? l.cap.text : old.slice(0, colon + 1) + ' ' + l.cap.text) : lineFor(l);
  beat.lines[i] = next;
  return true;
}

/** Rename a speaker everywhere in the book: script lines, letters and their character style. */
export function renameSpeaker(book: Book, from: string, to: string): void {
  const a = speakerKey(from);
  const name = to.trim();
  if (!name) return;
  for (const page of book.pages) {
    for (const beat of page.beats) {
      beat.lines = beat.lines.map((line) => {
        const m = /^(\s*)([A-Za-z][\w .'-]{0,30}?)(\s*(?:\([^)]{1,20}\))?\s*:)/.exec(line);
        return m && speakerKey(m[2]!) === a ? `${m[1]}${name}${m[3]}${line.slice(m[0].length)}` : line;
      });
    }
    for (const l of page.balloons) if (l.speaker && speakerKey(l.speaker) === a) l.speaker = name;
  }
  const sheet = sheetOf(book);
  const st = sheet.characters[a];
  if (st) {
    const characters = { ...sheet.characters };
    delete characters[a];
    characters[speakerKey(name)] = sheet.presets?.[st.id] ? st : { ...st, name: speakerKey(name) };
    book.lettering = { ...sheet, characters };
  }
}

/** Every speaker named in the book's script, in order of first appearance. */
export function speakers(book: Book): string[] {
  const seen = new Map<string, string>();
  for (const page of book.pages) for (const beat of page.beats) for (const line of beat.lines) {
    const p = parseLine(line);
    if (p.speaker && !seen.has(speakerKey(p.speaker))) seen.set(speakerKey(p.speaker), p.speaker);
  }
  return [...seen.values()];
}

/** Keep a letter's centre on the page (pt). */
export function clampLetter(l: Letter, page: Page): void {
  l.cap = { ...l.cap, x: Math.max(0, Math.min(page.widthIn * PT, l.cap.x)), y: Math.max(0, Math.min(page.heightIn * PT, l.cap.y)) };
}

/** A letter's centre in inches (for panel lookups). */
export const centreIn = (l: Letter): Pt => ({ x: l.cap.x / PT, y: l.cap.y / PT });

function moveLetter(l: Letter, to: Pt): void {
  const dx = to.x - l.cap.x;
  const dy = to.y - l.cap.y;
  const shift = <T extends Pt>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
  l.cap = { ...shift(l.cap), tails: l.cap.tails.map(shift), ...(l.cap.links ? { links: l.cap.links.map(shift) } : {}) };
}

function starterPosition(panel: Panel, index: number, count: number): Pt {
  const { x0, x1, y0, y1 } = panel.bbox;
  const p = { x: (x0 + x1) / 2, y: y0 + (y1 - y0) * (0.23 + 0.58 * index / Math.max(1, count)) };
  const inside = pointInPoly(p, panel.pts) ? p : anchorFor(panel);
  return { x: inside.x * PT, y: inside.y * PT };
}

function availablePosition(page: Page, panels: Panel[], panel: Panel, index: number, count: number, skip?: Letter): Pt {
  const preferred = starterPosition(panel, index, count);
  const neighbours = page.balloons.filter((l) => l !== skip && panelAt(panels, centreIn(l)) === panel);
  const clearance = (p: Pt) => neighbours.reduce((d, l) => Math.min(d, Math.hypot(p.x - l.cap.x, p.y - l.cap.y)), Infinity);
  const minGap = Math.min(24, (panel.bbox.y1 - panel.bbox.y0) * PT * 0.13);
  if (clearance(preferred) >= minGap) return preferred;
  return Array.from({ length: 7 }, (_, i) => starterPosition(panel, i, 7))
    .reduce((best, p) => clearance(p) > clearance(best) ? p : best, preferred);
}

/** Apply text updates, clean up removed lines, and optionally place unlettered dialogue. */
export function reconcileDialogue(book: Book, page: Page, panels: Panel[], create = !!page.autoLetter): void {
  const beats = new Map(page.beats.map((b) => [b.id, b]));
  const ids = new Map<string, Map<number, Letter>>();
  page.balloons = page.balloons.filter((l) => {
    if (!l.src) return true;
    const beat = beats.get(l.src.beat);
    const i = beat ? sourceIndex(beat, l.src) : -1;
    if (!beat || beat.lines[i] === undefined || !parseLine(beat.lines[i]!).text) {
      if (l.generated) return false;
      delete l.src;
      return true;
    }
    const indexed = ids.get(beat.id) ?? new Map();
    if (!indexed.has(i)) indexed.set(i, l);
    ids.set(beat.id, indexed);
    return true;
  });
  syncLettersFromScript(page);
  const targets = new Map<Panel, { beat: Beat; index: number }[]>();
  for (const beat of page.beats) {
    beat.lines.forEach((line, index) => {
      if (!parseLine(line).text || beat.dialogue?.[index]?.omit) return;
      const panel = dialoguePanel(page, panels, beat, index);
      if (!panel) return;
      const list = targets.get(panel) ?? [];
      list.push({ beat, index });
      targets.set(panel, list);
    });
  }
  for (const [panel, list] of targets) list.forEach(({ beat, index }, slot) => {
    const l = ids.get(beat.id)?.get(index);
    if (l) {
      if (l.generated && panelAt(panels, centreIn(l)) !== panel) moveLetter(l, availablePosition(page, panels, panel, slot, list.length, l));
      return;
    }
    if (!create) return;
    bindDialogue(page, beat);
    const generated = newLetter(book, availablePosition(page, panels, panel, slot, list.length), 'speech', { beat, index });
    generated.generated = true;
    page.balloons.push(generated);
  });
}

export function assignDialoguePanel(page: Page, panels: Panel[], beat: Beat, index: number, panel: Panel | null): void {
  const line = bindDialogue(page, beat)[index]!;
  if (panel) {
    const anchor = anchorFor(panel);
    line.panel = { x: anchor.x / page.widthIn, y: anchor.y / page.heightIn };
  } else delete line.panel;
  const l = letterForLine(page, beat, index);
  const next = dialoguePanel(page, panels, beat, index);
  if (l && next && panelAt(panels, centreIn(l)) !== next) moveLetter(l, availablePosition(page, panels, next, 0, 1, l));
}

export function omitDialogue(page: Page, l: Letter): void {
  const src = l.src;
  if (!src) return;
  const beat = page.beats.find((b) => b.id === src.beat);
  if (!beat) return;
  const i = sourceIndex(beat, src);
  if (beat.lines[i] !== undefined) bindDialogue(page, beat)[i]!.omit = true;
}

export function assignDialoguePreset(book: Book, page: Page, beat: Beat, index: number, preset?: string): void {
  const line = bindDialogue(page, beat)[index]!;
  if (preset) line.preset = preset;
  else delete line.preset;
  const l = letterForLine(page, beat, index);
  if (!l) return;
  const next = newLetter(book, l.cap, 'speech', { beat, index });
  l.cap = applyStyle(l.cap, captureStyle(next.cap, 'dialogue-style', 'Dialogue style'));
  if (l.cap.style === 'box') l.cap.tails = [];
}

export interface OrderIssue {
  balloon: Letter;
  message: string;
}

const rowOf = (yIn: number) => Math.round(yIn / 0.35);

/**
 * Reading-order check. Within a page the eye goes panel by panel; inside a panel, top to bottom
 * and left to right. A letter read before a line that comes earlier in the script is flagged,
 * as is a letter whose script line belongs to a different panel than the one it sits in.
 */
export function readingOrderIssues(page: Page, panels: Panel[]): OrderIssue[] {
  const issues: OrderIssue[] = [];
  const beatIndex = new Map(page.beats.map((b, i) => [b.id, i]));
  const placed = page.balloons
    .filter((b) => b.src && beatIndex.has(b.src.beat))
    .map((b) => ({ b, c: centreIn(b), panel: panelAt(panels, centreIn(b)) }))
    .sort((a, b) => (a.panel?.index ?? 99) - (b.panel?.index ?? 99) || rowOf(a.c.y) - rowOf(b.c.y) || a.c.x - b.c.x);
  let prev: { panel: number; beat: number; line: number } | null = null;
  for (const { b, panel } of placed) {
    const beat = beatIndex.get(b.src!.beat)!;
    const source = page.beats[beat]!;
    const line = sourceIndex(source, b.src!);
    const intended = dialoguePanel(page, panels, source, line)?.index ?? beat;
    const at = { panel: intended, beat, line };
    if (panel && panel.index !== intended) issues.push({ balloon: b, message: `Line from panel ${intended + 1} sits in panel ${panel.index + 1}.` });
    if (prev && (at.panel < prev.panel || (at.panel === prev.panel && (at.beat < prev.beat || (at.beat === prev.beat && at.line < prev.line))))) {
      issues.push({ balloon: b, message: `Read before an earlier line in panel ${prev.panel + 1}.` });
    }
    prev = at;
  }
  return issues;
}

export { BALLOON_STYLES };
export type { BalloonStyle };
