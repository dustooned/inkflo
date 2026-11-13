# Build status

Where the app stands against [BUILD-HANDOFF.md](BUILD-HANDOFF.md). Updated 2026-11-10.

Run it with `npm run dev`, then open `http://localhost:5190`. The engine self-check is at
`/selfcheck.html`. Checks: `npm test` (291 tests), `npx tsc --noEmit`, `npx vite build`.

## Milestones

| M | State | What works | Not yet |
|---|---|---|---|
| M0 Shell + persistence | **Done** | Hash routes; Home (library, covers, import `.inkflo`); Book (page grid, stage dots, add/move/delete page, Continue); Desk frame (tool rail, context bar, inspector, stage rail, pager, undo/redo, zoom/pan). IndexedDB library, 400 ms autosave, restore point every 10 commands. **Done-when verified in the browser:** reload lands on the last desk with the same panels, strokes, fills and balloons. | Folders on Home; Preview sequence; docket drag |
| M1 Script → Layout | **Done** | Beat editor (description + one line per balloon, reorder, delete). Send to Layout carves one panel per beat. Knife with Panel only / To edges modes, Shift for straight cuts. Resize handles move the cut under a panel. Uncut tool. Presets (splash, 2 rows, 3 tiers, 4, 6, 9). Gutter / border / curve sliders. Even out. | Move/swap/detach panels (prototype has them); drag-to-reorder reading order |
| M2 Draw | **Most** (see Inking tools) | Pencil (blue, never exported), Ink, Eraser (on pencil or ink), Colour bucket fill with gap closing. Fills stop at the panel edge. "Stay inside panel" clips a stroke to its panel. Stabilizer on ink. Strokes and fills stored as data; Rebuild from strokes. Pixel undo. | Tone; replay speed (~40 ms/stroke) |
| M3 Caption | **Done** | Balloon / Caption / SFX tools pull the panel's next script line (`MAYA:`, `CAPTION:`, `SFX:`). Tails, move, resize, double-click for the next line, edit text and kind. Copyfit with overflow flag. Reading-order check. | SFX warp library; per-book balloon styles |
| M4 Print | **Partial** | Trim / bleed / safe guides, crop marks, preflight checklist, page PNG at book dpi. | PDF with bleed and marks; imposition; 600 dpi export |
| M5 Export | **Partial** | `.inkflo` export/import, CBZ with ComicInfo.xml, page PNG zip. | Publish Kit website |
| M6 Motion → 2Dope | **Done (export side)** | `.2dope` project: a comp per page with a layer per panel (ink on Line, paper + colour on Fill), a layer per balloon that appears when the camera reaches its panel, a paper layer; a main comp with a camera that shows each page then moves panel to panel, eased. 16:9 HD or page-shaped. Beat text travels as storyboard captions. **Checked against 2Dope's own `validateProjectFile`** (unit test, needs the sibling `2Dope/beta` checkout). | Opening the file in the 2Dope app by hand has not been done yet; MP4 export; cue editor |

## Shell v2 (EXPLORE-DESK-UI.md step 1), 2026-11-10

- **Themes:** Light, Dark ("Night desk") and System, as tokens in `src/styles/tokens.css`. No
  colour is hard-coded in `app.css`. The page itself stays paper in every theme.
- **Backdrop** (`src/ui/backdrop.ts`): a grid or dot field that pans and zooms with the page,
  with major lines every inch, a vignette and the page shadow. Grid / Dots / Plain and strength
  are set in the ◐ Display menu.
- **Studio / Focus layouts:** the ⤢ button, the Display menu, or Tab (only when nothing has
  keyboard focus, so Tab still moves focus).
  - Focus floats the tool rail top-right and the settings top-left, with a corner bar for back,
    desk, page, undo/redo, inspector, display and return.
- **Tool rail:** tools sit in groups with dividers.
  - Flyout variants (CSP style) open by clicking the active tool again, right-clicking, or a long
    press on touch: Knife (Panel only / To edges), Eraser (ink / pencil), Letter (speech /
    caption / SFX, keys B/C/S).
  - The ⋯ menu shows, hides and reorders tools per desk, with Restore defaults. Hidden tools keep
    their keys.
  - All of this is device preferences (`src/ui/prefs.ts`, localStorage), never book data.
- **Checks:** typecheck, 224 tests and the build pass. In the browser (DOM checks plus magnified
  screenshots, because the pane was hidden), these all worked: flyout, variant memory,
  hide/restore, theme switching, and Focus with the floating inspector.
- **Not verified:** the full layout at desktop size by eye (the pane was hidden), touch long-press
  on a real tablet.

## Typed layers in panel groups (EXPLORE-DESK-UI step 2), 2026-11-10

- **Model** (`doc/model.ts`): a page has `groups`.
  - Groups: Over panels, one per detected panel, Background.
  - Each group holds typed layers: Pencil, Ink, Colour, Tone, Reference.
  - Each layer has its own switches: visible, locked, opacity, prints, fill reference, over frame.
  - Strokes and fills live on their layer.
- **book.json schema 2:**
  - Art keys are per layer.
  - **Schema-1 books migrate on open:** their passes become Background layers with the same
    strokes, fills and bitmaps. Verified on the real "Night Shift" book in the browser.
- **Panel groups follow the layout** (`geom/groups.ts`):
  - A group stores an anchor point, never an outline.
  - Every panel gets a group, kept in reading order and labelled from its beat.
  - Empty duplicates are pruned; groups holding art are never removed.
- **Rendering:**
  - Background → panel groups (clipped to their panel when masked) → gutters → over-frame
    layers → Over panels → balloons.
  - Verified by pixels: art past a border is hidden when masked, and shows with Over frame or
    with the mask off.
- **Draw:**
  - Target **Panel under pen** (default): a stroke goes to its tool's layer type in the panel it
    starts in. The layer is created if missing, as one undo step with the stroke.
  - Target **Selected layer**: any brush on the layer picked in the Layers panel.
  - Fills read walls from the group's and Background's fill-reference layers.
- **Layers panel** (`ui/layerspanel.ts`):
  - Per group: mask ◫, lock, visibility, add layer. Per layer: over frame ⤒, lock, visibility,
    and an options menu (opacity, prints, fill reference, type change such as "Promote pencil to
    ink", move, rename, delete).
  - Ctrl/Shift-click group names to multi-select. The **All panels** menu applies show/hide,
    mask, lock and collapse to the selection or to every panel.
- **Storage:** residency, save and load are per layer, with a revision per layer, so autosave
  re-encodes only the layers that changed.
- **2Dope export:** each panel layer combines that panel's groups with the Background art.
  Over-frame and Over-panels art export as their own layers, appearing with their panel.
- **Checks:** typecheck, 234 tests, build.
  - Browser: migration, a stroke creating a layer in the right panel group, over-frame
    toggle/undo/redo, masking pixels, motion export layer list, and reload persistence.
- **Known limits:**
  - Layer bitmaps are page-sized (about 24 MB each at 300 dpi when used). Cropping to the
    panel's box is a follow-up for tablets.
  - Splitting a panel keeps its group in the half that holds the anchor; art in the other half
    is masked away (kept, not lost) until the mask is turned off.
  - Layers panel is in Draw only.
  - Pointer capture is now guarded (synthetic or lost pointers no longer throw).

## Lettering v2 (EXPLORE-DESK-UI step 3), 2026-11-10

- **Model:** each balloon is now a `Letter` holding 2Dope's live caption model, in **points**,
  plus its script link, speaker and a "small on purpose" flag.
  - The book has a **lettering style sheet**: Small/Body/Big in pt (7.5 / 9 / 15), at-risk and
    minimum limits, house font, character styles, and optional extra checks.
  - **Schema 3:** older balloons migrate to live captions (same place, size, words, tail).
- **Fonts:** 2Dope's 8 open-licence comic fonts (OFL / Apache 2.0, licences in `public/fonts/`),
  loaded on first use. The page redraws when they arrive, and exports wait for them.
- **Renderer** (`render/caption.ts`): 2Dope's caption painter for still pages.
  - Balloon shapes: speech, thought, shout, whisper, box, SFX, drawn shapes.
  - Tails: merged, pointed, bubbles, lightning. Also linked balloons, markup (*bold*, _italic_),
    text on a path, outlines and under-fills.
  - Type is laid out at the real pixel size.
- **Caption desk:**
  - **Letter tool:** six kinds (B/T/H/W/C/S).
    - Click in a panel to letter its next script line. The line decides the kind: "CAPTION:",
      "SFX:", "MAYA (whisper):".
    - Draw a loop and 2Dope's detector makes that balloon shape.
  - **On the page:** drag to move; drag tail dots to aim; drag the corner to resize;
    double-click for the next line.
  - **Inspector:** words with script sync; speaker with "Save as / Apply character style";
    lettering (font, size step, scale, B/I/AA, align, colour); balloon (kind, fill, ink, border,
    width, roundness, spikes, bumps, hand-drawn); tails; readability.
  - **Style sheet** dialog: sizes, limits, house font, character styles, rename speaker (renames
    script lines and balloons across the book, one undo).
- **Script sync both ways:** editing a balloon updates its script line, and editing the script
  updates its balloons, each as one undo step. Speakers fill in from linked lines.
- **Readability guard** (`geom/readability.ts`):
  - Checks type size at real print size, border weight, text/balloon contrast (WCAG ratio),
    sound effects without an outline, and light fonts at small sizes.
  - Digest and phone checks are opt-in in the style sheet; print is always checked.
  - Amber/red dots on the page; one-click fixes; "Fix all on this page"; Keep readable snaps the
    scale to steps (Alt is free) and never below the minimum.
- **2Dope export:** balloons go out as **live captions** (2Dope format 10, editable and
  animatable) or as images (schema 3). This is a choice in the Export dialog. 2Dope's scale floor
  makes very small type a little larger on screen.
- **Checks:**
  - Typecheck, build, 245 tests, including 2Dope's own validator accepting live captions.
  - Browser: migration of the real book's balloons; fonts loading; a script line becoming an SFX
    with the right font; editing words updating the script; snapping; undo; and both export modes.
- **Not done:** pick-whip tails to art, joined-balloon creation UI, kerning per pair, lettering
  languages, SVG/PDF vector text.

## Inking tools (EXPLORE-DESK-UI step 4), 2026-11-10

- **Brush library** (`draw/brushes.ts`): G-pen, Maru pen, Mapping pen, Brush pen, Dry ink,
  Pencil HB, Rough pencil, Ink wash, Flat brush, Tone brush, plus 2Dope's set. All are inkflo
  presets, tuned by eye (clean-room).
- **Book snapshots:** the first time a brush draws in a book, its exact settings are copied into
  `book.brushes` as `<id>~<hash>`. Strokes point at the snapshot, so editing a brush never changes
  finished art, and the book opens the same on any device.
- **Brush picker** (▾ in the context bar): groups with a preview stroke for each brush. Pencil
  and Ink each remember their own brush (device setting).
- **Brush Studio** (✎): tabs for Stroke, Stabilize, Taper, Shape, Grain and Pressure, with a live
  preview. Library brushes are never changed: saving makes a copy in **My brushes** (stored on
  this device). Your own brushes can be edited or deleted.
- **Stabilize** (live, Lazy Nezumi-style pulled string) and **Correct** (smooths the line after
  the pen lifts) sliders.
- **QuickShape:** hold the pen still at the end of a stroke to snap it to a line, arc, ellipse,
  rectangle or polygon. It keeps the pressure you drew with.
- **Rulers** (📐): Straight, Parallel (angle), Radial (drag the centre), Perspective (1 or 2
  vanishing points, plus verticals; drag the handles, which can sit off the page). The stroke
  picks the guide that matches its direction. A Strength setting keeps some hand wobble.
- **Comic lines tool (L):**
  - **Focus lines:** click the focus point in a panel.
  - **Speed lines:** drag along the motion.
  - Both make real tapered ink strokes with the current ink brush, as one undo step, and fit the
    panel's shape. Line count, clear zone, length and roughness are adjustable.
- **Checks:**
  - Typecheck, build, and 257 tests, including new ruler, generator and brush tests.
  - Browser:
    - The picker and Brush Studio render.
    - A brush saved as "mine" and used in a stroke stored its snapshot in the book.
    - Focus and speed lines drew correctly.
    - A wobbly stroke under the Parallel ruler was stored perfectly straight.
    - The test marks were undone afterwards.
- **Not done:**
  - Resizing a QuickShape while still holding.
  - Rulers are per device, not saved per page.
  - Vector pen.
  - Line/fill detection.
  - A pen test on a real tablet.

## Line and fill detection (EXPLORE-DESK-UI section 7), 2026-11-10

- **Fill kit** (`draw/fillkit.ts`): pure typed-array code, shared by the desk and replay.
  - **Panel borders are walls:** everything outside the panels counts as solid, so a fill never
    leaks through a gutter even where the art is open. It traps 2 px under the border, which the
    gutter covers.
  - One cached line map per (walls, gap, threshold).
- **Colour tool, five kinds** (flyout or the context-bar switch):
  - **Bucket:** tap. Drag sideways before lifting to change what counts as a line (Procreate's
    threshold), with a live tinted preview.
  - **Drag fill:** sweep across areas; each one crossed fills, as one undo step.
  - **Enclose:** draw a loop, and every closed area inside it fills.
  - **Leftovers:** scrub over specks the fill missed; they take the colour around them.
  - **Auto flats:** click a panel; every closed area gets its own muted flat colour.
- **Settings:** Close gaps, Threshold, Grow/shrink (±px), and Walls (reference lines or all
  visible lines).
- **Check gaps (C):** red rings mark open line ends, meaning ends with nothing within
  gap-closing reach (the same rule the fill uses). Hovering previews what a tap would fill.
- **Data:** every kind is stored on the fill and replays exactly. New optional fields:
  `threshold`, `grow`, `refer`, `exact`, `lasso`, `leftover`. These are validated by the schema;
  older fills are unchanged.
- **Checks:**
  - Typecheck, build, 270 tests (walls, threshold, gap closing, grow/shrink, enclose, flats,
    leftovers, open ends, a corner, a loop, schema round-trip).
  - Browser: the auto-flats pass, the gap check after the corner fix, and the threshold drag.
  - Test marks were removed afterwards.
- **Not done:**
  - Re-flooding flats automatically after an ink edit. "Rebuild from strokes" redoes all of
    them.
  - Line extraction for scanned art (waits on image import).
  - Select by line or colour (no selection tool yet).
  - Moving fill work to a Web Worker. Flats on a big panel take about 0.5 s on the main thread.

## Vector pen (EXPLORE-DESK-UI step 4), 2026-11-10

- **Vector layers** (`layer.vector`): an ink layer whose lines stay editable. Its bitmap is only
  a cache, redrawn from the strokes after every edit (one outline fill per line, fast). Fills,
  exports and 2Dope read that bitmap as usual (one renderer).
- **Vector pen (V):**
  - Draws with the current ink brush's size, pressure and taper, as a smooth outline (2Dope's
    vector renderer, ported in `render/vector.ts`).
  - Stabilize, Correct, QuickShape and rulers all work with it.
  - With "Panel under pen" it makes a "Vector ink" layer in the panel's group, and raster tools
    never draw on it.
- **Edit lines (A):**
  - **Pull:** drag a line to pull it into shape, with a smooth falloff. Reach is adjustable.
  - **Click** a line to select it. The selected line can be made thinner or thicker, smoothed,
    simplified (drops points it doesn't need), set back to an even width, or deleted (Del).
  - **Thicken / Thin:** brush over lines to change their width just there. The change is stored
    per point.
- **Vector eraser** (Eraser → Vector), Clip Studio's three modes via 2Dope's `vectorcut`:
  - **Touched part:** cuts only where the eraser crosses.
  - **To crossings:** removes the piece up to the nearest crossing lines, which cleans up
    overshoots.
  - **Whole line:** removes any line the eraser touches.
  - Cut ends stay square instead of re-tapering.
- **Data:** each stroke can now store `pw` (width per point) and `flat` (square ends). These are
  validated, and every edit is one undo step.
- **Checks:**
  - Typecheck, build, 280 tests (hit testing, point insert, pull falloff, width brush, simplify,
    smooth, all three eraser modes, square ends, schema round-trip).
  - Browser: drew a vector line, then pulled, thickened and cut it. The cut pieces were saved
    with square ends, and all four steps undid cleanly.
- **Not done:**
  - Converting a vector layer to raster (or back).
  - Vector lines on pencil layers from the pen. Only ink is offered.
  - Moving or transforming whole lines (waits on the Select/Transform tool).
  - SVG export of vector ink.

## Print kinds, Export center and the Gutters group, 2026-11-11

- **Print kinds** (`geom/printkinds.ts`): 25 labelled presets (US comic, trade, 6×9, manga
  digest/B6/A5, BD album, magazines, zines, mini-zine, picture books, strips, webtoon,
  carousels, cards, postcards, posters), each with trim, bleed, safe area, binding, suggested dpi
  and reading direction.
  - Set in the **Print desk** and stored as `book.print`.
  - Bleed, safe area, binding, where blanks go, and right-to-left can each be overridden.
  - Pages resize to a new kind **only while nothing is drawn** (cuts and balloons scale; one undo
    step). Drawn books keep their size, and the dialog says so.
- **Page count:** saddle stitch needs a multiple of 4; perfect and hardcover need an even number.
  Blank pages are added automatically, with a plain-words warning. They go at the end, before
  the back cover, or after the cover.
- **Export center**, tab **Print it**: a page-order preview with blanks marked, and preflight
  warnings from every page.
  - **Print shop:** a PDF of single pages with bleed (edge pixels stretched), crop marks, and
    TrimBox/BleedBox set.
  - **Print-on-demand:** the same with no marks.
  - **Home booklet:** Letter or A4 sheets imposed for fold-and-staple, with an instruction page
    (duplex, "flip on short edge").
  - **Mini-zine:** 8 pages on one sheet with fold and cut lines, plus folding steps.
- **Export center**, tab **Export files:**
  - **Page images:** PNG, JPG or WebP, finished or as separations (inks / colours / pencils /
    lettering only). Options: white or transparent, colour / grey / hard-black inks, panel
    borders on inks, page range, dpi.
  - **Every layer separately:** `page / group / layer` PNGs plus lettering.
  - **Reader spreads PDF**, plus the CBZ, `.2dope` and `.inkflo` exports as before.
- **PDF writer** (`io/pdf.ts`): small, lossless (Flate), compresses each page as it goes.
  Checked in a test for valid xref offsets and stream content.
- **Gutters group** (borderless panels): every page now has a **Gutters** group.
  - A mark that starts in a gutter band goes there.
  - Its layers show only inside the gutter bands (the same bands the gutter paper fills), so
    with borders at 0 the gutter art meets the panel art.
  - The mask (◫) can be turned off. Fills work in the gutters, with the panels as walls.
  - The 2Dope export puts gutter art on the paper layer.
- **Checks:**
  - Typecheck, build, 291 tests.
  - Browser:
    - The booklet, shop and mini-zine PDFs were generated and checked byte by byte (no files
      downloaded). The mini-zine was viewed and is laid out correctly.
    - A thick stroke in a gutter showed only in the band and not in the panels beside it. All
      test edits were undone.
- **Not done:**
  - Resizing drawn pages.
  - Cover and spine PDF.
  - Creep compensation in the booklet output (the maths exists).
  - 1-bit TIFF and ORA.
  - SVG lettering.
  - Webtoon slicing.
  - Fonts are standard Helvetica in instructions only.
- **Reference notes:** `docs/SANTORO-NOTES.md` covers ideas from the Santoro handbook and a
  layout template set (clean-room: ideas only, nothing shipped).

## Composition and two-ink tools

- **Display → Composition guides** offers centre and diagonals, rabatment squares, full
  construction, thirds, and golden section in Layout, Draw and Caption. Draw can snap a
  stroke started near a straight guide line. Guides stay on screen.
- **Spread** on the Book screen and desks shows the finished reader view, with the cover
  alone, manga direction, and optional composition guides across both pages. Open either
  page directly from the preview.
- **Layout → Grid settings** saves weighted rows and columns as page guides, carves every
  cell, or sets a recurring book grid for empty and new pages. The Knife can snap to a
  guide. Mark a downbeat panel and check centre crossings, with a stagger fix for a simple
  four-panel cross.
- **Script** links a reveal to its setup. Layout and print preflight surface pacing warnings.
  Moving a reveal from Script is available before either page has layout, lettering or art.
  The Webtoon warning estimates one phone screen from panel positions.
- **Script → Show notecards** provides sketchable beat cards that can be reordered by drag
  or with arrow buttons. Sketch proportions can be checked against the assigned panel.
- **Export files → Two-ink print** includes a tint chart and overprint proof. It produces
  two continuous-tone grayscale plates, a color proof and print notes in a ZIP. Plates
  carry the selected PNG resolution. Physical press calibration and screening are external.
- Books saved with these tools use schema 4. Older book files open in the current build.

## Layered handoff, brush controls and script dialogue

- **Export → Open in another app** writes one layered PSD for a single page or a ZIP of PSDs
  for a range. Keep artwork preserves the named groups, clipping appearance, opacity,
  visibility, paper, borders and rasterized lettering. Drawing template keeps the layout
  and lettering and adds blank Pencil, Ink and Colour layers in masked panel groups.
  Use Procreate Gallery → Import for layered PSDs. The .inkflo book retains editable
  panel cuts, vector strokes and lettering.
- **Draw** has vertical Size and Opacity controls with exact number entry. Brush sizes in
  points use a logarithmic slider and the same limits as the keyboard shortcuts. Brush
  settings are remembered on the device. Stroke opacity is stored with the drawing.
- **Script → Dialogue & panels** and **Caption → Script dialogue** share the same editor.
  Each line can be assigned to a panel and a preset. Caption can generate starter placement
  once or auto-letter missing lines as the script changes. Reordering keeps each balloon
  linked to its original line. Save a preset in Caption and assign it to a line or to a speaker.
- Books saved with these tools use schema 5. The current build opens earlier book formats.

## Page templates, placed artwork and desk refinements

- **Layout → Page templates** previews built-in layouts and saves a custom page layout
  on this device. **Book → From template** creates a new page from it. Cuts scale to the
  destination trim, and the page keeps its own script, lettering and art when applying a template.
- **Draw → Place image** imports PNG, JPEG and WebP as artwork or reference layers.
  Position image supports dragging, corner resize, rotation, and Fit or Fill. The source
  bitmap and placement survive undo, reload and .inkflo export/import. Print preflight
  checks the resolution at the placed size.
- **Draw → Edit lines → Move line** moves an entire vector stroke without changing its shape.
  Escape and canceled pointer gestures restore an unfinished vector edit.
- **Desk navigation** includes a page picker and a reachable inspector on narrow screens.
  Script focuses new beats, Caption can find a balloon by its words, and the Print export
  checklist links to pages with warnings.
- Imported bitmap placement uses book schema 6. Earlier books still open in this build.

## Files

```
src/app/studio.ts        library, open book, one undo stack, autosave, .inkflo import/export
src/doc/                 model + book.json schema (validated, newer schemas refused)
src/geom/carve.ts        cuts → panels (ported from design/panel-carving.html)
src/geom/lettering.ts    script lines → balloons, reading-order check
src/geom/preflight.ts    print checklist
src/render/              the one page renderer + balloon lettering
src/draw/                residency, replay (strokes + fills), brush table
src/io/                  persist, autosave, capture, canvas codec, exports, to2dope
src/ui/                  home, book, desk frame, desks/{script,layout,draw,caption,print}, export dialog
src/engine/              vendored 2Dope engine (see 2DOPE-REUSE-INVENTORY.md)
```

## Known issues

- Reading order buckets panels by centroid rows, so a tall panel next to two short ones can be
  read out of the expected order (inherited from the prototype).
- Pages that have been drawn on stay in memory for the session (pixel undo needs their canvases).
  The memory budget does not apply to them.
- Autosave flushes on tab hide, but a hard reload within 400 ms of an edit can lose that edit.
- Lettering uses system comic fonts (Comic Neue / Comic Sans MS fallbacks); no font ships yet.
- Not tested on an iPad or with a real pen. Desktop Chromium only.

## Drawing gestures, panel movement and lettering transforms

- In Draw, keep holding a snapped QuickShape and drag to adjust it. Shift or a second finger
  constrains it. In Layout, holding the Knife straightens the cut so it can be aimed before release.
- Transform panels previews shared gutter movement on the page. Drag a gutter directly or drag
  a panel body along an axis with two movable boundaries. Panel-only cuts stay attached where
  possible, and the preview holds at the last valid layout when a move would collapse a panel.
- Select lines uses a rectangular or freehand selection on one vector layer. Drag to move, resize
  or rotate the lines, or use the flip controls. Shift constrains the transform and Alt resizes
  from the centre. Vector transforms retain pressure and brush colour.
- Ink and Vector pen accept a custom colour. The eyedropper can also set ink or fill colour from
  the visible art. Pencil still uses the blue sketch pass.
- Caption has edge and corner handles, a centre or opposite-edge anchor, and on-canvas and
  numeric rotation. The tail tips stay at their page positions. Rotation is saved with the letter
  and carried into print, layered images and 2Dope exports.
- New G-pen strokes use a lighter pressure curve, shorter built-in tapers and the preset's
  smoothing mode. Older strokes keep their original brush settings. Physical stylus feel still
  needs a side-by-side tablet check.

## Layout gutter cleanup

- Gutters follow the actual shared panel boundaries in the workspace, fill masks and exports.
  Older cuts can contain extra tails or disconnected strokes. Those parts are hidden on open.
  Layout's inspector can remove completely unused cuts in one undoable edit.
- The Knife previews the boundaries it can create. Panel only stops at the starting panel's
  edges. Even out is limited to straight grids, and curve changes and drags keep the existing
  panel divisions attached.

## Raster selection

- **Draw → Select pixels** (`R`) lifts pixels from one paint layer with Rectangle or Freehand.
  Drag inside the frame to move, use the handles to resize or rotate, or use the flip buttons.
  Apply commits the whole preview as one undo step. Cancel or Escape discards it.
- The layer keeps the transform in its paint history. A saved `.inkflo` and a layered PSD use
  the applied layer pixels, and **Rebuild from strokes** replays the edit on stroke-based layers.

## QuickShape editing after pen-up

- Hold to snap a line, rectangle or ellipse, lift the pen, then choose **Edit shape**. Drag a line
  endpoint, rectangle corner or ellipse edge. Use the center handle to move the whole shape.
- Shift constrains the angle or proportions. **Keep round** makes an ellipse a circle and keeps
  it round while resizing. Apply shape makes one undoable edit, and Cancel leaves the snapped
  stroke in place. This works with raster brushes and Vector Pen.

## Smudge and drawn balloons

- **Draw → Smudge** blends pixels on one paint layer with Size and Strength controls. Stylus
  pressure modulates strength. A stroke is one undo step. Smudges replay with raster transforms,
  save in book schema 7, and appear in the same layers in PSD exports.
- **Caption → Draw balloon** accepts closed outlines independently from click-to-place lettering.
  The start marker helps close the stroke. Open gestures leave no balloon. **Keep drawn outline**
  preserves the hand-drawn contour as a custom balloon.

## Caption groups

- The **+** beside a selected balloon adds a continuation to the same dialogue line. Use
  **Split words into next balloon** to continue existing words from the cursor.
- Continuations can merge, sit underneath the preceding balloon, or remain separate.
  Each balloon can move on its own and have its own tails. Shift-drag moves the whole group.
- Groups stay linked to the first balloon's panel and script line. Layered PSD export puts each
  dialogue group on one named layer under Lettering. 2Dope exports grouped dialogue as one
  rendered layer so it retains the joins and stacking.

## Storyboard and vertical comics

- Script opens in storyboard view. Cards show the planned panel or a saved sketch, scene
  description, and ordered dialogue with a balloon type per row. Add a dialogue row after
  any existing line or insert a panel after any card. The beat list remains available.
- New vertical comic starts a phone-width book. Send to Layout stacks beats in one column.
  Scroll preview shows a continuous phone-width view, and Export → Vertical scroll
  packages numbered 800 × up to 1280 PNG strips, a responsive static reader, and episode.json.
- Layout defaults to white gutters and offers transparent or custom paper. Set a page corner radius
  or override it on an individual panel. Curve edges edits the two Bézier handles on a shared gutter, and Knife
  resamples freehand cuts to reduce small pen wobbles.
