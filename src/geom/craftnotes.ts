import { INTENT_KEYS, type Beat } from '../doc/model';

/** Which of the five prompts a beat has answered, in INTENT_KEYS order. */
export function intentDots(beat: Beat | undefined): boolean[] {
  return INTENT_KEYS.map(({ id }) => !!beat?.intent?.[id]?.trim());
}

/** The panel marked as the page turn, or null. At most one counts: the first marked. */
export function turnIndex(beats: Beat[], panelCount: number): number | null {
  const i = beats.findIndex((b, n) => b.turn && n < panelCount);
  return i < 0 ? null : i;
}

const hasWords = (b: Beat | undefined) => !!(b && (b.desc.trim() || b.lines.some((l) => l.trim())));

/**
 * Quiet notes about a page turn. Advice only, never blocking: the turn is the artist's call
 * (craft-features #9). Returns no notes when no panel is marked.
 */
export function turnNotes(beats: Beat[], panelCount: number): string[] {
  const t = turnIndex(beats, panelCount);
  if (t === null) return [];
  const notes: string[] = [];
  if (t !== panelCount - 1) notes.push(`Panel ${t + 1} is marked as the turn, but ${panelCount - 1 - t} more ${panelCount - 1 - t === 1 ? 'panel comes' : 'panels come'} after it. The reader sees those before turning.`);
  const b = beats[t];
  if (!hasWords(b) && !b?.intent?.image?.trim() && !b?.intent?.moment?.trim()) notes.push(`Panel ${t + 1} has nothing written yet. A turn lands harder on a panel with something the reader wants to see next.`);
  return notes;
}
