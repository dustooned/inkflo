# inkflo — build handoff

The spec for turning the prototypes in `design/` into the app. Read [../CLAUDE.md](../CLAUDE.md)
first. Reference behaviour lives in `design/inkflo-app.html` (shell) and
`design/panel-carving.html` (layout engine); visual acceptance references are the
`design/preview-*.png` images.

**Product line:** Procreate's ease, Clip Studio's comic power, none of their weight. One book,
one page, five desks, one export that ships.

---

## 1. Non-negotiables

| # | Rule | Why |
|---|---|---|
| 1 | Page document is truth; panels/cuts/gutters derived | One source, every desk and every export sees the same page |
| 2 | Command-based undo, one stack per book | Ripples and merges must be reversible |
| 3 | No backend, no accounts | Students, classrooms, static hosting |
| 4 | 60 fps drawing on an iPad, page open < 150 ms | It must feel like Procreate or it fails |
| 5 | Clean-room assets and code | See `REA-QUEUE.md` |

**Non-goals for v1:** real-time collaboration, 3D, animation timeline (the Motion desk is a cue
list), CMYK soft-proofing, Windows/Mac native builds.

---

## 2. Milestones

Each milestone is shippable on its own. Acceptance criteria are testable.

### M0 — Shell and persistence

Port the three screens and make them survive a refresh.

- `src/app/` router with `#home`, `#book/:id`, `#desk/:book/:page/:desk` (hash routing, no server).
- Library store in IndexedDB: books, pages, folders, last-opened, last-desk-per-book.
- Debounced autosave (400 ms) + version snapshots every 10 commands.
- Home: folders filter, book covers drawn from the first laid-out page, stage dot.
- Book: page grid, stage dots, Preview sequence, Continue at last desk, New page.
- Desk: tool rail, context bar, inspector, stage rail with docket.

**Done when:** create a book, cut three pages, refresh, land back on the desk you left, with the
same panels, strokes and balloons.

### M1 — Script → Layout

- Beat editor (description + dialogue lines), add/remove/reorder, per-page.
- **Beats become panels**: a "Send to Layout" that creates one placeholder panel per beat when
  the page has no cuts (grid fill), or appends empty cuts.
- Layout: knife with **cut modes** — `across` (to trim) and `panel` (stop at the panels the stroke
  touches). Default `panel`.
- Cut modes are per-cut, persisted; moving a cut keeps its mode.
- Presets (4/6/9/rows), gutter/outline/curve sliders, Even out, resize handles that move the cut.
- Reading order: position-based, renumbered; drag to override (v1.1).

**Done when:** a page with 6 beats produces 6 panelled layout, and a `panel` cut splits only the
panel it crosses.

### M2 — Draw engine (the big one)

See [BRUSH-AND-INK.md](BRUSH-AND-INK.md) for the full contract.

- Canvas 2D surface per page, one bitmap per slot: `pencil`, `ink`, `flat`.
- Stamp-based brush engine: spacing, jitter, pressure/tilt/speed dynamics, taper, grain.
- Stabilizer (pulled string) with a 0–100 setting; QuickShape for straight/arc.
- Passes: Pencil (blue, never exported), Ink (prints), Colour (flats + shade + tone).
- Tools: brush, eraser (pixel + stroke), fill (flood with gap closing), eyedropper, transform.
- Brush library: 10 presets to start (see spec), JSON-import/export for user brushes.
- Residency: park offscreen pages as PNG blobs, reload on demand (2Dope's model).

**Done when:** a 6-panel page can be pencilled, inked and flatted at 60 fps on an iPad, and the
ink is crisp at 600 dpi on export.

### M3 — Caption

- Balloon tool: click/drag to place; ellipse or rounded box; tail attached to a point.
- Text pulled from the script beat; double-click cycles lines; inline edit.
- Copyfit: shrink-to-fit with min size, then overflow warning.
- SFX tool: free text with a warp preset library.
- Reading-order check: flags a balloon the eye reaches before its speaker.

**Done when:** a page's dialogue can be lettered entirely from the script, with no retyping, and
the reading-order check catches a misplaced balloon.

### M4 — Print

- Imposition view: single, spread, saddle-stitch signature.
- Trim/bleed/safe overlays, crop marks, page numbers, ISBN slot.
- Preflight: dpi per page, ink coverage, fonts, art on trim, panels crossing the gutter.
- Export PDF (RGB + embedded fonts) and per-page TIFF/PNG at 300/600 dpi.

**Done when:** a 24-page book exports a PDF that passes the preflight with zero warnings, and a
print shop can use it without a conversation.

### M5 — Export and Publish Kit

- `.inkflo` zip (book.json + page PNGs + source).
- CBZ + `ComicInfo.xml`.
- **Publish Kit**: static site zip — `index.html`, `data/comic.json`, `assets/pages/*.webp`,
  `theme/theme.css`, `support.json`, `README-PUBLISH.md`, `UPDATE.md`, `.github/workflows/pages.yml`.
- Themes: Newsprint, Tankōbon, Webtoon, Sunday, Zine, Noir (tokens only).
- Support cards: Patreon, Ko-fi, Gumroad, Discord, newsletter — written to `support.json`.
- No build step in the output: it must run from a folder.

**Done when:** the zip unzips, opens from `file://`, and deploys to GitHub Pages unmodified.

### M6 — Motion desk

- Per-panel camera (from Layout) + cue list: enter, hold, pan, parallax, typewriter, SFX.
- Player: `motion.html` in the Publish Kit, same `comic.json`.
- Export MP4/WebM via the same compositor.
- **2Dope handoff**: `scene.json` + page PNGs in a zip that opens in 2Dope.

**Done when:** a 6-page comic plays as a motion comic and the same file opens in 2Dope as a scene.

### M7 — Craft assist

Vocabulary for the page, not new drawing tools. Full mapping:
[research/comics-craft-source-map.md](research/comics-craft-source-map.md); enums in
[research/craft-taxonomy.json](research/craft-taxonomy.json).

- **Panel intent** — five optional prompts per panel: moment, frame, image, word, flow.
- **Transition type** per panel (six types) + a page rhythm strip drawn under the page.
- **Shot** per panel (ten types) with Layout presets.
- **Word–image relation** per panel; one chip in Caption.
- **Clarity checks** (hints, dismissible): text repeating the picture, balloon before speaker,
  unresolved tail, eye path fighting reading order.
- **Composition**: silhouette preview (fill art black) and an advisory checklist.
- **Continuity**: screen-direction flip across a cut, with a dismiss.
- **Study lens**: label a reference page's transitions and shots; export a breakdown sheet.

**Done when:** a page can be read back as a sequence of labelled beats, the rhythm strip shows a
run of identical transitions, and every check is advisory with a dismiss.

---

## 3. Data model

```ts
type Stage = "script" | "layout" | "draw" | "caption" | "print";
type CutMode = "across" | "panel";
type Pt = { x: number; y: number };

interface Book {
  id: string; title: string; author: string;
  folderId?: string;
  pages: Page[];
  lastPageId?: string; lastStage: Stage;
  createdAt: number; updatedAt: number;
}

interface Page {
  id: string;
  widthIn: number;      // 6.625 default
  heightIn: number;     // 10.187 default
  cuts: Cut[];
  beats: Beat[];
  art: { pencil: Stroke[]; ink: Stroke[]; flats: Record<number, string> };
  balloons: Balloon[];
  state: Record<Stage, 0 | 1 | 2>;   // todo / wip / done
  updatedAt: number;
}

interface Cut {
  id: string;
  mode: CutMode;
  pts: Pt[];          // raw stroke, page units
  extended?: Pt[];    // frozen path for mode:"panel"; null for "across"
}

interface Beat { id: string; desc: string; lines: string[]; }

interface Stroke {
  pts: Pt[]; pressure?: number[];
  w: number; brushId: string; seed: number;
}

interface Balloon {
  id: string; x: number; y: number; rx: number; ry: number;
  text: string; tail?: Pt; style: "speech" | "caption" | "sfx";
}
```

**Derived, never persisted:** panels (fold the cuts), gutter bands, thumbnails, print sheets.

Key functions to port from `design/panel-carving.html` (they are already correct):
`splitPoly`, `cutPath`, `cutMode` handling (`panelCut`/`rayExit`), `derivePanels`, `centroid`,
`pointInPoly`, `nearestCut`.

---

## 4. Module map

```
src/
  app/        router, screens (home, book, desk), state store, commands/undo
  doc/        book, page, cut, beat, balloon model + migrations
  geom/       splitPoly, cutPath, derivePanels, inset, hit-testing  (pure, unit-tested)
  render/     page renderer (SVG overlay + canvas layers), thumbnails, print sheet
  draw/       brush engine, stabilizer, dabs, residency, brush presets
  io/         indexeddb, .inkflo zip, cbz, publish kit, pdf
  ui/         rail, context bar, inspector, stage rail, dialogs, toast
  styles/     tokens.css, base.css
```

The page renderer is shared: `renderPage(page, {stage, dpi, include})` produces the same scene for
the screen, a thumbnail, a published page and a print sheet.

---

## 5. Interaction contracts (from the prototypes)

| Gesture | Result |
|---|---|
| Knife drag (across) | Cut runs to trim; every panel crossed splits |
| Knife drag (panel) | Cut runs only to the boundary of the panels it touches |
| Resize handle drag | Moves the nearest cut along that axis; all panels on it re-derive |
| Move drag on a panel | Lifts it; drop on a panel swaps slots, drop on board floats it |
| Shift while cutting | Straight cut |
| ⌘Z | Undo last command (cut, move, stroke, balloon, slider) |
| 1–5 in the desk | Jump to Script/Layout/Draw/Caption/Print |

---

## 6. Testing

- **Unit (Vitest):** geometry — split a rectangle with a line, a curve, a panel-bounded cut, two
  crossing cuts; assert panel count, areas and that no polygon self-intersects.
- **Browser (Playwright):** home → book → desk; cut a page; draw a stroke; place a balloon; open
  export; refresh and assert persistence.
- **Visual:** screenshot each desk at 1440×900 and compare against `design/preview-2x-*.png`
  with a 2% pixel tolerance.
- **Perf:** 500-stroke page opens < 150 ms; pointer-to-paint < 12 ms on an iPad Air.

---

## 7. Definition of done (per desk)

A desk is done when: its tools work with mouse, pen and touch; undo covers every action; it
persists across refresh; it renders identically in export; and a first-time user can finish the
desk's job without opening a menu.

---

## 8. Open questions for the product owner

1. Chapters inside a book, or flat pages + folders?
2. Does Caption also own web captions, alt text and motion titles?
3. Swap contents or swap shape on reorient? (Currently: shape.)
4. Is print a real print run, or PDF for POD?
