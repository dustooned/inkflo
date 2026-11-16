import type { Beat, TransitionId } from '../doc/model';

/**
 * The rhythm of a page: one segment per panel, in reading order, each carrying its link to the
 * panel before it. Beats follow panels, so the beat at index i is panel i. A panel with no beat,
 * or a beat with no transition, is "unset": the strip shows it empty and never counts it.
 */
export interface RhythmSegment {
  index: number;
  transition: TransitionId | null;
}

export interface RhythmRun {
  transition: TransitionId;
  from: number;
  to: number;
}

export interface Rhythm {
  segments: RhythmSegment[];
  /** Consecutive panels sharing one transition (two or more). */
  runs: RhythmRun[];
  counts: Partial<Record<TransitionId, number>>;
  set: number;
  /** The most used transition, or null when none is set or two tie for first. */
  dominant: TransitionId | null;
}

export function rhythmOf(beats: Beat[], panelCount: number): Rhythm {
  const segments: RhythmSegment[] = Array.from({ length: panelCount }, (_, index) => ({ index, transition: beats[index]?.transition ?? null }));
  const counts: Partial<Record<TransitionId, number>> = {};
  const runs: RhythmRun[] = [];
  let start = 0;
  for (let i = 0; i <= segments.length; i++) {
    const t = segments[i]?.transition ?? null;
    const prev = segments[start]?.transition ?? null;
    if (i < segments.length && t) counts[t] = (counts[t] ?? 0) + 1;
    if (i === segments.length || t !== prev) {
      if (prev && i - start >= 2) runs.push({ transition: prev, from: start, to: i - 1 });
      start = i;
    }
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1]! - a[1]!) as [TransitionId, number][];
  const set = ranked.reduce((n, [, c]) => n + c, 0);
  const dominant = ranked.length && (ranked.length === 1 || ranked[0]![1] > ranked[1]![1]) ? ranked[0]![0] : null;
  return { segments, runs, counts, set, dominant };
}

/** One plain sentence about the rhythm, or '' when there is nothing to say. Advice, not a grade. */
export function rhythmNote(r: Rhythm): string {
  if (r.set < 2) return '';
  const longest = r.runs.reduce<RhythmRun | null>((best, run) => (!best || run.to - run.from > best.to - best.from ? run : best), null);
  if (longest && longest.to - longest.from >= 2) return `${longest.to - longest.from + 1} panels in a row share one transition. That can be a deliberate beat.`;
  return '';
}
