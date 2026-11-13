import type { Stage } from '../doc/model';
import type { Tool } from './desk';

export type ClusterId = 'paint' | 'colour' | 'edit';
export const CLUSTER_ORDER: readonly ClusterId[] = ['paint', 'colour', 'edit'];
const empty = { paint: [], colour: [], edit: [] };
export const DESK_CLUSTERS: Record<Stage, Record<ClusterId, readonly string[]>> = {
  draw: {
    paint: ['ink', 'pencil', 'smudge', 'eraser', 'clone'],
    colour: ['fill', 'tone', 'lines'],
    edit: ['selection', 'pixels', 'vedit', 'vpen'],
  },
  layout: { ...empty, edit: ['knife', 'erase', 'resize', 'place', 'curve'] },
  caption: { ...empty, paint: ['select', 'letter', 'draw-balloon'] },
  script: empty,
  print: empty,
};

export function clustersFor<T extends Pick<Tool, 'id'>>(stage: Stage, tools: readonly T[]): { id: ClusterId; tools: T[] }[] {
  const clusters = CLUSTER_ORDER.map((id) => ({ id, tools: [] as T[] }));
  for (const tool of tools) {
    const cluster = clusters.find(({ id }) => DESK_CLUSTERS[stage][id].includes(tool.id)) ?? clusters[0]!;
    cluster.tools.push(tool);
  }
  return clusters.filter(({ tools }) => tools.length > 0);
}

export function overflowActions<T>(all: readonly T[], max: number): { shown: T[]; overflow: T[] } {
  const split = Math.max(0, max);
  return { shown: all.slice(0, split), overflow: all.slice(split) };
}

export interface ChromeAction {
  label: string;
  glyph?: string;
  run: (trigger: HTMLElement) => void;
  disabled?: () => boolean;
  pressed?: () => boolean;
}
