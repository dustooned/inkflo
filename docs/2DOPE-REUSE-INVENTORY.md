# 2Dope reuse inventory

Which 2Dope modules inkflo lifts, adapts or leaves. Source: `E:\2026\Dev\Apps\2Dope\beta\src`
(commit `707f793`, 2026-11-09, working tree had uncommitted changes, so record the hash you
actually copy from). Companion to [REA-QUEUE.md](REA-QUEUE.md) pass 1.

**Decision this supports:** new inkflo repo, 2Dope's engine vendored into `src/engine/` with a
provenance header on each file, shared package extracted later (see end).

**Method:** line counts and import lists scanned per file; "DOM" = file touches `document`,
`window` or `HTMLElement`. Nothing here was run or compiled in an inkflo context. Behaviour
claims come from file/doc names and `DECISIONS.md`, not from reading every function. Verify
each module with its existing `*.test.ts` after copying.

Legend: **LIFT** copy as is (no or sibling-only imports) · **CLUSTER** lift together ·
**ADAPT** needs edits against inkflo's model · **REFERENCE** read for behaviour, rewrite ·
**SKIP** timeline/comp/motion, not inkflo.

---

## 1. Brush and stroke core (M2)

| Module | Lines | Imports | DOM | Verdict | Notes |
|---|---|---|---|---|---|
| `core/rng.ts` | 18 | none | no | LIFT | Deterministic `hash01(seed, i, salt)`. Fits `Stroke.seed`. |
| `core/stroke.ts` | 64 | adjust, brush, vectorstyle | no | CLUSTER | `StrokeRecord`. Map to inkflo `Stroke` (pts + pressure + brushId + seed); inkflo's is thinner, keep 2Dope's tilt/time. |
| `core/brush.ts` | 422 | vectorstyle | no | CLUSTER | `BrushSettings`, `Dynamic`, `evalDynamic`. Matches BRUSH-AND-INK §3 closely. |
| `core/vectorstyle.ts` | 205 | brush, rng, **selxform**, stroke | no | CLUSTER | Pulls in `selxform` (selection transform). Take it or cut the import. Needed only for vector ink (M2 step 5). |
| `core/adjust.ts` | 195 | none | no | LIFT | Colour adjustments, required by stroke/raster. |
| `core/color.ts` | 153 | none | no | LIFT | |
| `brush/dabs.ts` | 183 | brush, rng, stroke | no | LIFT | Stamp engine core. |
| `brush/smoothing.ts` | 181 | stroke | no | LIFT | Stabilizer; has `stabilize.test.ts`. Algorithm class is an open REA question (BRUSH-AND-INK §8). |
| `brush/clip.ts` | 30 | none | 1 | LIFT | Clip helper. **Check:** inkflo needs panel-polygon clipping; this may be rect-only. |
| `brush/raster.ts` | 740 | adjust, brush, color, rng, stroke, clip, dabs | 1 | ADAPT | Strokes onto a canvas. Target is a page pass-bitmap, not a drawing plane. Add panel-mask clipping here. |
| `brush/vector.ts`, `vectorstyled.ts` | 123+ | stroke, vectorcut, vectorstyle | 1 | ADAPT | Vector ink option. Defer to M2 step 5. |
| `core/pen.ts` | 216 | none | no | LIFT | Pen input handling (check scope when copying). |
| `core/quickshape.ts` | 677 | none | no | LIFT | Hold-to-snap line/arc/ellipse. Self-contained, has tests. |
| `core/brushlib.ts` | 154 | brush, vectorstyle | no | ADAPT | Preset store; replace presets with the 10 in BRUSH-AND-INK §4. |
| `io/brushimport.ts` | 744 | brush, zip | no | REFERENCE | Native brush import. **Clean-room risk:** it reads third-party brush formats. Do not ship under inkflo's rule 4 without a licence review. |
| `io/brushstore.ts` | 44 | none | no | LIFT | User brush persistence. |

**Gap, not in 2Dope:** panel-polygon clipped ink, the Pencil pass (blue, never exported), and
white-gel eraser on the ink bitmap. New work in `draw/`.

## 2. Fill and closure (M2 step 3, M3)

| Module | Lines | Imports | DOM | Verdict | Notes |
|---|---|---|---|---|---|
| `fill/fill.ts` | 458 | none | no | LIFT | Barrier = line alpha; BFS closing radius; 32 ms on 1920×1080 (`DECISIONS.md`). Pure, tested, has a perf test. |
| `fill/autopaint.ts`, `wand.ts` | 65, 44 | fill | no | LIFT | |
| `fill/gradient.ts` | 19 | none | no | LIFT | |

**Gap:** reference-layer fill (fill from ink, paint on flats) and a closure overlay. 2Dope fills
into its own `fill` plane under `line`, which is the same shape as inkflo's flats under ink, so
this is likely a thin wrapper. The "re-derive when ink changes" flow (PLAN §1) is new.

## 3. History, residency, device (M0, M2)

| Module | Lines | Imports | DOM | Verdict | Notes |
|---|---|---|---|---|---|
| `core/history.ts` | 91 | none | no | LIFT | Command stack. inkflo rule 2 wants one stack per book with pass-scoped views; add scope tags, don't fork. |
| `core/residency.ts` | 323 | project | no | ADAPT | Only import is 2Dope's `Drawing`/`Project`. Parameterise on a "slot with line/fill planes" interface, then bind to inkflo page bitmaps. Biggest lever for the iPad target. |
| `core/device.ts` | 151 | none | 3 | LIFT | Lite/low-tier profile and memory budgets. Mind the budget numbers: 2Dope's 1080p assumptions are far below a 2048×3100 page (about 25 MB per bitmap, three passes per page). |

## 4. Persistence and file I/O (M0, M5)

| Module | Lines | Imports | DOM | Verdict | Notes |
|---|---|---|---|---|---|
| `io/zip.ts` | 225 | none | no | LIFT | Own reader/writer, zip-slip safe, deterministic. Backbone of `.inkflo` and the Publish Kit. |
| `io/hash.ts` | 21 | none | no | LIFT | Content addressing for pages. |
| `io/persist.ts` | 481 | schema | no | ADAPT | IndexedDB layer, library model. Replace `schema` with inkflo's `doc/` schema and migrations. Keep the rules in `DECISIONS.md`: newer files refused, validate before write. |
| `io/autosave.ts` | 245 | persist, projectio, schema | no | ADAPT | Queue, write-assets-then-record, previous good save kept. Behaviour matches M0 (400 ms debounce). |
| `io/projectio.ts` | 197 | project, residency, codec, hash, schema | no | ADAPT | Project ↔ zip. Rewrite for Book ↔ `.inkflo`. |
| `io/codec.ts` | 43 | raster | no | ADAPT | PNG/WebP encode; depends on `brush/raster`. |
| `io/psd.ts` | 202 | comp | no | ADAPT | PSD writer. Rebind from comps to page passes. Useful for colourist handoff (REA Tier 5). |
| `io/ora.ts` | 78 | comp, zip | no | ADAPT | OpenRaster export, same rebind. |

## 5. Lettering (M3)

| Module | Lines | Imports | DOM | Verdict | Notes |
|---|---|---|---|---|---|
| `lettering/spec.ts` | 241 | none | no | LIFT | Balloon/tail/caption spec. Compare against inkflo `Balloon` (`speech`/`caption`/`sfx`); 2Dope's is richer. |
| `lettering/geometry.ts` | 616 | spec | no | LIFT | Balloon outlines and tails, pure. |
| `lettering/styles.ts` | 113 | spec | no | LIFT | |
| `lettering/markup.ts`, `fonts.ts`, `trace.ts` | 57, 54, 69 | none, none, geometry | no | LIFT | |
| `io/captionsvg.ts` | 118 | project, **view/caption, captionfonts, captionglyphs** | no | ADAPT | Drags in three `view/` modules, not scanned here. Check before lifting; this is what makes lettering exportable as vectors. |

**Gap:** script-driven lettering (text pulled from a beat, copyfit shrink, reading-order check)
and per-book balloon libraries are new. 2Dope's `core/dialogue.ts` / `script.ts` read caption
text for subtitles and may be a starting point for the Script→Caption link; not read in detail.

## 6. Print (M4)

| Module | Lines | Imports | DOM | Verdict | Notes |
|---|---|---|---|---|---|
| `io/pdf.ts` | 206 | none | 1 | REFERENCE | Dependency-free writer, but **JPEG pages and built-in Helvetica only**, WinAnsi text, uncompressed streams. No font embedding, no bleed boxes, no marks. Treat it as a starting skeleton; M4 needs a real writer. |
| `io/pdfpages.ts` | 51 | pdfjs-dist worker | 1 | SKIP | PDF import for storyboard. |

DesignCraft (`reference/designcraft`, readable Rust) is the better source for page boxes,
imposition and marks (REA-QUEUE Tier 2).

## 7. Export and Motion (M5–M6)

| Module | Imports | Verdict | Notes |
|---|---|---|---|
| `io/exportseq.ts`, `exportvideo.ts` | raster, comp, project, view/composite, sound… | REFERENCE | Wired to the comp compositor. For the motion comic, lift the **idea** (render a frame list, encode via `mediabunny`), not the code. Dependency to keep: `mediabunny`. |
| `io/blender.ts`, `blenderpack.ts` | | SKIP | |
| `io/storyboard*.ts`, `animatic.ts` | | REFERENCE | Page-sheet layout; useful for the print contact sheet and breakdown sheet. |

## 8. Leave alone

`core/comp.ts`, `anim.ts`, `timeline.ts`, `cellink.ts`, `cameramove.ts`, `motionpath.ts`,
`effects*.ts`, `playback.ts`, `ripple.ts`, `audio*.ts`, `view/composite`, all of `ui/` and
`app.ts` (about 29k lines, built around the comp/timeline model). inkflo's UI is the
`design/inkflo-app.html` shell, ported fresh.

---

## Provenance and licence

- Every vendored file gets a header: `// from 2Dope <path> @ <commit> — keep in sync via docs/2DOPE-REUSE-INVENTORY.md`.
- 2Dope's own `DECISIONS.md` says its brush and fill behaviour was studied, not copied, from
  Harmony, Procreate and PhotoCraft. Re-read that log before copying `brush/` and `fill/`, so
  inkflo's clean-room claim (rule 4) holds transitively. `io/brushimport.ts` is the one file
  that reads third-party formats directly.
- 2Dope's dependencies that would come along: `mediabunny` (video, M6), `fontkit` and
  `opentype.js` (lettering and font handling), `pdfjs-dist` (skip). Confirm their licences
  before shipping.

## Status

**Step 1 done (2026-11-10), from 2Dope `707f793`.** That commit's working tree had uncommitted
edits only in `comp.ts`, `effects.ts`, `style.css`, `flipmode.ts` and `view/caption.ts`, none of
which were copied.

- In `src/engine/`, unchanged except for a one-line provenance header:
  - `core/`: `rng`, `adjust`, `color`, `history`, `quickshape`, `pen`
  - `fill/`: `fill`, `autopaint`, `wand`, `gradient`
  - `io/`: `zip`, `hash`
  - `lettering/`: `spec`, `geometry`, `styles`, `markup`, `fonts`, `trace`
- 14 test files came with them. `tsc --noEmit` is clean under strict mode, and Vitest passes
  101 of 101. The fill perf test ran at 49 ms on 1920×1080.
- Not covered by a test here: `zip`, `hash`, `rng`, `trace`, `fonts`. 2Dope's `io.test.ts`
  mixes zip tests with project I/O, so it was left out. Write a standalone zip test before
  `.inkflo` relies on it.
- Project scaffold: `package.json`, `tsconfig.json` (copied from 2Dope), `vite.config.ts` and
  `.gitignore`. There is no `index.html` or app code yet.
- npm warned that esbuild's install script was not run. Vite and Vitest work anyway.

**Step 2 done (2026-11-10), same commit.** None of these files had uncommitted edits in 2Dope.

- The brush cluster went in unchanged:
  - `core/`: `brush`, `stroke`, `vectorstyle`, `selxform`, `vectorshape`, `vectorcut`,
    `vectorclip`, `brushlib`
  - `brush/`: `dabs`, `smoothing`, `raster`, `clip`
- **`selxform` was kept, not cut.** It imports only `vectorstyle` and `stroke`, so the cluster
  is closed.
- **`stroke.ts` needs `vectorshape`.** It uses an inline `import('./vectorshape')` type, which
  the import scan in §1 missed.
- `vectorcut`, `vectorclip` and `brushlib` came in for the tests and vector ink. All are pure
  and import only modules in this set.
- 7 more test files came along: `clip`, `dabs`, `stabilize`, `selxform`, `vectorstyle`,
  `vectorclip`, `brushlib`.
  - Engine total: 30 modules, 21 test files.
  - `tsc --noEmit` is clean. Vitest passes 164 of 164.
- **Still to do:**
  - `raster.ts` is vendored as is and has no unit test, because it draws to a canvas. Its
    adaptation (page pass-bitmap target, panel-polygon clipping) is new inkflo code. Write it
    in `src/draw/`, not by editing the vendored file.
  - `brushlib` still holds 2Dope's presets. The inkflo presets in BRUSH-AND-INK §4 go in
    inkflo's own code.

**Step 3 done (2026-11-10): residency, persist, autosave.** These are adaptations, not copies.
They live in inkflo's own folders, and each file names its 2Dope source and commit in a header
comment.

| inkflo file | From | What changed |
|---|---|---|
| `src/doc/model.ts` | new | Book, Page, Cut, Beat and Balloon types from BUILD-HANDOFF §3, plus a book-level `dpi` (default 300) that sets pass bitmap size. |
| `src/doc/schema.ts` | new, using 2Dope's format rules | `book.json` validation with readable paths. Newer schemas are refused. A file is read back through validation before every write. Stale `lastPageId` and art for deleted pages are dropped, not fatal. |
| `src/draw/residency.ts` | `core/residency.ts` | Same algorithm (LRU parking, wanted set, pins, background thumbnails). A page's pencil/ink/colour planes replace line/fill. Each page has its own pixel size. Passes stay `null` until first drawn. iPad budget raised from 200 to 300 MB (BRUSH-AND-INK §7). |
| `src/io/capture.ts` | `io/projectio.ts` `captureProject` | Same two phases (snapshot now, encode later). Library and archive modes. Sounds and fonts dropped for now. |
| `src/io/load.ts` | `io/projectio.ts` `loadProjectFile` | Book file → book plus parked page art. |
| `src/io/persist.ts` | `io/persist.ts` | Projects became books; the card has title, author, page count, stage and cover. IndexedDB `inkflo` v1. 2Dope's legacy single-project migration was removed. |
| `src/io/autosave.ts` | `io/autosave.ts` | Debounce 400 ms (M0). An automatic restore point every 10 commands instead of every 10 minutes. Retry delay is configurable. |
| `src/io/canvasops.ts` | `io/codec.ts` | Browser `PlaneOps`: PNG encode/decode, blank check, a message-channel defer. Its thumbnail is a stand-in until `render/` exists (rule 5). |

- **Checks:** `tsc --noEmit` is clean. Vitest passes 187 of 187, 23 of them new: 8 residency,
  8 schema, 7 autosave and library.
- **The autosave test covers M0's "done when"** for the data layer. It makes a 3-page book with
  a cut, ink and pencil, saves after 400 ms, rebuilds from the store alone and gets the same
  pages, cuts, last desk and pixels back.
- **Not verified:**
  - `IdbStore` and `canvasops.ts` have no tests, because Vitest runs in Node with no IndexedDB
    or canvas. They need a browser check (Playwright) once there is an `index.html`.
  - `vite build` fails only because there is no `index.html` yet.
- **Page art is both (decided 2026-11-10):**
  - `Page.art` holds `pencil` and `ink` stroke lists and `flats` exactly as in BUILD-HANDOFF §3.
    The schema validates them (one pressure value per point, 0–1; whole-number seeds and flat
    region ids). A page without `art` reads as nothing drawn.
  - The rendered pass bitmaps are still saved as assets next to the book, so a page opens without
    replaying its strokes.
  - **Stroke replay is built (2026-11-10)** in `src/draw/replay.ts`.
    - `toRecord` turns a stored stroke into an engine record at any dpi.
    - `replayPass` clears a pencil or ink bitmap and redraws every stroke through `RasterEngine`.
    - Engine taper lengths (px) and speed (px/ms) are scaled by `dpi / 300`, so a stroke has the
      same shape at 300 and 600 dpi. A test checks this.
    - `replayPass` itself needs a real canvas and is not run by any test yet.
    - Colour (flats) does not replay yet: flat region ids need the fill-region model (M3).
  - `src/draw/brushes.ts` is a **placeholder** brush table. `g-pen` and `pencil-hb` map to
    2Dope's `Ink` and `Pencil` presets until the BRUSH-AND-INK §4 presets are tuned. Unknown
    ids fall back to the pass default.
  - Spec `Stroke` keeps only pressure. The engine's `StrokeRecord` also stores tilt and time per
    point. If tilt shading or speed taper must replay exactly, `Stroke` needs those as additive
    optional arrays.
- **Open:** changing a page's trim or the book's `dpi` after drawing needs a resample step.
  Nothing handles that yet.

**Browser self-check (2026-11-10).** `selfcheck.html` / `src/selfcheck.ts` runs the code that
Vitest can't, in a real browser. `npm run dev`, then open `/selfcheck.html`.

- It uses its own `inkflo-selfcheck` database and deletes it when done.
- `index.html` is a placeholder until the shell is ported. `vite build` now passes; both pages
  are build inputs.
- **Result in Chromium (Claude's in-app browser pane, which was hidden):** all 9 checks pass.

| Check | Result |
|---|---|
| Replay draws ink + pencil, colour pass untouched | ✓ 1988×3056 px at 300 dpi |
| `isBlank` | ✓ |
| Replay is deterministic | ✓ pixel-identical |
| PNG round trip | ✓ alpha exact, colour within 1 |
| 600 dpi replay vs 300 dpi, scaled down | ✓ mean alpha difference 22.5/255 on painted pixels (loose limit of 40; antialiasing at edges) |
| Residency parks real canvases and restores them | ✓ pixel-exact |
| Autosave → IndexedDB → reopen | ✓ same strokes, same ink and pencil pixels |
| Decode a stored 100-stroke page | ℹ 23 ms |
| Replay 100 strokes | ℹ see below |

**Performance finding: replay is too slow for interactive use.**
- Measured from about 40 ms per stroke (60 strokes in the first check) up to 870 ms per stroke
  (timing run). The pane was hidden, so the browser throttled it and the numbers are unreliable.
  Even the best case is about 20 s for a 500-stroke page.
- Opening from the stored bitmap takes 23 ms. Keeping bitmaps, not replaying on open, is the
  right call.
- Likely cost in vendored `RasterEngine.commit`: it reads `getImageData` before and after every
  stroke for undo, and clears full-page buffers on each `begin`. Replay needs neither.
- Fix before relying on replay for export: add a replay path that skips undo capture. Do it in
  inkflo's code, not by editing the vendored file. Then re-time on a visible pane and on an iPad.

## Lift order

1. **Pure leaves** (no adaptation, bring tests): `rng`, `adjust`, `color`, `history`, `zip`,
   `hash`, `fill/*`, `quickshape`, `lettering/*`.
2. **Brush cluster**: `brush`, `vectorstyle` (decide on `selxform`), `stroke`, `dabs`,
   `smoothing`, `raster` (adapted target).
3. **Residency + persist + autosave**, adapted to `doc/` and page bitmaps. Do this before M2
   ships, or it will not run on an iPad.
4. **PSD/ORA/captionsvg** when M4–M5 need them.

## Extraction later

Once inkflo's adaptations have settled, move steps 1–2 into a shared `engine` package that both
apps consume. Do not do it first: 2Dope is under active change, and a shared package couples
the two release cadences before inkflo's needs are known.

## Open items to verify

- `brush/clip.ts` and `raster.ts` for polygon clipping versus rect clipping.
- Whether `vectorstyle` → `selxform` can be cut cleanly.
- What `view/caption*` pulls in for `captionsvg`.
- `core/pen.ts` scope.
- That each lifted module's tests pass in isolation in the new repo.
