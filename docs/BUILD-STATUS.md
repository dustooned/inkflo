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

- Pages that have been drawn on stay in memory for the session (pixel undo needs their canvases).
  The memory budget does not apply to them.
- Autosave flushes on tab hide, but a hard reload within 400 ms of an edit can lose that edit.
- Lettering uses system comic fonts (Comic Neue / Comic Sans MS fallbacks); no font ships yet.
- Not tested on an iPad or with a real pen. Desktop Chromium only.

## Drawing gestures, panel movement and lettering transforms

- In Draw, keep holding a snapped QuickShape and drag to adjust it. Shift or a second finger
  constrains it. In Layout, holding the Knife straightens the cut so it can be aimed before release.
- Resize gutters previews shared gutter movement on the page. Drag a gutter directly or drag
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

## Script and vertical comics

- Script uses an ordered beat list for scene descriptions and dialogue. Use Dialogue & panels
  to assign script lines to panels and sync balloons.
- New vertical comic starts a phone-width book. Send to Layout stacks beats in one column.
  Scroll preview shows a continuous phone-width view, and Export → Vertical scroll
  packages numbered 800 × up to 1280 PNG strips, a responsive static reader, and episode.json.
- Layout defaults to white gutters and offers transparent or custom paper. Set a page corner radius
  or override it on an individual panel. Curve edges edits the two Bézier handles on a shared gutter, and Knife
  resamples freehand cuts to reduce small pen wobbles.
- **Transform panel** (V) moves, scales, and rotates individual panels and their artwork.
  Drag a handle beyond the trim to extend the panel into bleed. The finished page clips at
  trim and the print PDF renders the portion within the configured bleed. Reorder overlapping
  transformed panels from the toolbar. **Resize gutters** (R) adjusts shared cuts.

## Brush imports, vector points and screentone

- **Draw → Brush picker → Import brush** accepts Photoshop `.abr`, Clip Studio `.sut`, and
  PNG/JPG/WebP tips. ABR imports supported computed and sampled shapes and their editable settings.
  SUT imports basic brush settings and available embedded tip PNGs. Multiple SUT tips become
  separate brushes. Source-app effects such as ribbons, dual brushes and mixers are approximated
  or omitted. Use an original ABR or PNG tip for SUT files that reference an external material.
- **Brush Studio** edits tip and grain images, spacing, scatter, flow, opacity, taper, smoothing,
  and size/flow/opacity dynamics. Imported presets live under My brushes on the device. An
  `.inkflo` backup carries the brushes used by its strokes, so finished strokes survive preset edits.
- **Vector pen** has a separate brush slot. **Edit lines → Points** drags individual points,
  inserts with Shift-click, and removes a selected point. The width brush also works on simplified
  straight segments. Vector eraser's **To crossings** trims overshoots.
- **Screentone (T)** applies an editable layer to a panel or a lasso region. Choose a preset or
  adjust shape, density, LPI, angle and color. Edit via the selected tone or its Layers menu.
  Tones remain editable in `.inkflo`; PSD, print and web exports render their appearance.

## Off-page Knife and drawing controls

- **Knife → Across page** starts and ends on the board outside the trim. **One panel** takes
  the first complete panel crossing. Hold or use Shift for straight cuts, and **Fit page** restores
  space to start a swipe after zooming or panning.
- Panel borders stop short of the trim by default. Turn on **Borders reach page edge** in Layout
  to restore edge-to-edge inking. Display settings remember **Board brightness** and **Grid strength**
  on each device.
- Draw puts Brush, Smudge and Eraser first, groups vector tools, and keeps stabilization,
  correction and QuickShape in **Stroke**. **Actions** contains image placement, symmetry and
  Adjustments. Raster symmetry supports vertical, horizontal, quadrant and radial modes around the
  page center. Hue, saturation, brightness and Gaussian blur apply to an unlocked paint layer
  with one undo step. Touch on the board pans, and adding a second finger there zooms around
  the gesture.
- **Clone** samples an area of the same paint layer. Tap **Set source**, pick the source area,
  and brush the copy into place. The stroke can be undone and replayed.
- **Transform**, **Select lines**, and **Screentone → Selection** share rectangle, ellipse,
  freehand, polygon and magnetic lassos. Tap polygon corners and close at the first point or
  press Enter. Magnetic follows nearby contrast and alpha edges while staying close to the swipe.
  Pixel transforms offer freeform and uniform scale and an option to keep the original pixels.

## Touch workspace and book assets

- Draw's **Simple / Studio** switch expands the canvas, keeps primary tools in the rail, moves
  advanced tools under **More**, and puts size and opacity below the artwork. Layers and Assets
  remain accessible above the canvas.
- Draw, Layout and Caption share pinch zoom and two-/three-finger undo/redo taps. A second
  finger during pen drawing can still constrain QuickShape. **Draw with finger** in Display
  switches finger input to navigation on the Draw desk.
- **Assets** holds a book-wide library of PNG, JPEG and WebP imports. Place an image on any page
  as artwork or reference, copy the library from another local book, or transfer it in an
  `.inkassets` pack. Individual images can be downloaded as PNG. The `.inkflo` backup includes
  library images, including assets that have yet to be placed.
- Interface references: the local Procreate and 2Dope interface archives, and the official
  [Clip Studio tablet interface](https://help.clip-studio.com/en-us/manual_en/090_tablet/Tablet_interface.htm)
  and [Simple Mode workflow](https://help.clip-studio.com/en-us/manual_en/090_tablet/Using_Simple_Mode.htm).

## Focus and Simple canvas chrome

- Focus separates page navigation and document actions from the clustered tool rail. Simple shares
  that layout with a shorter Draw tool list. The active tool uses the second toolbar row, and
  the document overflow keeps paging, desk switching, preview and workspace controls accessible.
- The brush sidebar mirrors with the device's handedness setting. Focus can hide chrome after
  3.5 seconds of inactivity. Pin interface keeps it visible. The message line shows Draw hints.
- Adjustments and Brush Studio share a keyboard-accessible settings card. The Studio workspace
  retains its docked controls.

## Canvas navigation

- Pan, pinch to zoom, and twist the page with two fingers in Layout, Draw, Caption, and Print.
  On a mouse, drag with Space or the middle button to pan, use Ctrl or Command with the wheel
  to zoom, and use Alt with the wheel to rotate around the pointer.
- The Canvas view control shows zoom and angle and opens sliders, quarter turns, and Fit page.
  Press 0 to restore the upright fit. View changes are local to the open desk.

## Panel, layer and lettering polish

- **Transform panel** offers One panel and All panels scopes, larger handles and a trim/bleed
  preview while dragging. Alt-click cycles overlapping panels. The panel picker works with touch.
- The Draw Layers tray shows thumbnails for painted layers, placed images and screentones.
  Its targeting control shows whether strokes follow the panel under the pen or a selected layer.
- Caption's **Add to caption** menu offers three balloon connections and an extra tail.
  **Move whole group** works without a keyboard, and **Script panel** can reassign linked dialogue.
- G-pen pressure offers Light touch, Balanced and Firm in the Draw toolbar. Balanced uses the
  existing preset, and each stroke carries the settings used when it was drawn.

## Starter comic and script revisions

- **Open starter comic** makes an independent copy of *The Last Train* and opens Script.
- **Caption → Review script changes** shows linked lettering beside the revised script. Apply
  wording preserves placement and tail geometry. Keeping the current lettering dismisses that
  revision until the line changes again. Reassigning the line moves its balloon group.

## Export for drawing, 2026-11-13

- **Layout** and **Caption** have an **Export for drawing** button in Studio and an action in
  Focus (in the ⋯ overflow when the bar is full). It opens the Export center's renamed
  **Export for drawing** tab with the range set to the page open in the desk.
- Before download the tab shows the page or range, trim size (no bleed), pixel size at the
  chosen dpi, the file name and what the chosen mode contains. It updates with mode, dpi and
  range. Pages too large for browser export disable the download.
- One page downloads `<book>[-template]-page-N.psd`. A range downloads
  `<book>[-template]-pages-A-B.zip` with `page-00N.psd` files inside.
- `psdPlan` in `io/psd.ts` builds the summary and file name and is covered by `psd.test.ts`.
- **Checks:**
  - 353 tests, typecheck and production build.
  - Browser (Chromium, the starter comic plus a blank page 2): the shortcut opened from Layout and
    Caption in Studio and Focus, and from the original Export center tab, each defaulting
    to page 2. The preview updated after changes to mode, dpi (300 → 150) and range (1–2).
  - PSD decoding (ag-psd, in the page, no downloads): both modes at 994 × 1528 px at 150 dpi.
    Keep artwork had populated Ink layers in both panel groups. Drawing template had blank Pencil,
    Ink and Colour layers and a group mask for each panel. Lettering was a separate layer in the same
    position in both. The range ZIP held `page-001.psd` and `page-002.psd`. The book JSON was
    unchanged after export.
  - Panel 2 was rotated 10° and moved on an in-memory copy. Decoded layers, flattened back to
    front, matched the renderer composite with no pixel channel off by more than 64/255. Only
    0.09% of pixels were off by more than 8/255, at anti-aliased edges. The template mask
    matched the moved panel's pixel bounds.
- **Not checked:** how Procreate, Photoshop, Affinity and Clip Studio Paint apply the group masks.
  The dialog says to check clipping in the target app.

## Bucket fills stop at panel seams, 2026-11-13

- Carved panels share their cut edge, so the old fill walls (everything outside the panel union)
  left neighbouring panels connected. A bucket fill ran across the cut and around ink that left
  the page or stopped short in the next panel. `panelSeams` in `draw/fillkit.ts` now makes the
  pixels where two panels meet a wall, except in the Gutters group, which fills its own bands.
- Checks: a new test in `fillkit.test.ts` (fails on the old walls). In the browser, a stroke that
  started off the page across panel 1 into panel 2 now splits panel 1, and the fill stays in it.
- Saved colour pixels are not refilled, so fills made before this change keep their old shape.

## Draw tools on moved panels, 2026-11-13

- A moved, rotated or scaled panel keeps its art where the panel was carved and draws it
  through the panel matrix. Brushes, fills and line edits already mapped the pointer back.
  **Select lines**, **Transform** (pixel selection), **Smudge** and **Clone** did not, so on a
  placed panel they selected, moved or smudged the wrong place.
- `ui/placement.ts` maps page points to a layer's source space and draws selection frames
  through the panel matrix. The three tools now:
  - map the marquee into source space before selecting strokes or lifting pixels;
  - grab, move, resize and rotate in source space, so pixel transforms and smudge/clone
    points are stored where replay applies them;
  - draw the selection frame rotated with the panel.
- **Checks** on the starter page with panel 2 rotated 15° and moved, using pointer events in Chromium:
  - A pixel marquee drawn around the visible lines lifted panel 2's Ink. Dragging it 0.5″ moved
    the visible art exactly 0.5″ on the page. Undo and redo restored and reapplied it.
  - **Rebuild from strokes** put the moved ink in the same box. The pixel differences
    were inside the strokes.
  - A horizontal smudge drag was stored rotated −15° and maps back to horizontal on the page.
  - **Select lines** found a vector stroke from a page-space marquee that does not overlap
    its stored position, and a 0.3″ drag moved it 0.3″ on the page.
  - The bucket in panel 2 filled only panel 2's area.
  - The layered PSD of the page flattened back to the renderer composite (0 pixels off by more
    than 64/255).
  - 356 tests, typecheck and build. `placement.test.ts` covers the mapping.
- **Not checked:** polygon and freehand marquee shapes specifically (they share the same
  path), clone with a source point, and scaled panels in the browser (unit test only).

## Interface cleanup, 2026-11-13

Measured against `docs/research/procreate-ui-style.md` (one bar row, 8/14 px gaps, a single
tool-options row, a popover for choices):

- **Header:**
  - Buttons no longer wrap to two or three lines.
  - Layout and Caption now have one **Export ▾** menu, with Export files and Export for drawing,
    instead of two wide buttons.
  - Below 1100 px the crumb drops the book title, so "Page 1 / Draw" always shows.
  - On a phone the header is one sideways-scrolling row instead of four stacked rows.
  - The book view's spacer works again, Delete sits beside Rename instead of next to
    Continue, and "1 pages" reads "1 page".
- **Tool rail:**
  - The vertical scrollbar took about 15 px of the 64 px column. It is hidden, which removes the
    clipped labels ("Screenton e") and the stray horizontal scrollbar.
  - Labels are sentence case at 10 px.
  - The more-options marker moved to the top corner.
- **Tool options (Studio):**
  - One row instead of two or three, so changing tools no longer moves the canvas.
  - When the row is full, it scrolls with the mouse wheel and fades at the cut-off edge.
- **Smaller fixes:**
  - Thin themed scrollbars.
  - A disabled primary button now looks unavailable instead of selected.
  - Menu rows have a second line.
  - The Layers chevron sits on the text line.
  - Lock and eye icons are monochrome instead of colour emoji.
  - The Export center tab row stays visible while its content scrolls.
- **Checks:**
  - Chrome at 958 × 916: every desk, the Export menu and dialog, the Layers popover, light
    and dark themes. No header overflow.
  - DOM checks at 375 px: no page overflow on any desk or the book view; the header is 52 px.
  - 356 tests, typecheck and build.
- **Not changed:** Focus and Simple chrome, the Draw inspector's duplicate Layers and
  Adjustments buttons, and the four-surface split (card, toolbar, popover, panel) from the
  research spec.

## Icons, tooltips and the canvas menu, 2026-11-13

- **Icons** (`ui/icons.ts`): an original 24 px line set (about 90 icons), drawn for inkflo.
  - They are looked up by each control's visible label, so tool and action definitions are
    unchanged. Labels without an icon keep their text glyph.
  - Covered: the tool rail, tool flyouts, More tools and Customize, the desk switcher, header,
    Focus bar, tool-option buttons, inspector buttons and menu rows.
  - Spread, Simple / Studio, Mark done and Inspector are icon-only in the header. Their name
    stays as the aria-label.
- **Tooltips** (`ui/affordances.ts`):
  - Any control with a title or aria-label shows a styled tip after 450 ms hover, or on
    keyboard focus. Rail tips appear beside the rail.
  - Titles become `data-tip`, so the browser's own tooltip doesn't show as well. A button that
    had only a title keeps it as its aria-label.
- **Right-click on the canvas** (`DeskMode.contextMenu`):
  - **Draw:** pick colour here, Brush / Pencil / Eraser / Colour / Select lines / Transform,
    show pencil, Layers.
  - **Layout:** each cut tool, Page templates, Even out.
  - **Caption:** on a balloon, selects it and offers joined balloon, add tail and delete. Anywhere,
    places any balloon kind at the pointer, plus Select, Script dialogue and Style sheet.
  - **Every desk:** Undo / Redo (disabled when unavailable), Fit page, Reset rotation,
    Focus/Studio layout, Export for drawing (Layout, Caption) and Export.
- **Header:** when full, it scrolls sideways at any width, with the wheel and a fade, instead of
  pushing Mark done and Export off-screen (seen at 662 px).
- **Checks:**
  - Chrome at 662 px: every desk's menu; Add tail then Undo from the menu (tails 1→2→1);
    tooltips on the header and rail; Focus bar icons; Export reachable in the header.
  - `icons.test.ts` checks that every label maps to a drawn icon. 358 tests, typecheck and build.
- **Touch:** holding one finger still for 550 ms opens the same canvas menu. Moving more than
  10 px, lifting early or a second finger cancels it, and the held press never reaches the tool.
- **Keyboard:** in any menu, Up and Down (wrapping), Home and End move between enabled rows.
  Escape closes the menu.
- Checked with synthetic touch and key events in Chromium: hold opens the menu without cutting,
  a moved press and a quick tap do not open it, and the keys move focus as described.

## Draw sidebar, compact chrome and follow-up checks, 2026-11-13

- **Draw sidebar:** the Studio inspector now docks the Layers panel itself instead of a second
  Layers button, with Adjustments and Place image below it. It shares state with the tool-bar
  popover; switching to Selected layer in either updates both.
- **Focus / Simple:**
  - The size/opacity column no longer scrolls sideways or clips its unit. The unit is in
    the field's tooltip.
  - Customize tools has its own icon instead of a second "⋯".
- **Checks** on the rotated (15°) and scaled (1.25×) panel, using real pointer events:
  - Polygon and freehand marquees lifted the panel's ink. Polygon closes by clicking the first
    point, the Close polygon button, or Enter.
  - Clone stored its path and source in the panel's space: a horizontal drag stays horizontal
    on the page, and the brush size is divided by 1.25. Undo removes it.
- **Gutter strip:** measured, and it isn't there. Each fill already reaches one pixel across a
  shared seam, so borderless neighbours leave no unpainted line. No change.
- **Rebuild:**
  - Deterministic: two rebuilds match exactly.
  - On the starter it draws the same shapes but anti-aliased, where the saved starter bitmaps
    have hard edges. That accounts for the pixel difference seen earlier; nothing is misplaced.

## Knife cuts from inside the page, 2026-11-13

- The Knife refused any stroke that did not start and end beyond the trim (Across page) or
  outside the panel (One panel). A line drawn on the page did nothing, which read as a broken
  Knife.
- A stroke is now planned as drawn first, so off-page swipes behave exactly as before. If that
  fails and an end lies inside the page, the ends continue straight outward:
  - **Across page** cuts every panel along the line, from page edge to page edge.
  - **One panel** cuts only the panel the line was drawn in.
  - Taps and tiny flicks are still ignored. Hints and the error text describe the new behaviour.
- **Long press no longer swallows a slow cut.** The menu opens after a still hold, but moving
  on closes it and the swipe continues. Only lifting in place keeps the menu, and that press
  doesn't tap.
- **Checks:**
  - `carve.test.ts`: inside, half-inside and off-page strokes; One panel inside a lower panel;
    a tiny flick is refused.
  - Browser, with real pointer events: a mouse line inside the page cut 0 → 6.625″; a touch hold
    of 650 ms then a swipe cut with no menu left open; hold then lift opened the menu without a
    cut; One panel split one panel (6 → 7).

## Knife Auto Shape, 2026-11-13

- Hold at the end of a knife stroke (Auto Shape on) and it snaps to a **straight line**, an
  **arc**, a **zig-zag** or, failing those, a **smooth curve** with the hand wobble removed
  (`geom/cutshape.ts`). Keep holding and drag to adjust: the start stays put and the end follows
  the pen. A hint names the shape.
- Recognition reuses QuickShape in screen pixels. A cut counts as straight only within 3% of its
  length (QuickShape's 7% swallowed shallow zig-zags across a page), and a zig-zag needs corners
  that survive a 1% tolerance, so gentle waves become smooth curves.
- The page's **Curve** setting still rounds cut corners; set it to 0 for sharp zig-zags.
- Checks: `cutshape.test.ts` (7 cases). Browser: a wobbly bow became an edge-to-edge arc (0.2°
  maximum turn between segments, against 3.6° without the hold); a held line aimed lower; a
  zig-zag across the page snapped to Zig-zag.

## iPad responsiveness, 2026-11-13

Reported: serious lag on iPad everywhere. Nothing loops while idle (no animation frames, one
timer in 3 s), and desktop script time per frame is small, so the fixes target GPU work that
an iPad pays for on every frame:

- **Screen resampling:** `renderPage` drew every scaled 300 dpi layer plane with
  `imageSmoothingQuality = 'high'` on every frame. The screen now uses 'low' while a stroke, pan
  or pinch runs, and one 'high' frame follows when it ends. Exports still use 'high'
  (`RenderOptions.smoothing`).
- **Hover frames:** pointer hover, including Apple Pencil hover at 120 Hz, redrew the whole
  page. Hover now redraws only overlays over a cached copy of the settled page: one blit at
  0.1 ms, measured. A mode that changes what the page shows still requests a full frame. The
  fill tool's gap-check preview now asks for one when it clears.
- **Touch devices (`pointer: coarse`):** no backdrop blur on Focus/Simple surfaces (it had to
  re-blur the canvas behind it every frame), no edge-fade masks, no tooltip animation, no
  grayscale filters on layer icons.
- **Checks:** 367 tests, typecheck and build. In Chrome: hover frames 1 drawImage, stroke frames
  use 'low', a real stroke draws and undoes, and the page renders correctly after hover.
- **Not measured on an iPad.** If it still lags, the next suspects are the canvas size at 2×
  on large iPads, and autosave encoding big planes after each stroke.

## Scroll page-break art, 2026-11-13

- **Export center → Vertical scroll → Page-break art:** pick a book image or add one. It's drawn
  in the break after each page: full strip width or actual size, centred in the gap, and
  optionally after the last page as an episode footer.
- The break is copied into the strips row by row like a page, so art that straddles two strip
  images lines up exactly when the web reader stacks them.
- The tab shows a live preview of the first pages with their breaks (`scrollPreview`).
- Checks: `scroll.test.ts` covers sizing and break heights. In Chrome, a 400×60 banner after a
  1230 px page gave 1350 px of strips, split 1280 + 70 across the boundary. The preview showed
  the banner.

## Collage cut-outs, 2026-11-13

- **Draw → Position image → Collage** (image inspector):
  - **Cut out piece:** draw a freehand loop around the part to keep. The cut is stored in the
    image's own units (`PlacedImage.cutout`), so it moves, scales and rotates with the piece. The
    source pixels stay whole, and **Reset cut** brings the full image back.
  - **Torn edge:** roughens the cut repeatably, like ripped paper.
  - **Paper edge:** a border of any colour around the piece.
  - **Duplicate piece:** copies the image layer and its cut, to paste up a zine page.
- One renderer: `drawLayerBitmap` draws the edge, then clips to the cut, so screen, PSD, print
  and scroll exports match.
- Checks: `collage.test.ts` covers units, torn path, clean-up and save/load. In Chrome, an image
  placed through the dialog and cut with a loop kept its centre and became transparent outside
  the cut; torn 60% and a 0.08″ edge rendered.

## Copy and paste everywhere, 2026-11-13

- **One clipboard** (`app/clipboard.ts`) for pixels (Transform selection), lines (Select lines),
  placed images with their cut, tear and edge (Position image), and lettering (a selected
  balloon with its joined group).
- **Ctrl/⌘+C and Ctrl/⌘+V** in the desks (not while typing), and **Copy** / **Paste here** in the
  right-click menu. A paste lands under the pointer on any page of any book.
- **System clipboard:** the copy is also written as an inkflo marker plus, for pictures, a
  PNG. Other apps get the image; another inkflo tab rebuilds the full piece. Pasting a picture
  from another app makes an image layer at 150 dpi; pasting text in Caption makes a speech
  balloon. If the browser blocks system access, the in-app copy still works in this tab.
- Pasted lettering gets new ids, keeps its joins, and is unlinked from the script. Pasted lines
  go to the target group's vector layer, created if needed. Moved panels are mapped both ways.
- **Checks:** `clipboard.test.ts`. In Chrome: a balloon pasted on the same page and into a second
  book at the pointer; outside text became a balloon; an outside PNG became a 2″ image layer;
  the cut collage piece crossed books with its cut, 60% tear and paper edge.
- **Not checked:** Safari's system clipboard, which needs the write inside the key gesture. The
  in-app copy covers same-tab use.

## Previews before you commit, 2026-11-13

- **Caption → Balloon:** the Kind dropdown is now a picker of drawn previews. Each kind is
  rendered by the page renderer in this balloon's font and colours. A row of **look presets**
  for the current kind (speech: Round, Squarish, Hand-drawn; shout: Burst, Sharp, Soft;
  thought: Fluffy, Cloud, Puffy; whisper: Round, Wavy) applies the settings in one click. The
  sliders stay for fine tuning (`ui/balloonswatch.ts`).
- **Lettering style sheet:** a live strip of Small, Body and Big in the house font at print size
  relative to the page, plus a balloon for each character style.
- **Export files → Page images:** thumbnails of the first page in the range for each ticked kind
  (finished, inks, colours, pencils, lettering), with the colour mode, background and borders
  applied. They refresh on every change.
- **Export for drawing:** a thumbnail of the first page, with the artwork, or the empty template
  of layout and lettering.
- The page-range fields in Export files stay on one line.
- Checks in Chrome: every preview rendered. Swatches are exempt from the icon decorator.
- **Caption fine-tuning:** the shape sliders sit under a **Fine-tune the shape** fold, below the
  picture presets, and the fold stays open while you adjust. New controls: **Spike depth**
  (shout), **Bump depth** (thought) and **Tail width** (all tails). Their defaults match the
  renderer (0.26, 0.16, 1.2).

## The manual, 2026-11-13

- `public/manual/index.html` is a standalone page served with the app at `manual/index.html`.
  It works offline, follows light and dark themes, prints cleanly, and has a contents sidebar
  and search.
- Eleven chapters follow the workflow: welcome and the five desks, Script, Layout (Knife, Auto
  Shape, grids and rhythm, panel tools), Draw (layers, tools, colour, tone, selection), Collage
  and zines, Caption (balloon kinds, style sheet, reading order), Print, Export (scroll and
  page-break art, Export for drawing), copy/paste and menus, keyboard shortcuts, a classroom
  guide and a glossary.
- Each chapter explains features with the craft and history behind them. Examples: studio roles
  and the pipeline; full script against the Marvel method; McCloud's closure and Eisner's
  sequential art; the nine-panel grid and the downbeat; non-photo blue and the G-pen; flats and
  four-colour printing; Ben-Day dots and screentone; zines from fanzines to riot grrrl and
  collage from 1912; hand lettering and all-caps; signatures and saddle stitch; risograph; and
  webtoons.
- **Manual** buttons: home screen, the `?` in each desk header (opens that desk's chapter), the
  Focus overflow menu, and **Open the manual** in the canvas menu.

## Outlines and smaller previews, 2026-11-13

- **Layer outline** (Layers → a layer's ⋯ → Outline): White, Black or any colour, 0–0.25″,
  around everything on the layer: ink, colour, placed images and collage pieces. It's a border
  effect like Clip Studio's, to lift art off busy backgrounds or ink a pasted photo.
  `Layer.outline` is drawn by the shared renderer (a cached silhouette dilation behind the art),
  so PSD and print exports match. Mid-stroke it draws without the outline to stay fast.
- The docked Layers panel's options use the same row styles as the popover.
- Previews are smaller: balloon swatches 58×36 and look presets 50×32, export thumbnails 72 px,
  scroll preview 140 px, rail icons 18 px.
- Checks: outline save/load test. In Chrome, a 0.1″ black outline turned the pixels just outside
  the cut piece black and left the rest alone, and the menu's White preset set the outline.

## Type frames for text-led pages, 2026-11-13

- **Caption → Type (X):** drag a frame of set text, or click for a ready-sized one, or
  right-click → Type frame here. Drag to move, use the corner to resize, and a red + flags overset text.
- **Inspector:**
  - Style presets: Novel body, Chapter opening, Title, Poem, Pull quote, Picture-book.
  - Text, typeface (system book faces: serif, Georgia, sans, typewriter; plus the bundled comic
    fonts), size, leading, tracking, bold, italic, capitals and small caps.
  - Alignment (left, centre, right, justified), vertical alignment, first-line indent,
    paragraph space, drop cap of 2–4 lines.
  - Columns 1–3, column gap, inset, rotation, background, delete.
- `render/typeset.ts`: a pure layout (`layoutType`, measured through a callback) with greedy
  wrapping, justification except on paragraph-final lines, column flow and overset, drop caps,
  and vertical alignment. Drawing goes through `renderPage`, after the art and before balloons,
  and follows the lettering switch, so exports and the lettering separation include it.
  `Page.texts` is validated with ranges in the schema.
- Manual: new **Outlines** and **Type frames** sections.
- Checks: `typeset.test.ts` (6 cases). In Chrome, a frame dragged out with a two-paragraph story
  and the Chapter opening preset set justified text with a 3-line drop cap.
- **Note:** book faces are the device's system fonts, so a page can set slightly differently on
  another computer. Bundled fonts are identical everywhere.

## Moved panels: gutters and slicing, 2026-11-13

- **Gutters:** a moved (transformed) panel was drawn at its full carved shape, which runs to the
  middle of each gutter. The Gutter slider had no effect on it, and sliced halves touched. Moved
  panels now inset half the gutter on every shared edge (page edges stay), like panels in place
  (`insetPanel`). The gap between moved halves follows the slider: 0.30″ → 0.61″ measured.
- **Slicing a moved panel:** the Knife planned against the panels' original positions, so a
  stroke through a moved panel cut something else. Half a sliced panel also lost the move and
  snapped back. A stroke over a moved panel (topmost under the stroke's midpoint) is now mapped
  into that panel's own space and cuts only that panel (`planKnifeCut(..., target)`). The new
  half gets a copy of the move, so both halves stay where they were drawn. Straight
  (Shift) strokes use their true midpoint.
- Checks: two `carve.test.ts` cases (gutter-following inset; slice keeps both halves moved with a
  gutter between). In Chrome, a vertical slice through a rotated lower panel split it in place,
  left the upper panel alone, and kept both halves rotated.

## Comic strips and Artist marks (in progress), 2026-11-13

- **Library → Comic strip:** 3 panels or 4 panels (13 × 4″ daily strip), or a stacked strip
  (new `stacked-strip` print kind, 4 × 12″). It opens in Draw with ordinary, editable cuts
  (`stripCuts`).
- **Artist mark:** `book.artistMark` names one book asset, stored once. `page.marks` holds
  placements (asset key, centre, width, hidden). Draw → Artist mark chooses or imports the mark
  and places it in the bottom-right safe corner; it can move, resize from its corner, snap to
  corners, hide or delete, all undoable. The inspector shows source px and dpi at the placed
  width, with a warning below the book's dpi. Assets → **Use as Artist mark**. Marks in use
  can't be removed from Assets.
- **Rendering:** marks draw above art and type, below balloons, and follow the lettering switch.
  Hidden marks are omitted everywhere, and separations leave them out. The PSD gets an "Artist
  mark" layer. Mark images preload when a book opens.
- **Not done yet:** explicit-reduction import flow, the single-strip Web image export,
  browser end-to-end checks of the acceptance list, and schema save/load tests for marks.
  Typecheck, 385 tests and the build pass; none of this is browser-verified yet.
- **Finished, 2026-11-13:**
  - **Web image export** (Export files → Web image): one page as a PNG. Pick the page, a width
    (Phone 1080, Web 1600, Large 2400 or custom) and see the pixel size, trim and a preview first;
    the actual file size shows after download. Over the browser limit it refuses with a fix.
    `io/webimage.ts`.
  - **Explicit reduction:** an image over 8192 px or 16 MP now asks before storing a working copy,
    naming both sizes. Cancel imports nothing, and the original file is never changed.
    Undecodable files get an actionable message. The image placement toast and inspector show
    the source size and the dpi at placed size, flagged below the book's dpi. All exports load
    mark images first.
  - Manual: a **Comic strips and your Artist mark** section.
  - **Checks:** `strip.test.ts` (5): strip cuts and order, mark save/load including hidden, bad
    keys refused, web sizing, working-copy size. In the built-in browser pane, with real
    pointer events (Chrome extension unavailable, so no screenshots):
    1. A 3-panel strip in two clicks from the library opens in Draw. Strokes stayed in panels
       1 and 3. A Layout gutter drag moved 4.33″ → 5.13″ and undo/redo worked. 4-panel
       (13 × 4″) and stacked (4 × 12″) strips were created, and a preset then undo went 2 → 3
       panels.
    2. A 240 × 120 transparent mark: imported, placed bottom-right inside the safe area, moved,
       corner-resized 1″ → 1.4″, two undos and redos. Hidden: 0 mark pixels in the page render
       and in the PNG (1446 when shown). The .inkflo export/reimport kept the key, placements
       and alpha (corner 0, ink 255). Assets → Copy assets brought it into another book.
    3. Phone PNG 1080 × 332 with the mark over visible paper; ink in panels 1 and 3 in order.
       Print-on-demand PDF TrimBox 936 × 288 pt (13 × 4″). The layered PSD has an "Artist mark"
       layer.
    4. A 120 × 80 image at 6″ warned "20 dpi … below this book's 300 dpi". A 9000 × 2000
       image asked first: Cancel left nothing; Reduce stored 8192 × 1820 with the original
       file unchanged.
    5. At 768 px (tablet), the strip dialog, Draw and the Export center had no overflow.
  - **Not checked:** physical devices and third-party apps, and pixels inside the print PDF (its
    trim was read, not its image).

## Cleaner PSD folders, 2026-11-13

- **Keep artwork** PSDs now contain only what has content. Empty folders (Over panels,
  Gutters, Background, panels with no art) and blank layers are left out, and so is an empty
  Lettering layer when a page has no balloons.
- **Moved panels** are one folder, "Panel N · beat (moved)", holding Border, Artwork and
  Panel paper, instead of loose border and paper layers at the top level.
- **Naming:** panel folders are always "Panel N", or "Panel N · beat" when the page has a beat;
  named groups keep their own names.
- **Drawing template** is unchanged in content (blank Pencil, Ink and Colour in every panel,
  masks kept), with the same naming.
- Checks: decoded three books in both modes with ag-psd. Flattening the layers matched the stored
  composite (0–34 px over 64/255, at anti-aliased edges), and the template panel folders keep
  their masks.

## Script as code and the Knife angle readout, 2026-11-13

- **Script → Cards / Code:** Code writes the whole page as plain text (`PANEL n: …`, `> more
  description`, `NAME: …`, `NAME (whisper): …`, `CAPTION:`, `SFX:`, `\n`, `# comment`).
  - A legend sits beside the editor. Syntax colouring comes from a highlighted layer under a
    transparent textarea.
  - Errors are listed in plain words, with click-to-line, and their lines are tinted.
  - A **Live** list shows the panels as read.
  - Text applies to the beats 250 ms after typing (existing beats keep their ids, and dialogue
    goes through `replaceDialogue`). Each pause of 1.5 s, or leaving the editor, is one undo
    step. The student's own text, comments included, is kept unless the script changes
    elsewhere.
  - `geom/scriptcode.ts`: pure parse/format with tokens and errors; it round-trips. The view
    choice is remembered on the device.
- **Knife angle:**
  - While cutting, a readout by the pen shows the angle (0° level, 90° upright) with a level
    reference and an arc (`ui/cutangleoverlay.ts`).
  - Straight cuts (Shift or a held Auto Shape line) click to 0/45/90/135° within 3°. With Shift
    they step by 15°. A snapped cut turns green and shows a guide across the page, and the
    saved cut uses the snapped end (`geom/cutangle.ts`).
- Checks: `scriptcode.test.ts` (5) and `cutangle.test.ts` (3). In the built-in pane:
  - Code view: typing a two-panel script updated the beats live with every token colour. A line
    before PANEL was flagged. The comment survived Cards ⇄ Code. One undo per pause (4 → 3 → 4).
  - Knife: a 14° Shift cut was saved at exactly 15°.
  - The readout, drawn offscreen, gave "37°", "27°" (leftward), green "0° level · 15° steps",
    and nothing for a too-short cut.
- **Not seen on screen:** the hidden pane doesn't run animation frames and Chrome was
  disconnected, so the live readout over the canvas wasn't screenshotted.

## Layout as numbers and code, and JSON for game makers, 2026-11-13

- **Panel numbers:** the selected panel (Resize gutters) shows position and size and has number
  fields for Move right, Move down, Turn and Scale, plus **Put back in place**. These are written
  as a panel transform about the panel's centre (`transformMatrix` / `describeTransform`).
- **Layout → Code** (tool bar): the sidebar, widened to 380 px, holds the layout as text: `gutter`,
  `border` (pt or in), `curve`, `round`, `cut x,y -> x,y [-> …] [bend a b]`, `keep <id>` for drawn
  one-panel cuts, and `panel N move x,y turn d scale k round r`.
  - It applies live once every line reads; a half-typed line leaves the page alone and shows a
    plain-word error.
  - Each pause is one undo step. Canvas edits rewrite the code, and comments survive while the
    page is unchanged elsewhere.
  - A live panel list shows size and position. `geom/layoutcode.ts` is pure and round-trips cut
    ids and transforms.
- **JSON** (`geom/pagedata.ts`): panels in reading order with polygons in inches and 0–1 page units,
  boxes, moves, descriptions and parsed lines (speaker, kind, text). Copy or Download from
  Script's and Layout's code views; Script also exports the whole book. The shared editor and JSON
  buttons are in `ui/codeeditor.ts`.
- Checks: `layoutcode.test.ts` (7). In the built-in pane:
  - Layout code on a 13 × 4″ strip: two cuts and a turned panel 3 gave 4 panels with gutter 0.3
    and border 3 pt. A half-typed `cut 1,1` was flagged and left the page alone. Undo and redo
    worked.
  - Panel 1's Turn field set exactly 10°, the cuts didn't change, and Put back in place removed only
    that panel's move.

## Game engine package, 2026-11-13

- **Export → Export files → Game engine package (.zip)** (`io/gameexport.ts`): page range, page width
  (1024 / 2048 / 4096 px) and dialogue format (Yarn, Ink or both). The option lists what's inside and
  counts pages, panel images and balloons before export.
- **ZIP contents:**
  - `manifest.json`: format `inkflo-game`, version 1, pixels with the origin top-left. Per panel:
    polygon, `norm` (0–1), box, centre, move/turn/scale, image path, description and lines. Per
    balloon: panel, kind, speaker, text, box, centre, tails and `after` for joined balloons.
  - `pages/NNN/page.png`, `art.png` (no lettering), `lettering.png` (transparent) and
    `panel-NN.png` (cut to the panel's shape, transparent outside).
  - `dialogue.yarn` (one node per page, `<<panel N>>`, kind hashtags, `<<jump>>`) and/or
    `dialogue.ink` (one knot per page, `#panel:N` tags, Ink-escaped text, `-> END`).
  - `README.md` with Unity, Godot 4 and Unreal loading notes.
- Lines come from Script. A panel with no script lines falls back to its balloons.
- `buildManifest`, `yarnScript` and `inkScript` are pure; balloon bounds use a passed-in measurer, so
  they're testable in Node.
- Checks: `gameexport.test.ts` (4). In the built-in pane, two pages at 1024 px gave 18 files (0.13 MB)
  that decoded correctly:
  - the balloon fell in panel 1 with a box and tail in px;
  - the lettering PNG was 99% transparent;
  - panel 1's crop was 256 × 316 px;
  - the Yarn and Ink text read correctly.
- **Not checked:** loading the package in a real Unity, Godot or Unreal project.

## Asset bins, 2026-11-13

- **Data:** `BookAsset.bin` (absent means Unsorted) and `Book.bins` (order, empty bins allowed).
  Both are validated in `doc/schema.ts`. The pure helpers in `geom/bins.ts` cover list, filter,
  move, rename (unique names), delete (images go to Unsorted) and reorder.
- **Draw sidebar:** a **Layers / Bins** switch, remembered per device. The image tool shows the
  bins under its options. `ui/assetbins.ts` is created once per desk, so scroll position and drags
  survive repaints.
  - Chips: All, each bin with a count, and **+**. Tapping the open bin opens its menu (rename,
    move left or right, delete). Search appears from 9 images.
  - Tap a tile to place it in the selected image's panel, or the page.
  - Mouse and pen drag after 6 px. A finger holds for 280 ms, then drags; moving earlier scrolls
    the bin. Hold and lift (or right-click) opens the tile menu.
  - A ghost follows the pointer. Dropping on the stage places the image at that page point
    (clamped to the page). Dropping on a chip moves it to that bin.
  - OS files dropped on the bins go into the open bin. Dropped on the page, they're added and
    placed at the drop point.
- **Placement:** `imagePlacement().placeAsset(asset, at, reference)` puts the image in the group
  under the point, maps it through a moved panel's transform, fits it to 70% of the panel and
  centres it on the drop point. Each placement is one undo step.
- Checks: `bins.test.ts` (5), including the book-file round-trip. In the built-in pane:
  - a mouse drag showed the ghost and the stage highlight and placed one layer;
  - a drop above the page was clamped to y = 0;
  - a tap placed into the selected panel;
  - a drag onto Unsorted moved the image, and undo restored it;
  - a touch swipe made no drag;
  - touch hold then drag placed the image;
  - hold and lift opened the menu.
- **Not checked:** a real finger on an iPad, and an OS file drop (synthetic DataTransfer only in
  code review). The hidden pane gave the canvas a 300 × 150 default size, so drop accuracy over
  a laid-out page was not measured on screen.

## Bins in Caption and Layout, 2026-11-13

- **One bin panel** (`ui/binpanel.ts`) now serves every kind of bin. A `BinSource` gives it
  read/write, an optional built-in bin, thumbnails, place, a menu, header buttons and file drops.
  The panel owns:
  - chips (All, the bins, built-in, +) and the bin menu (rename, reorder, delete);
  - search;
  - mouse and pen drag, and touch hold-to-drag, with the ghost and highlight;
  - hold-and-lift or right-click menus.
  `sideChoice(desk, label)` gives each desk's sidebar a "<label> / Bins" switch. The setting is
  stored in `inkflo:side:<desk>`; Draw's old `inkflo:draw-side` key is no longer read.
- `geom/bins.ts` is generic over `{ key, name, bin? }` (`BinState` = `{ bins, items }`).
- **Image bins** (`ui/assetbins.ts`) are now an adapter over the shared panel; behaviour is
  unchanged.
- **Balloon bins** (`ui/balloonbins.ts`, Caption):
  - **Starters** is a built-in bin of six kinds, made from the book's style sheet.
  - **+ Save** keeps the selected balloon group as a `SavedBalloon` in `book.balloonKit`, without
    its script link or generated flags. The schema validates each letter with `letterOf`: 300
    items, 1–12 letters each.
  - Placing relabels the copies (`relabelLetters`), centres them on the drop point (or the page
    middle), clamps them and selects the first. One undo step.
- **Layout bins** (`ui/layoutbins.ts`, Layout):
  - **Built-in** holds the six preset grids. Saved layouts are the device's page templates
    (`inkflo.page-templates.v1`, now with `bin`), and the bin order is in `inkflo.layout-bins.v1`.
    Layout bin edits are device data, so they're not on the book's undo stack.
  - Tap: `applyPageTemplate` on the whole page.
  - Drop on a panel: `splitPanelCuts(page, at, template)` (`geom/pagetemplates.ts`) scales each
    template line into the panel's box, runs it past the edges, and knife-cuts every piece of
    that panel it crosses (`planKnifeCut`, panel mode). That's one undo step. Moved panels are
    refused with a hint.
- Checks: `bins.test.ts` (6, including the balloon kit book round-trip, which drops `src`) and
  `placement.test.ts` (split: rows2 + grid4 gave 5 panels with the top one untouched).
  In the built-in pane:
  - Layout: tapping Two rows took 4 panels to 2. Dropping Four panels on the bottom panel gave
    the top panel plus a 2 × 2 grid in the bottom half. Undo restored both.
  - Caption: Shout dragged to (3, 1) in landed exactly there. + Save made "Big shout", and
    tapping it placed a new copy at the page middle. Undo removed everything.
  - Draw: the image bins still listed the book's image.
- **Not checked:** real touch on iPad; dropping onto a laid-out canvas in a visible pane. The
  test points were computed from the stage geometry because the hidden pane leaves the canvas
  at 300 × 150.

## Layout code: gutter colour and page edge, 2026-11-13

- **Fix:** Layout code couldn't set the gutter colour or the inked page edge, so code layouts never
  had black gutters or framed outer panels.
- **New words:** `gutters white|black|none|#hex` (sets `gutterPaper`) and `edge on|off` (sets
  `edgeBorder`). Both are always written by `formatLayoutCode`.
- Deleting either line returns it to the default: white gutters and no edge.
- A `#` followed by six hex digits is now a colour, not the start of a comment.
- Checks: `layoutcode.test.ts` (8). In the built-in pane, typing `gutters black` and `edge on` in the
  code view rendered black gutter and edge pixels while the panel interiors stayed paper. Undo
  restored the page.

## Shorter layout code; vector point control, 2026-11-13

- **Layout code order:** the build comes first (cuts, keeps, panel moves and corners), then
  `# look` (gutter, border, curve, and round when set).
  - `gutters` and `edge` are written only when they're not the defaults (white gutters, no edge).
  - Panel numbers are written to 0.01.
- **Drawn cuts written short:** `cutWords(c)` thins a drawn path with Ramer–Douglas–Peucker
  (0.02 in) and writes points to 0.01 in. An 80-point wobble became 9 points.
  - When a line's words still equal `cutWords(old)`, parsing returns the original cut object, so
    a drawn cut keeps every point until its line is edited.
  - An edited line becomes the cut it says, and keeps the old id.
- **Vector pen Points** (device setting, `ink.vectorPoints`): All / Light / Medium / Strong
  (0 / 0.003 / 0.008 / 0.02 in). It simplifies each freehand vector line as it lands; shapes and
  ruler lines aren't simplified. It's shown for the Vector pen and Edit lines tools. Edit lines →
  Simplify uses at least the chosen level.
- **Simplify lines** acts on the active vector layer, or on every unlocked vector layer on the
  page, as one undo step (`history.combine`). A toast gives the point counts before and after.
- Checks: `layoutcode.test.ts` (10, including build-before-look, defaults hidden, short drawn
  cuts and the identity round-trip). In the built-in pane, with real pointer events on the
  Vector pen:
  - Light kept 28 of 142 points; All kept 142;
  - Simplify lines at Medium took both lines from 170 to 32 points, and one undo restored them.
  The test lines were removed.

## Reading order, 2026-11-14

- **Automatic order** (`autoOrder` in `geom/carve.ts`) is an XY cut over the panels' bounding
  boxes. It splits into rows wherever a line runs clear across (3 proto px of slack), each row
  into columns wherever a line runs clear down, and recurses. Panels that no clean line
  separates (slanted cuts) fall back to the old rule: centre rows of ~0.9 in, then across.
  - A tall panel beside two stacked ones reads tall → top → bottom. The old rule read top,
    tall, bottom.
  - Columns go right to left when the book reads right to left. `setReadingRtl` is set when the
    studio opens a book and in `setPrint` (and its undo). The carve cache key includes it.
- **Order set by hand:** `PageLayout.order` holds points (0–1) inside the unmoved panels, read
  first to last, and is validated in the schema. `readingOrder` ranks the panels it names; panels
  it doesn't name keep their automatic place after the panel before them.
- **Layout → Reading order** (`O`, also in the canvas menu):
  - Tap panels in order; big numbered discs show the taps. Tapping a numbered panel goes back to
    it.
  - The order is set when every panel is tapped, or with **Done**, where untapped panels follow
    in their current order. **Start over** and **Automatic order** clear it.
- **Beats stay with their panels** (`geom/readingorder.ts`, `beatsFollowing`): `beats[i]` is
  panel i, so changing the order permutes the beats to match. Groups, dialogue panels, moves and
  corners are anchored by points and need nothing. One undo step covers `layout` and `beats`.
- **Behaviour change:** existing pages whose automatic order changes under the new rule (tall
  panels beside stacks, and every multi-column page in a right-to-left book) now pair their
  beats with the new order. Use Reading order to set it by hand if needed.
- Checks: `carve.test.ts` (29). It covers tall-beside-two, right to left, a grid still reading
  rows first, a partial hand order, and beats following panels there and back. All 424 tests
  pass. In the built-in pane on a 13 × 4 in strip (tall panel + two stacked):
  - the automatic order was tall, top right, bottom right;
  - tapping bottom right, top right, tall set that order and moved each beat with its panel;
  - Automatic order restored both, undo brought the hand order back, and the page was restored.
