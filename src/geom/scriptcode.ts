import type { Beat } from '../doc/model';
import { dialogueText, linesFromDialogueText, parseLine } from './lettering';

/**
 * Script as code: the whole page as plain text, typed like a screenplay.
 *
 *   # a comment (ignored)
 *   PANEL 1: Wide shot. Mina runs for the last train.
 *   > More of what we see, on its own line.
 *   MINA: Hold that door!
 *   MINA (whisper): Please…
 *   CAPTION: Midnight.
 *   SFX: KRAK!
 *
 * PANEL starts a beat (the number is optional and renumbered); "> " continues its description;
 * every other line is one balloon, in the same syntax as the Dialogue cards. Pure: the desk
 * parses on every keystroke and the same text round-trips.
 */

export type TokenKind = 'panel' | 'desc' | 'speaker' | 'manner' | 'caption' | 'sfx' | 'text' | 'comment' | 'error';
export interface Token { kind: TokenKind; text: string }
export interface CodeLine { tokens: Token[]; error?: string }
export interface ParsedScript { beats: { desc: string; lines: string[] }[]; lines: CodeLine[]; errors: { line: number; message: string }[] }

const PANEL = /^(\s*)(panel|p)\b\s*(\d+)?\s*(:?)\s*(.*)$/i;
const DIALOGUE = /^(\s*)([A-Za-z][\w .'-]{0,30}?)(\s*\([^)]{1,20}\))?(\s*:\s*)(.*)$/;

/** Read script code into beats, with tokens for highlighting and plain-language errors. */
export function parseScriptCode(src: string): ParsedScript {
  const beats: ParsedScript['beats'] = [];
  const lines: CodeLine[] = [];
  const errors: ParsedScript['errors'] = [];
  const rows = src.replace(/\r/g, '').split('\n');
  rows.forEach((row, i) => {
    const err = (message: string, tokens: Token[]) => { errors.push({ line: i + 1, message }); lines.push({ tokens, error: message }); };
    const trimmed = row.trim();
    if (!trimmed) { lines.push({ tokens: [{ kind: 'text', text: row }] }); return; }
    if (trimmed.startsWith('#')) { lines.push({ tokens: [{ kind: 'comment', text: row }] }); return; }
    const panel = PANEL.exec(row);
    if (panel && (panel[4] || panel[3] || !panel[5])) {
      const n = beats.length + 1;
      beats.push({ desc: panel[5]!.trim(), lines: [] });
      lines.push({ tokens: [{ kind: 'text', text: panel[1]! }, { kind: 'panel', text: row.slice(panel[1]!.length, row.length - panel[5]!.length) }, { kind: 'desc', text: panel[5]! }] });
      if (panel[3] && Number(panel[3]) !== n) errors.push({ line: i + 1, message: `Panel ${panel[3]} is panel ${n} here; numbers are renumbered in order.` });
      return;
    }
    const beat = beats.at(-1);
    if (trimmed.startsWith('>')) {
      if (!beat) { err('Description before the first PANEL line. Start with “PANEL 1: …”.', [{ kind: 'error', text: row }]); return; }
      beat.desc = [beat.desc, trimmed.slice(1).trim()].filter(Boolean).join('\n');
      lines.push({ tokens: [{ kind: 'desc', text: row }] });
      return;
    }
    if (!beat) { err('Dialogue before the first PANEL line. Start with “PANEL 1: …”.', [{ kind: 'error', text: row }]); return; }
    beat.lines.push(...linesFromDialogueText(trimmed));
    const m = DIALOGUE.exec(row);
    if (!m) { lines.push({ tokens: [{ kind: 'text', text: row }] }); return; }
    const who = m[2]!.trim().toUpperCase();
    const style = parseLine(trimmed).style;
    const kind: TokenKind = style === 'box' ? 'caption' : style === 'sfx' ? 'sfx' : 'speaker';
    const tokens: Token[] = [{ kind: 'text', text: m[1]! }, { kind, text: m[2]! }];
    if (m[3]) tokens.push({ kind: 'manner', text: m[3] });
    tokens.push({ kind: 'text', text: m[4]! }, { kind: 'text', text: m[5]! });
    if (!m[5]!.trim()) { err(`${who} has no words yet.`, tokens); return; }
    lines.push({ tokens });
  });
  return { beats, lines, errors };
}

/** Write beats as script code (the inverse of parseScriptCode for its own output). */
export function formatScriptCode(beats: readonly Pick<Beat, 'desc' | 'lines'>[]): string {
  return beats.map((b, i) => {
    const [first = '', ...more] = b.desc.split('\n');
    const head = `PANEL ${i + 1}: ${first}`.trimEnd();
    const desc = more.map((d) => `> ${d}`);
    const lines = b.lines.length ? dialogueText(b.lines).split('\n') : [];
    return [head, ...desc, ...lines].join('\n');
  }).join('\n\n');
}

/** The legend shown beside the editor. */
export const SCRIPT_LEGEND: { code: string; means: string }[] = [
  { code: 'PANEL 1: Wide shot…', means: 'A new panel and what we see in it' },
  { code: '> more description', means: 'Continues the panel description' },
  { code: 'MAYA: We’re late.', means: 'A speech balloon for MAYA' },
  { code: 'MAYA (whisper): Shh.', means: 'Whisper; also (shout), (thought)' },
  { code: 'CAPTION: Midnight.', means: 'A caption box (narration)' },
  { code: 'SFX: KRAK!', means: 'A sound effect' },
  { code: 'Line one\\nline two', means: 'A line break inside one balloon' },
  { code: '# note to self', means: 'A comment; not part of the script' },
];
