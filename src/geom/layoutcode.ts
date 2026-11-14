import { newId, type Cut, type Page, type PageLayout, type PanelTransform, type Pt } from '../doc/model';
import { DEFAULT_LAYOUT, derivePanels, layoutOf, type Panel } from './carve';
import { anchorFor } from './groups';

/**
 * Layout as code: the page's cuts and panel styling as short lines of text, in inches.
 *
 *   gutter 0.18
 *   border 2.5pt
 *   curve 2
 *   round 0.1
 *   cut 4.33,0 -> 4.33,4            a straight cut; it runs on to the page edges
 *   cut 0,2 -> 6,2.4 -> 13,2         a path through these points
 *   cut 3,0 -> 3,4 bend 2.5,1 3.5,3  a curved cut (two Bézier handles)
 *   keep c3                          a one-panel cut drawn in Layout (delete the line to remove it)
 *   panel 2 move 0.4,0.2 turn 8 scale 1.1
 *   panel 3 round 0.25
 *
 * Panel numbers are reading order after the cuts. Pure: the desk formats the page, parses
 * every keystroke, and applies the result live.
 */

export type LayoutTokenKind = 'key' | 'num' | 'arrow' | 'id' | 'comment' | 'text' | 'error';
export interface LayoutToken { kind: LayoutTokenKind; text: string }
export interface ParsedLayout {
  cuts: Cut[];
  layout: PageLayout;
  lines: { tokens: LayoutToken[]; error?: string }[];
  errors: { line: number; message: string }[];
}

const r3 = (n: number) => String(Math.round(n * 1000) / 1000);
const pt = (p: Pt) => `${r3(p.x)},${r3(p.y)}`;
const short = (id: string) => 'c' + id.replace(/[^a-z0-9]/gi, '').slice(-5);

/** A moved panel's transform as move, turn and scale about its own centre. */
export function describeTransform(t: PanelTransform, centre: Pt): { move: Pt; turn: number; scale: number } {
  const [a, b, , , e, f] = t.matrix;
  const scale = Math.hypot(a, b);
  const turn = Math.atan2(b, a) * 180 / Math.PI;
  const placed = { x: a * centre.x + t.matrix[2] * centre.y + e, y: b * centre.x + t.matrix[3] * centre.y + f };
  return { move: { x: placed.x - centre.x, y: placed.y - centre.y }, turn, scale };
}

/** The matrix for a move, turn (degrees clockwise on the page) and scale about `centre`. */
export function transformMatrix(centre: Pt, move: Pt, turn: number, scale: number): PanelTransform['matrix'] {
  const r = turn * Math.PI / 180;
  const a = scale * Math.cos(r), b = scale * Math.sin(r), c = -b, d = a;
  return [a, b, c, d, centre.x + move.x - (a * centre.x + c * centre.y), centre.y + move.y - (b * centre.x + d * centre.y)];
}

/** Write a page's layout as code. */
export function formatLayoutCode(page: Page): string {
  const L = layoutOf(page);
  const out = [
    `# page ${r3(page.widthIn)} × ${r3(page.heightIn)} in`,
    `gutter ${r3(L.gutter)}`,
    `border ${r3(L.border * 72)}pt`,
    `curve ${L.curve}`,
  ];
  if (L.cornerRadius) out.push(`round ${r3(L.cornerRadius)}`);
  for (const c of page.cuts) {
    if (c.mode === 'panel') { out.push(`keep ${short(c.id)}  # one-panel cut drawn in Layout`); continue; }
    out.push(`cut ${c.pts.map(pt).join(' -> ')}${c.handles ? ` bend ${pt(c.handles[0])} ${pt(c.handles[1])}` : ''}`);
  }
  const panels = derivePanels({ ...page, layout: { ...L, panelTransforms: [] } });
  for (const p of panels) {
    const inside = (at: Pt) => pointIn({ x: at.x * page.widthIn, y: at.y * page.heightIn }, p.pts);
    const t = L.panelTransforms?.filter((x) => inside(x.at)).at(-1);
    if (t) {
      const d = describeTransform(t, p.centroid);
      out.push(`panel ${p.index + 1} move ${pt(d.move)} turn ${r3(d.turn)} scale ${r3(d.scale)}`);
    }
    const corner = L.panelCorners?.filter((x) => inside(x.at)).at(-1);
    if (corner) out.push(`panel ${p.index + 1} round ${r3(corner.radius)}`);
  }
  return out.join('\n');
}

function pointIn(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const NUM = /^-?\d*\.?\d+$/;
const POINT = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/;

/** Read layout code against `page` (for kept cuts and page size). */
export function parseLayoutCode(src: string, page: Page): ParsedLayout {
  const base = layoutOf(page);
  const layout: PageLayout = { ...DEFAULT_LAYOUT, ...base, panelTransforms: [], panelCorners: [] };
  delete layout.cornerRadius;
  const cuts: Cut[] = [];
  const lines: ParsedLayout['lines'] = [];
  const errors: ParsedLayout['errors'] = [];
  const panelLines: { line: number; n: number; words: string[] }[] = [];
  const oldAcross = page.cuts.filter((c) => c.mode !== 'panel');
  let acrossIndex = 0;
  src.replace(/\r/g, '').split('\n').forEach((row, i) => {
    const hash = row.indexOf('#');
    const body = hash >= 0 ? row.slice(0, hash) : row;
    const comment = hash >= 0 ? row.slice(hash) : '';
    const words = body.trim().split(/\s+/).filter(Boolean);
    const tokens: LayoutToken[] = [];
    // keep the exact spacing so highlighting lines up with the text
    let rest = body;
    for (const w of words) {
      const at = rest.indexOf(w);
      if (at > 0) tokens.push({ kind: 'text', text: rest.slice(0, at) });
      tokens.push({ kind: w === '->' ? 'arrow' : POINT.test(w) || NUM.test(w.replace(/(pt|in)$/, '')) ? 'num' : /^c[a-z0-9]{1,5}$/i.test(w) && words[0] === 'keep' ? 'id' : 'key', text: w });
      rest = rest.slice(at + w.length);
    }
    if (rest) tokens.push({ kind: 'text', text: rest });
    if (comment) tokens.push({ kind: 'comment', text: comment });
    const fail = (message: string) => { errors.push({ line: i + 1, message }); lines.push({ tokens, error: message }); };
    if (!words.length) { lines.push({ tokens }); return; }
    const [key, ...args] = words;
    const k = key!.toLowerCase();
    const num = (w: string | undefined, min: number, max: number) => {
      if (w === undefined || !NUM.test(w)) return null;
      const n = Number(w);
      return n >= min && n <= max ? n : null;
    };
    if (k === 'gutter' || k === 'round') {
      const n = num(args[0], 0, 3);
      if (n === null) return fail(`${k} needs a number of inches from 0 to 3, like “${k} 0.2”.`);
      if (k === 'gutter') layout.gutter = n; else layout.cornerRadius = n;
    } else if (k === 'border') {
      const w = args[0] ?? '';
      const inches = /in$/.test(w);
      const n = num(w.replace(/(pt|in)$/, ''), 0, inches ? 0.5 : 36);
      if (n === null) return fail('border needs a width, like “border 2.5pt” or “border 0.03in”.');
      layout.border = inches ? n : n / 72;
    } else if (k === 'curve') {
      const n = num(args[0], 0, 5);
      if (n === null || !Number.isInteger(n)) return fail('curve needs a whole number from 0 (sharp) to 5 (round).');
      layout.curve = n;
    } else if (k === 'cut') {
      const bendAt = args.findIndex((w) => w.toLowerCase() === 'bend');
      const path = (bendAt >= 0 ? args.slice(0, bendAt) : args).filter((w) => w !== '->');
      const pts = path.map((w) => POINT.exec(w)).map((m) => (m ? { x: Number(m[1]), y: Number(m[2]) } : null));
      if (pts.length < 2 || pts.some((p) => !p)) return fail('cut needs points like “cut 0,2 -> 6.6,2”: x,y in inches, joined by ->.');
      const handles = bendAt >= 0 ? args.slice(bendAt + 1).map((w) => POINT.exec(w)).map((m) => (m ? { x: Number(m[1]), y: Number(m[2]) } : null)) : [];
      if (bendAt >= 0 && (handles.length !== 2 || handles.some((h) => !h))) return fail('bend needs two points: “bend 2.5,1 3.5,3”.');
      const p = pts as Pt[];
      if (Math.hypot(p.at(-1)!.x - p[0]!.x, p.at(-1)!.y - p[0]!.y) < 0.05) return fail('That cut is too short to divide anything.');
      // reuse the id of the cut in the same place, so gutters keep their identity
      const old = oldAcross[acrossIndex++];
      const outside = p.some((q) => q.x < -1e-6 || q.y < -1e-6 || q.x > page.widthIn + 1e-6 || q.y > page.heightIn + 1e-6);
      const cut: Cut = { id: old?.id ?? newId('c'), mode: 'across', pts: p, ...(outside ? { bounded: true } : {}) };
      if (handles.length === 2) cut.handles = handles as [Pt, Pt];
      cuts.push(cut);
    } else if (k === 'keep') {
      const kept = page.cuts.find((c) => c.mode === 'panel' && short(c.id) === (args[0] ?? '').toLowerCase());
      if (!kept) return fail(`No drawn cut “${args[0] ?? ''}” on this page. Delete the line, or draw the cut in Layout.`);
      cuts.push(kept);
    } else if (k === 'panel') {
      const n = num(args[0], 1, 999);
      if (n === null || !Number.isInteger(n)) return fail('panel needs its number, like “panel 2 turn 5”.');
      panelLines.push({ line: i + 1, n, words: args.slice(1).map((w) => w.toLowerCase()) });
    } else {
      return fail(`“${key}” isn't a layout word. Use gutter, border, curve, round, cut, keep or panel.`);
    }
    lines.push({ tokens });
  });

  // panel lines refer to the panels the cuts above make, in reading order
  const panels: Panel[] = derivePanels({ ...page, cuts, layout: { ...layout, panelTransforms: [] } });
  for (const pl of panelLines) {
    const p = panels[pl.n - 1];
    const bad = (message: string) => { errors.push({ line: pl.line, message }); const l = lines[pl.line - 1]; if (l) l.error = message; };
    if (!p) { bad(`There is no panel ${pl.n}; the cuts make ${panels.length}.`); continue; }
    const anchor = anchorFor(p);
    const at = { x: anchor.x / page.widthIn, y: anchor.y / page.heightIn };
    let move: Pt = { x: 0, y: 0 }, turn = 0, scale = 1, moved = false, radius: number | null = null, ok = true;
    for (let j = 0; j < pl.words.length && ok; j += 2) {
      const word = pl.words[j]!, value = pl.words[j + 1];
      if (word === 'move') { const m = value && POINT.exec(value); if (!m) { bad('move needs x,y in inches, like “move 0.4,0.2”.'); ok = false; } else { move = { x: Number(m[1]), y: Number(m[2]) }; moved = true; } }
      else if (word === 'turn') { const t = value !== undefined && NUM.test(value) ? Number(value) : NaN; if (!Number.isFinite(t) || Math.abs(t) > 360) { bad('turn needs degrees, like “turn 8” (negative turns the other way).'); ok = false; } else { turn = t; moved = true; } }
      else if (word === 'scale') { const s = value !== undefined && NUM.test(value) ? Number(value) : NaN; if (!(s >= 0.1 && s <= 5)) { bad('scale needs a size from 0.1 to 5, like “scale 1.2”.'); ok = false; } else { scale = s; moved = true; } }
      else if (word === 'round') { const r = value !== undefined && NUM.test(value) ? Number(value) : NaN; if (!(r >= 0 && r <= 3)) { bad('round needs inches from 0 to 3.'); ok = false; } else radius = r; }
      else { bad(`“${word}” isn't a panel setting. Use move, turn, scale or round.`); ok = false; }
    }
    if (!ok) continue;
    if (moved && (move.x || move.y || turn || scale !== 1)) layout.panelTransforms!.push({ at, matrix: transformMatrix(p.centroid, move, turn, scale), order: layout.panelTransforms!.length + 1 });
    if (radius !== null) layout.panelCorners!.push({ at, radius });
  }
  if (!layout.panelTransforms!.length) delete layout.panelTransforms;
  if (!layout.panelCorners!.length) delete layout.panelCorners;
  return { cuts, layout, lines, errors };
}

/** The legend shown beside the editor. */
export const LAYOUT_LEGEND: { code: string; means: string }[] = [
  { code: 'gutter 0.2', means: 'Space between panels, inches' },
  { code: 'border 2.5pt', means: 'Panel border width (pt or in)' },
  { code: 'curve 2', means: 'Rounding of drawn cuts, 0–5' },
  { code: 'round 0.1', means: 'Corner radius of every panel' },
  { code: 'cut 3.3,0 -> 3.3,10', means: 'A cut through these points; runs on to the edges' },
  { code: 'cut … bend 2,1 4,3', means: 'Curves the cut with two handles' },
  { code: 'keep c1a2b', means: 'A one-panel cut drawn in Layout' },
  { code: 'panel 2 move 0.4,0', means: 'Move panel 2 (inches right, down)' },
  { code: 'panel 2 turn 8 scale 1.1', means: 'Turn (degrees) and resize a panel' },
  { code: 'panel 2 round 0.3', means: 'One panel’s corner radius' },
  { code: '# note', means: 'A comment' },
];

export { newId };
