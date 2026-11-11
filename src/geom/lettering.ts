import { newId, PT, sheetOf, type Beat, type Book, type Letter, type LetterSheet, type Page, type Pt } from '../doc/model';
import { BALLOON_STYLES, defaultCaption, type BalloonStyle, type CaptionSpec } from '../engine/lettering/spec';
import { applyStyle, captureStyle, type CaptionStyle } from '../engine/lettering/styles';
import { panelAt, type Panel } from './carve';

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

/** "MAYA: Too late." → speaker MAYA; "CAPTION: Midnight." → a caption box; "SFX: KRAK" → a sound effect. */
export function parseLine(line: string): ParsedLine {
  const m = /^\s*([A-Za-z][\w .'-]{0,30}?)\s*(\((?:[^)]{1,20})\))?\s*:\s*(.*)$/.exec(line);
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
  const used = new Set(page.balloons.filter((b) => b.src?.beat === beat.id).map((b) => b.src!.line));
  for (let i = 0; i < beat.lines.length; i++) if (!used.has(i)) return i;
  return null;
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
  const l: Letter = { id: newId('lt'), cap };
  if (line) l.src = { beat: line.beat.id, line: line.index };
  if (speaker) l.speaker = speaker;
  return l;
}

/** After script edits: linked letters take their line's words and speaker. Returns true when anything changed. */
export function syncLettersFromScript(page: Page): boolean {
  let changed = false;
  const beats = new Map(page.beats.map((b) => [b.id, b]));
  for (const l of page.balloons) {
    if (!l.src) continue;
    const raw = beats.get(l.src.beat)?.lines[l.src.line];
    if (raw === undefined) continue;
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
  if (!beat || beat.lines[l.src.line] === undefined) return false;
  const next = lineFor(l);
  if (beat.lines[l.src.line] === next) return false;
  beat.lines[l.src.line] = next;
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
    characters[speakerKey(name)] = { ...st, name: speakerKey(name) };
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
  let prev: { beat: number; line: number } | null = null;
  for (const { b, panel } of placed) {
    const beat = beatIndex.get(b.src!.beat)!;
    const at = { beat, line: b.src!.line };
    if (panel && panel.index !== beat) issues.push({ balloon: b, message: `Line from panel ${beat + 1} sits in panel ${panel.index + 1}.` });
    if (prev && (at.beat < prev.beat || (at.beat === prev.beat && at.line < prev.line))) {
      issues.push({ balloon: b, message: `Read before an earlier line (panel ${prev.beat + 1}, line ${prev.line + 1}).` });
    }
    prev = at;
  }
  return issues;
}

export { BALLOON_STYLES };
export type { BalloonStyle };
