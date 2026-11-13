# Prompt for GPT: inkflo UI pass 1 — the Procreate-grade shell

Hand this whole file to the agent. Paste from **## Role** onward; the line above it is a note to us.

---

## Role

You are implementing a UI pass in an existing TypeScript project, `inkflo` — a browser-based comic
production app (Vite + strict TypeScript + Canvas 2D + DOM, no framework). Work in the repo root.
You have the full source and the research documents listed below. Do not ask for design input: the
design contract in this file is normative.

## Goal

Restructure the canvas chrome so the **Focus** layout behaves like the reference the repo has
already studied (Procreate's canvas UI), and so all four of its surface types exist as reusable
components. Specifically: two axes of controls (document actions vs painting tools), a tool-options
row that appears under the top bar, a persistent message line, a handed size/opacity sidebar, and
auto-hide. Then align the **Simple** layout to the same system.

This is a **shell and component pass**. It must not change the renderer, the document model, undo,
or any drawing behaviour. Studio must look and work exactly as it does now.

## Read first, in this order

1. `CLAUDE.md` — repo rules (clean-room, one renderer, one undo stack, no framework).
2. `docs/BUILD-STATUS.md` — what is built (read the last three sections).
3. `docs/research/procreate-interface.md` §3 (canvas chrome anatomy) and §6 (delta table).
4. `docs/research/procreate-ui-style.md` §2–§5 and §10 (control kit, metrics, surfaces, spec).
5. `docs/research/procreate-integration-matrix.md` rows **G1–G15** — those are your work items.
6. `docs/research/csp-simple-mode.md` §5 — the tablet-mode concept you are aligning Simple to.
7. Code: `src/ui/desk.ts`, `src/ui/prefs.ts`, `src/ui/dom.ts`, `src/ui/popover.ts`,
   `src/styles/app.css` (the Focus and Simple blocks), `src/styles/tokens.css`.

Stop reading research after that. The contract below wins over anything ambiguous in the docs.

## Repo state at HEAD (2026-11-12, `3c51714`)

Facts you must build on, not rediscover:

- **Three layouts already exist**: `prefs.layout: 'studio' | 'simple' | 'focus'` (`src/ui/prefs.ts`),
  switchable from the Display menu and with `Tab` (only when no field has focus).
- **Studio** is the everything-visible layout: `.bar` header, `.ctx` options strip, `.work` grid with
  `.rail` (64 px) + stage + `.insp` (292 px), `.stagerail` desk tabs (74 px).
- **Focus** (`src/styles/app.css` `.screen.focus …`, built in `src/ui/desk.ts`): hides `.bar` and
  `.stagerail`, floats `.ctx` top-left, `.rail` top-right (horizontal), `.insp` as a panel, and a
  `.focus-corner` bar bottom-left holding back, desk select, pager, undo/redo, inspector, fit,
  spread, display and the layout toggle.
- **Simple** (`src/styles/app.css` `.screen.simple …`): Draw only; 56 px rail showing an essentials
  subset plus a “More tools” popover, hidden inspector, horizontally scrolling `.ctx`, and
  `.brush-controls` moved to a bottom-centre horizontal strip.
- **Size/opacity**: `.brush-controls` is already a vertical floating panel on the left
  (`src/styles/app.css:335`), built in `src/ui/brushui.ts`.
- **Helpers that exist**: `h()`, `slider()`, `seg()`, `toast()`, `confirmDialog()`, `askText()` in
  `src/ui/dom.ts`; `popover()`, `displayMenu()`, `displayButton()` in `src/ui/popover.ts`.
- **Tests are pure TypeScript** — there is no jsdom/happy-dom. So any chrome logic you add must be a
  pure function with unit tests; DOM wiring is verified by hand.
- Baseline: 291 tests (BUILD-STATUS, 2026-11-10), `npx tsc --noEmit` clean, `npx vite build` clean.

## Non-negotiable rules

- **No new dependencies.** No React/Vue/Svelte, no CSS framework, no UI library.
- **No changes to** `src/render/`, `src/doc/`, `src/geom/`, `src/draw/` or undo. If a change seems
  needed there, stop and report instead.
- **Tokens only.** Every colour in new CSS comes from `src/styles/tokens.css`. Do not hard-code one.
- **Do not restyle the app.** This pass is chrome, surfaces and spacing. Buttons, panels and menus
  keep their current visual language; you are changing *where things live and how they group*.
- **Studio must not regress.** After the pass, Studio is pixel-identical or close enough that a
  reviewer cannot name a change without a diff.
- **Targets**: 44 px minimum for anything touchable, 8 px gaps inside a cluster, 14 px between
  clusters, 1 px hairline at 1×.
- **Accessibility**: every control keeps/gains an accessible name; focus-visible outline remains;
  `Escape` closes any surface; focus returns to the trigger; `prefers-reduced-motion` makes all
  transitions instant; nothing traps focus in a hidden element.
- **Keyboard**: existing shortcuts (`i p e s v a l f t m r`, `Tab`, `Escape`) keep working.
- **No per-frame work**: no layout reads in pointermove/scroll handlers.

## The contract

### Tokens (`src/styles/tokens.css`, add)

```css
--tap: 44px;      /* minimum target */
--bar: 44px;      /* one chrome row */
--bar-2: 88px;    /* chrome + options row */
--gap: 8px;       /* inside a cluster */
--gap-group: 14px;/* between clusters */
--hairline: 1px;
--sidebar: 56px;  /* size/opacity rail */
--msg: 18px;      /* message line */
--msg-tool: 32px; /* message bar control slot */
--radius: 12px;   /* surfaces */
--blur: 20px;     /* backdrop blur */
--type-1: 12px; --type-2: 13px; --type-3: 15px; --type-4: 17px; --type-5: 20px;
--ui-scale: 1;    /* multiply new spacing only; do not mass-convert existing px */
```

Use these in **new** rules. Do not mass-rewrite existing pixel values; that is how a shell pass
turns into a repaint.

### Focus chrome layout

```
┌ nav ────────────────┬────────────────────────────── actions ──────────────┐
│ ← page n/N  ↶ ↷     │                          ⚙ ✦ ⬚ ↗  ⋯                │
├ options row (44 px, hairline; only when the active tool has options) ─────┤
│ Tool name · its controls · Reset                                          │
│                                                                          │
│                                          ┌ paint ┐  canvas               │
│                                          ├ colour┤                       │
│                                          ├ edit  ┤                       │
│                                                                          │
├ message line (18 px + optional 32 px control) ───────────────────────────┤
└ save · zoom ─────────────────────────────────────────────────────────────┘
```

- `nav` (top-left, 44 px): back to book, page `n / N` (click opens the page picker), undo, redo.
  Nothing else.
- `actions` (top-right, 44 px): the desk's document actions, at most four visible plus a `⋯`
  overflow popover. Draw: Adjustments, Display, Inspector, Export. Layout: Presets, Even out,
  Uncut, Export. Caption/Print/Script: their existing actions, capped the same way.
- `paint`, `colour`, `edit`: the tool rail, split into three clusters from the **desk data**
  (below), right edge, 44 px wide, full-height cells, 8 px gaps, 14 px between clusters.
- `options row`: the existing `mode.ctx()` content, moved into a 44 px row under the bar with a
  hairline and a `Reset` action when the desk provides one. Hidden entirely when the desk has no
  options. In Studio this row replaces the current `.ctx` strip (same content, 44 px, same look).
- `message line`: new component (A6).
- `save · zoom`: keep the current save indicator and zoom readout, bottom-right, 12 px.

### Surfaces

Four kinds, each with one implementation:

| Kind | Component | Used for |
|---|---|---|
| **Card** | `src/ui/card.ts` — title, optional preview slot, sections, footer (`Reset`, `Done`), Escape, focus trap | tool settings that are not a single slider (adjustments, brush studio, guide settings) |
| **Toolbar row** | the options row above | the active tool's live options |
| **Popover** | existing `popover()` | a choice among N (blend mode later, brush picker, display, layout) |
| **Panel** | existing `.insp` / layers panel | browsing (layers, script, page list) |

Rule: one value → toolbar row; a few values → card; a choice → popover; a collection → panel. If a
control does not fit one of these, report it rather than inventing a fifth surface.

## Work items

Do them in order; keep each separately verifiable.

### A1 — Tokens
Add the block above. Acceptance: tokens exist; new CSS uses them; no existing colour changed.

### A2 — Chrome model (`src/ui/chrome.ts`, new)
A pure, testable description of the chrome, per desk:

```ts
export type ClusterId = 'paint' | 'colour' | 'edit';
export const CLUSTER_ORDER: readonly ClusterId[] = ['paint', 'colour', 'edit'];
export const DESK_CLUSTERS: Record<Stage, Record<ClusterId, readonly string[]>>;
export function clustersFor(stage: Stage, tools: Tool[]): { id: ClusterId; tools: Tool[] }[];
export function overflowActions<T>(all: T[], max: number): { shown: T[]; overflow: T[] };
```

- `DESK_CLUSTERS.draw.paint = ['ink', 'pencil', 'smudge', 'eraser', 'clone']`,
  `colour = ['fill', 'tone', 'lines']`, `edit = ['selection', 'pixels', 'vedit', 'vpen']`;
  other desks map their own tools (Layout: all in `edit`; Caption: all in `paint`; Script/Print: empty).
- Unknown tool ids fall back to `paint`, so a new tool never disappears.
- Tests in `src/ui/chrome.test.ts`: every visible tool of every desk appears **exactly once**;
  unknown ids fall back; `overflowActions(a, 4)` keeps order and never drops items silently.

### A3 — Render the Focus chrome
Rework the chrome rendering in `src/ui/desk.ts` (extract to `src/ui/chromeview.ts` if `desk.ts`
would grow past ~800 lines). Keep all existing callbacks; this is a re-parenting, not a rewrite.

Acceptance:
- Every action that existed in `.focus-corner` is still reachable (the four visible + `⋯`).
- Rail splits into the three clusters with the 8/14 px gaps; cells are 44 px wide and full height.
- The options row shows the active tool's controls and disappears when there are none.
- Studio renders the same buttons in the same places as before, except the options row is now
  44 px and lives directly under the header.

### A4 — Card component
Add `src/ui/card.ts` and move **two** existing surfaces onto it: the adjustments dialog
(`src/ui/adjustments.ts`) and the brush studio (`src/ui/brushui.ts`). Same fields, same callbacks,
same undo behaviour.

Acceptance: both open, preview, apply and cancel exactly as before; `Escape` cancels; focus returns
to the trigger; both use the same card CSS.

### A5 — Handed sidebar
Add `prefs.handed: 'left' | 'right'` (default `'right'`; the sidebar sits on the **opposite** side,
i.e. left by default, matching today's position). Move `.brush-controls` into the chrome layer and
mirror it. Draw only.

Acceptance: toggling handedness mirrors the sidebar without moving the canvas; the choice persists;
no layout shift of the stage.

### A6 — Message line (`src/ui/messagebar.ts`, new)
`hint(text, opts?: { control?: HTMLElement; tone?: 'info' | 'warn'; timeout?: number })` and
`clearHint()`. `toast()` stays for one-off confirmations. Use it in Draw for three conditions that
are currently toasts or invisible: *stay in panel*, *drawing assist*, *gap close threshold*.

Acceptance: one line, `aria-live="polite"`, dismiss on `Escape`, optional control renders at 32 px,
never covers the canvas centre, no duplicate messages.

### A7 — Auto-hide
Add `prefs.autoHide: boolean` (default `false`) and `prefs.autoHideDelay: number` (default `3500`).
Focus only: after the delay with no pointer/key input, chrome fades and stops taking pointer events;
any pointerdown/wheel/keydown restores it. A pin button in `nav` toggles `autoHide`. Reduced motion
= instant.

Acceptance: idle hides, interaction restores, pin disables, canvas input still works while hidden,
the state is not written into the book file.

### A8 — Key tags (only if A1–A7 are green)
Show existing shortcuts as `<kbd>` in the tool flyout and Display menu rows. No new shortcuts.

## File map

| File | Action |
|---|---|
| `src/styles/tokens.css` | add the token block |
| `src/styles/app.css` | Focus chrome, options row, message line, card surface, sidebar mirroring; Simple alignment |
| `src/ui/chrome.ts` | **new** — cluster model + overflow |
| `src/ui/chrome.test.ts` | **new** — cluster and overflow tests |
| `src/ui/chromeview.ts` | **new, only if** `desk.ts` would exceed ~800 lines |
| `src/ui/card.ts` | **new** — card shell |
| `src/ui/messagebar.ts` | **new** — message line |
| `src/ui/desk.ts` | re-parent chrome, wire clusters, options row, message line, auto-hide |
| `src/ui/prefs.ts` | add `handed`, `autoHide`, `autoHideDelay` with validation |
| `src/ui/adjustments.ts`, `src/ui/brushui.ts` | move onto `card.ts` |
| `docs/BUILD-STATUS.md` | one short section describing the pass, at the end |

## Verification

Run, in this order, and paste the real output:

```powershell
npx tsc --noEmit
npx vitest run
npx vite build
npm run dev      # then http://localhost:5190
```

If the harness blocks process spawning (`EPERM spawn`, esbuild), say so explicitly and report which
commands could not run. Do **not** claim a green run you did not see.

Manual checklist (report each as pass/fail with a sentence):

1. Studio: header, options row, rail, inspector, stage rail unchanged; every desk still usable.
2. `Tab` toggles Focus; `Tab` inside a text field does not.
3. Focus: nav, actions, clusters, options row in the positions above; nothing overlaps at 1280×800
   or 1024×768.
4. Pick each tool: the options row matches the tool, and disappears for a tool with no options.
5. `⋯` reveals every action that the old focus corner had.
6. Options row: change a value, then `Reset` if present.
7. Handedness: switch to left, the sidebar mirrors, reload keeps it.
8. Message line: trigger *stay in panel*, *assist* and *gap close*; one line, no stacking.
9. Auto-hide on: wait 4 s (chrome hides), touch the canvas (returns), pin (stays).
10. Adjustments and Brush Studio: open, preview, apply, cancel, Escape.
11. Keyboard: `i p e s v a l f t m r` still select tools; undo/redo still work.

## Out of scope

Blend modes, alpha lock, clipping masks, curve/colour-balance/halftone adjustments, liquify, wand,
feather, saved selections, PSD/PDF changes, `.2dope` changes, any renderer or data-model change.
Those are later rows in `procreate-integration-matrix.md` (D1–D3, C1–C4, B4–B9) and must not be
smuggled into this pass.

## Report back

1. **What changed** — per work item, one or two sentences.
2. **Files** — created/modified.
3. **Checks** — the exact commands and their results.
4. **Manual checklist** — pass/fail per item, with the reason for any fail.
5. **Deviations** — anything in this contract you could not do as written, and why.
6. **Follow-ups** — the next three things you would do, in order.

Keep the diff reviewable: no drive-by reformatting, no renames outside the file map, no dependency
changes.

## Appendix — the numbers, if you cannot read the research docs

Everything below is already in the contract above; this is the short version.

- **Bars**: 44 px per row; 88 px when the options row is open; hairline under the bar.
- **Targets**: 44 px minimum; 44 px wide × full-bar-height for tool cells.
- **Spacing**: 8 px inside a cluster, 14 px between clusters.
- **Sidebar**: 56 px wide (inkflo's current rail width; the reference uses 51).
- **Message line**: 18 px text row + optional 32 px control slot, above the canvas bottom edge.
- **Surfaces**: blur-backed, token colours, 12 px radius, `--blur: 20px`; the page underneath stays
  paper.
- **Surfaces rule**: one value → toolbar row; a few values → card; a choice → popover; a collection
  → panel.
- **Cluster split for Draw**: paint = brush, pencil, smudge, eraser, clone; colour = fill, tone,
  comic lines; edit = selection, transform, vector edit, vector pen.
- **Nav**: back, page, undo, redo — nothing else.
- **Actions**: at most four, plus a `⋯` overflow that holds the rest.
- **Auto-hide**: 3.5 s idle, restores on any input, a pin disables it, reduced motion = instant.
- **Do not**: add a framework, hard-code a colour, change the renderer, the model or undo.
