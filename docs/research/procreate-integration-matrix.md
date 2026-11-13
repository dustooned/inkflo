# Procreate → inkflo integration matrix

2026-11-12 · the single table that turns the deep dive into work. Evidence is from
`Procreate-v5-4-4.ipa` and `Procreate-Dreams-v1-0-15.ipa`; the studies behind it are
[drawing features](procreate-drawing-features.md), [UI style](procreate-ui-style.md),
[interface](procreate-interface.md) and [Dreams motion](dreams-1.0.15-motion.md).

`Size`: **S** ≤ 1 day, **M** 2–5 days, **L** > a week. `State`: what inkflo has **today**, from
`src/` as of this read (BUILD-STATUS 2026-11-10 plus the uncommitted Draw work).

## The rule for every row

Adopt the **behaviour and the proportions**, never the bytes. No Procreate icon, brush, texture,
font, palette or nib geometry ships. Where a Procreate feature is listed as "same", check inkflo's
implementation independently — parity of behaviour is the goal, not parity of code.

## A. Stroke and brush

| # | Feature | Procreate evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| A1 | Stroke as data, replayable | `StrokeRecording`, `StrokeRecordingFrame` | ✅ strokes stored, replay exists | keep; it is better than recording | — |
| A2 | Windowed StreamLine with pressure strength | `streamlinedWindowPointCount`, `streamlineControlPoint:strength:pressureStrength:window:…` | ⚠️ one stabilizer slider | add window + pressure strength | M |
| A3 | Multi-stage smoothing (moving average → StreamLine → FFT) | `plotMovingAverageStabilization`, `plotFFTSmoothing*` | ⚠️ single pass | add one extra stage, not three | M |
| A4 | Directional jitter (lateral/longitudinal, ± roll/tilt) | `plotJitterLateral*` | ⚠️ scatter only | add directional jitter | S |
| A5 | Per-device taper (Pencil vs finger) | `pencilTaper*` / `fingerTaper*` | ⚠️ one taper set | split by input device | S |
| A6 | Zoom-compensated smoothing, catch-up | `smoothingZoomCompensation`, `smoothingCatchup` | ❌ | add zoom compensation | S |
| A7 | Wet edges / burnt edges | `wetEdgesAmount`, `burntEdgesAmount`, `burntEdgesBlendMode` | ⚠️ wet mix partial | add burnt edges as a Print Look module instead | S |
| A8 | 4-map PBR texture set (grain/height/metallic/roughness) | `height/metallic/roughness*` | ❌ | **skip** — comic art does not need it | — |
| A9 | Hover preview before contact | `hoverFill/Outline/Pressure`, `preview*` | ❌ | adopt where pen hover is reported | S |
| A10 | Global pressure curve editor | `ProPressureCurve`, `StylusCurveViewController` | ⚠️ fixed response | add one curve editor | S |

## B. Tools

| # | Feature | Procreate evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| B1 | Paint, smudge, erase | `StrokeMode`, `KernelSmudge`, `eraseSize/Opacity` | ✅ all three | keep | — |
| B2 | Glaze strength on smudge | `lightGlaze`/`heavyGlaze`/`intenseGlaze` | ⚠️ fixed pull | add a strength value | S |
| B3 | Clone with lock/unlock and per-input rule | `DocumentCloneController`, `Clone lock`, "A finger will always clone" | ✅ clone with source | add lock toggle | S |
| B4 | Liquify (Push, Twirl L/R, Pinch, Expand, Crystals, Edge, Reconstruct, Turbulence) | `LiquifyMode`, mode strings | ❌ | adopt 5 modes (Push, Twirl, Pinch, Expand, Reconstruct) | M |
| B5 | Fill: live threshold drag | `updateWandThresholdWithGesture:`, ColorDrop | ⚠️ threshold in settings | make threshold a drag | S |
| B6 | Fill: "refer to" (layer / all / reference layer / group) | `ValkyrieFloodModeDescriptor.sampleLayer`, `masked`, `preserveAlpha` | ⚠️ reference flag per layer | add an explicit refer-to choice | S |
| B7 | Selection: automatic (wand) | `engageSelectionKind:`, `wandAtPoint:threshold:` | ⚠️ line-enclosed selection | add a wand mode with threshold | M |
| B8 | Selection: feather with live preview, one commit | `featherBegin/Updated/Ended`, `commitFeather` | ❌ | add feather, preview then commit | S |
| B9 | Saved selections with thumbnails | `saveMask:`, `loadMaskThumbnail:`, `savedMasks` | ❌ | add saved masks (a list with thumbs) | M |
| B10 | Transform: Warp + Advanced Mesh | `TransformMode`, `warpShowAdvancedMesh`, `WarpGeometry` | ❌ | add a warp grid on a selection | L |
| B11 | Transform: snapping, angular vs Cartesian | `Snapper`, `snappingWillLockGuidance…` | ⚠️ basic snap | add angle lock + hand-over | M |
| B12 | Transform: interpolation choice | `interpolationType`, Nearest/Bilinear/Bicubic | ❌ | add Nearest/Bilinear | S |
| B13 | Text on a transformed layer | `ValkyrieTransformedTextLayer`, `buildTextRasterizationJobs` | ⚠️ balloons scale as vector | keep vector text; no rasterize | — |

## C. Adjustments

| # | Feature | Procreate evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| C1 | Non-destructive adjustment objects in the stack | `FilterMode`, `paintDefaults`, `interpolate:` | ⚠️ stored as `PixelEdit` entries and replayed on rebuild — editable only by undo, not a live filter node | make each adjustment a re-editable node with parameters | L |
| C2 | Hue / Saturation / Brightness | `ValkyrieFilterHSB` | ✅ | keep | — |
| C3 | Curves (RGB + gamma points) | `ValkyrieFilterCurves` | ❌ | adopt after C1 | M |
| C4 | Color Balance (shadows/mid/highlights) | `ValkyrieFilterColorBalance` | ❌ | adopt after C1 | M |
| C5 | Halftone (dot pitch, screen kind) | `ValkyrieFilterHalftone` | ⚠️ screentone generator | unify: one halftone engine, two entries | S |
| C6 | Noise / Glitch / Chromatic Aberration | filter parameters | ❌ | adopt as **Print Look modules**, not adjustments | M |
| C7 | Gradient Map | `ValkyrieFilterGradient`, `GradientBrowser` | ⚠️ gradients exist as fills | add a gradient map only if duotone is wanted | S |

## D. Layers

| # | Feature | Procreate evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| D1 | Blend modes | 25 named modes | ❌ none (export forces `normal`) | add 12 via `globalCompositeOperation` | M |
| D2 | Alpha lock | `Layer-Background-Alpha-Lock` | ❌ | add a per-layer switch | S |
| D3 | Clipping mask | clipping indicator, `clip layer` | ❌ | add per-layer clip-to-below | M |
| D4 | Layer mask | `LayersCellLayer.cutout` | ⚠️ group mask only | add a layer mask (start with a freehand region) | M |
| D5 | Reference layer | "Reference layer on/off" | ✅ `fillRef` | keep | — |
| D6 | Groups, Passthrough | `Passthrough` | ✅ typed panel groups | add "no opacity inheritance" only if needed | S |
| D7 | Merge down vs combine down | `Combine Down` / `Combine Mode` | ⚠️ merge exists | keep one operation; name it precisely | — |
| D8 | Per-layer slide actions (Select Contents, Duplicate, Clear, Delete) | `Layers.Cell.Layer` | ⚠️ buttons in the panel | adopt the slide tray on touch | S |

## E. Colour

| # | Feature | Procreate evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| E1 | Disc / Classic / Harmony / Value pickers | `ColorPickerRing/Classic/Harmony` fragments + scenes | ⚠️ one picker | add Disc + Harmony tabs | M |
| E2 | Harmony rules | `ColorPickerHarmony` | ✅ `harmony()` exists | surface it as the Harmony tab | S |
| E3 | Palettes and palette from photo | `IndexedImagePalette`, "New from Photos" | ✅ `paletteFromPixels` | surface in the picker | S |
| E4 | Colour history | `HistoryPalette` | ❌ | add a history row | S |
| E5 | Colour profiles / ICC | `ValkyrieColorProfile`, ICC parser | ❌ | skip; document RGB-only | — |

## F. Guides and assist

| # | Feature | Procreate evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| F1 | 2D grid / isometric / perspective guides | `ValkyrieDrawingGuide`, `DrawingGuideParameters` | ✅ all three | keep | — |
| F2 | Perspective with multiple nodes, per-node colours | `nodes`, `nodeColors`, `horizonAngle`, `horizonLines` | ⚠️ 1–3 point, one colour | add per-node colours and horizon control | S |
| F3 | Symmetry (vertical, horizontal, quadrant, radial, rotational) | `symmetryType`, `symmetryStrokes` | ⚠️ some modes | complete the five modes | S |
| F4 | Drawing Assist per layer + Pencil double-tap | `primaryLayerAssistedOnEntry`, assist toggle | ✅ per-layer assist | keep; add the double-tap shortcut | S |
| F5 | QuickShape with "possible shapes" | `displayOrUpdateQuickShapeNotificationForShape:possibleShapes:`, `quickShapeDelay` | ⚠️ detects and snaps | add the shape-choice notification + delay | S |
| F6 | Snapping as a shared service | `ValkyrieSnapper` | ⚠️ per-tool | one snapper module for borders, guides, edges | M |

## G. Interface

| # | Feature | Procreate evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| G1 | Two-axis chrome (document actions vs paint cluster) | `DocumentNavigation` | ⚠️ one Focus corner bar | split per the interface doc | M |
| G2 | Tool-options second row (44 pt, hairline) | `modifyBar`, 95 pt | ⚠️ context bar elsewhere | move tool options into the bar | M |
| G3 | Translucent system-colour chrome | `UIVisualEffectView`, system colours | ⚠️ solid token panels | blur + system-like tokens in Focus | S |
| G4 | Size/opacity sidebar that handedness moves | `Size & Opacity sidebar`, `Right-hand interface` | ⚠️ edge sliders | make it the handedness surface | S |
| G5 | Notification bar (18 pt + 32 pt control) | `NotificationBar`, `ProMessageBar` | ⚠️ toast | add a persistent hint bar | S |
| G6 | Auto-hide interface with delay | `Auto-hide Interface`, "Show Interface" | ❌ | add idle-hide in Focus | S |
| G7 | Four surface types (card / toolbar / popover / panel) | 16 cards, 57 toolbars, 36 popovers | ⚠️ mixed | sort every control into one of the four | M |
| G8 | Slider component (groove, scrub, value, keypad) | `ProSlider*`, `ProNumberPad` | ⚠️ plain range | build one slider component | M |
| G9 | Key tags in menus | `ProKeyShortcutControl`, `KeyTagLabelView` | ⚠️ titles only | render shortcuts in menu rows | S |
| G10 | Inline rename over a blur | `renameBlur`, `RenameTextField` | ⚠️ dialog | inline rename for books/pages/layers | S |
| G11 | Card motion (morph from button) | `ProStretchyBlobView`, `PulseView` | ❌ | one morph transition, reduced-motion aware | S |
| G12 | Panels as popovers on touch, docked on desktop | `…Pocket` variants, size classes | ✅ Studio/Focus toggle | keep; add a width-based rule | S |
| G13 | QuickMenu (one surface for frequent actions) | `QuickMenu`, `Customize QuickMenu`, per-gesture strings | ❌ | adopt on long-press | M |
| G14 | Layer-under-pen selection | `LayerSelectMode`, `KernelLayerSelect` | ❌ | adopt as a long-press | S |
| G15 | Gesture policy per gesture and per device | gesture strings, "…will not undo or redo" | ⚠️ fixed bindings | expose a small gesture table | S |

## H. Motion (Dreams)

| # | Feature | Dreams evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| H1 | Cue list compiled to a render plan | `TimelineChanges` → `TimelineDerived` → `TimelineBuild` | ✅ `.2dope` export is a cue list | keep; formalise the cue schema | M |
| H2 | Typed targets with named refusal rules | "Cannot paint on a keyframe track" etc. | ⚠️ silent ignores | add validation messages | S |
| H3 | Context menu per object type | `TrackContextMenuViewModel`, `TrackKeyframeContextMenuViewModel` | ❌ | add context menus on cues | S |
| H4 | Collapsible cue/timeline strip | "Flick the timeline away…" | ❌ | collapsible strip on the Motion desk | S |
| H5 | Snap + multiselect when dragging cues | `TimelineSnapping`, `TimelineMultiselect` | ❌ | add both | M |
| H6 | Forward/backward onion tints | `onionSkinPrevious/NextFrameColor` | ❌ | only if a light table is built | S |

## I. Import, export, print

| # | Feature | Procreate evidence | inkflo today | Decision | Size |
|---|---|---|---|---|---|
| I1 | PSD with layers | `AdobeFileStreams` (42 classes) | ✅ import and export (`src/io/psd.ts`) | keep | — |
| I2 | Layered export (PSD, PNG per layer, by type) | Share/Export | ✅ PSD, page PNGs, separations (inks / colours / pencils / lettering) | verify a colourist's round trip | S |
| I3 | PDF with bleed and marks | Export | ✅ `exportPrintPdf` with bleed, crop marks, imposition | check against a real printer's spec | S |
| I4 | Video / timelapse | `VideoRecorder`, `VideoTimelapseWriter` | ❌ (motion goes out as `.2dope`) | skip | — |
| I5 | 3D painting | `Transform3DMode`, materials | ❌ | skip | — |

## Order of work

Ranked by leverage per day, and by what unblocks the rest:

1. **G1 + G2 + G3 + G7** — the chrome and the four surfaces. This is the visible "looks like
   Procreate" step, and it makes every later control land in the right place. (M, ~1 week)
2. **D1 + D2 + D3** — blend, alpha lock, clipping. The largest capability gap, and it changes how
   the Draw desk feels for colourists. (M)
3. **B4 + B7 + B8 + B9** — liquify, wand, feather, saved selections. Turns the selection into a
   real tool rather than a stencil. (M+L)
4. **C1 then C3 + C4** — make adjustments re-editable nodes first, then Curves and Color Balance.
   Doing C3 before C1 would mean replaying pixel edits to tune a curve. (L)
5. **E1 + E3 + E4** — Disc/Harmony picker, palettes, history. (M)
6. **A2 + A4 + A5 + F6** — stroke feel and one shared snapper. (M)
7. **H1 + H2 + H3 + H4** — the Motion desk's cue strip and validation. (M)
8. **I1–I3 round trips** — verify PSD and print PDFs against a real colourist and printer before
   polishing anything else in export. (S)

Deliberately not scheduled: PBR brushes, 3D, animation assist, timelapse video, ICC profiles,
linear-light blend modes.

## What is already at parity (do not rebuild)

Brush dabs and taper · fill with gap closing and leftover/auto-flats · vector ink layers with point
edit · screentone · lettering with tails and copyfit · quickshape · 2D/isometric/perspective guides ·
symmetry · per-layer fill reference · typed layers in panel groups · PSD import and export · print
PDF with bleed, marks and separations · `.2dope` export.

## Evidence

Per-row evidence is in [drawing features](procreate-drawing-features.md) §3–§8 and
[UI style](procreate-ui-style.md) §2–§7, which cite the tables in
`beta/.rea-work/procreate-deep/` (`pc-classes.tsv`, `pc-methods.tsv`, `pc-strings.tsv`,
`dr-classes.tsv`, `dr-strings.tsv`) and the REA Evidence IDs `ev_58d08d7f…`, `ev_48771e8b…`,
`ev_859b9583…`.
