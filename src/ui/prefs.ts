import type { Stage } from '../doc/model';
import { GUIDES, type Guide } from '../geom/composition';

/**
 * Device preferences: how the app looks, never what the book is. Stored in localStorage (with
 * try/catch: private windows can refuse it) and never part of undo or the book file.
 */

export type Theme = 'system' | 'light' | 'dark';
export type Backdrop = 'grid' | 'dots' | 'plain';
export type Layout = 'studio' | 'focus';

export interface ToolPrefs {
  /** Tool ids in rail order (unknown or missing tools fall back to the desk's default order). */
  order?: string[];
  hidden?: string[];
  /** Chosen variant per tool. */
  variants?: Record<string, string>;
}

export interface Prefs {
  theme: Theme;
  backdrop: Backdrop;
  /** Grid strength, 0–1. */
  gridOpacity: number;
  vignette: boolean;
  layout: Layout;
  guide: Guide;
  snapGuide: boolean;
  tools: Partial<Record<Stage, ToolPrefs>>;
}

const KEY = 'inkflo.prefs.v1';
const DEFAULTS: Prefs = { theme: 'system', backdrop: 'grid', gridOpacity: 1, vignette: true, layout: 'studio', guide: 'off', snapGuide: false, tools: {} };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const v = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system',
      backdrop: v.backdrop === 'dots' || v.backdrop === 'plain' ? v.backdrop : 'grid',
      gridOpacity: typeof v.gridOpacity === 'number' && v.gridOpacity >= 0 && v.gridOpacity <= 1 ? v.gridOpacity : 1,
      vignette: v.vignette !== false,
      layout: v.layout === 'focus' ? 'focus' : 'studio',
      guide: GUIDES.find((g) => g.id === v.guide)?.id ?? 'off',
      snapGuide: v.snapGuide === true,
      tools: v.tools && typeof v.tools === 'object' ? v.tools : {},
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let current = read();

export function prefs(): Readonly<Prefs> {
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // not saved (private window); still applies for this session
  }
  applyTheme();
  window.dispatchEvent(new CustomEvent('inkflo:prefs'));
}

export function toolPrefs(stage: Stage): ToolPrefs {
  return current.tools[stage] ?? {};
}

export function setToolPrefs(stage: Stage, patch: ToolPrefs | null): void {
  const tools = { ...current.tools };
  if (patch === null) delete tools[stage];
  else tools[stage] = { ...tools[stage], ...patch };
  setPrefs({ tools });
}

export function applyTheme(): void {
  const t = current.theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function onPrefs(fn: () => void): () => void {
  window.addEventListener('inkflo:prefs', fn);
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', fn);
  return () => {
    window.removeEventListener('inkflo:prefs', fn);
    mq?.removeEventListener?.('change', fn);
  };
}

/** Read a CSS custom property from the document (theme-aware colours for canvas drawing). */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
