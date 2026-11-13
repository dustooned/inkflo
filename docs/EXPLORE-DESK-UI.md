# Exploration: desk toolbars, panel layer groups, inking tools

2026-11-10 · design only, nothing built.

**Decided by the user (2026-11-10):**
- **Toolbars:** Studio layout plus a Focus toggle.
- **Panels:** a layer group per detected panel.
- **Pop-out:** both an "Over frame" toggle per layer and an "Over panels" section.
- **Inking:** all four areas are wanted — brush library + Studio, vector pen, comic rulers,
  fill family + colour.
- **Build order:** as in "Suggested order (revised)" below.
- **Also asked (2026-11-10):** integrate Lazy Nezumi and Procreate drawing assist and all the
  other drawing tools (sections 4–5), and a lettering system that is 2Dope's caption system made
  much more robust, detailed and customizable (section 6). Sources: 2Dope's research
(`2Dope/beta/docs/MODE-CONTEXT-UI-DIRECTION-2026-10-30.md`, `LAYERS-MASKS-AND-UI-STUDY.md`,
`feature-deconstruction/13-clip-studio-fill-ink-layers-phone.md`,
`research/procreate-brush-system/`, `research/clip-studio-vector-next/`).

Three asks from the user:

1. Toolbars like traditional programs, with the tool's settings on a top row, so each step has
   every tool it needs.
2. Panels detected as groups with their own settings. Select one, some or all by label. Art is
   masked by its panel, but a layer can be lifted over the panels.
3. Robust brush and pen inking, on the level of the CSP/Procreate research done for 2Dope.

---

## 1. Toolbars

### Options

**A. Studio** (CSP / Affinity / Photoshop): tool rail on the left, tool settings in a bar on top,
docked panels (Layers, Brush, Colour) on the right, desks at the bottom. Everything visible.

**B. Focus** (Procreate): canvas almost full screen. A small top-right tool cluster,
size/opacity sliders on the left edge, and Layers and Brushes as popovers.

**C. Both, with a toggle (recommended).** Studio by default; Tab switches to Focus. The same
tools and settings are in both, just shown differently. 2Dope settled on this same pattern
(mode-first toolbars plus Quick Animate).

```
STUDIO                                                       FOCUS (Tab)
┌──────────────────────────────────────────────────┐        ┌───────────────────────────┐
│ Book / Page 3 / Draw          ‹ 3/24 ›  ↶ ↷  Export│        │ ‹ Page 3        ✒ ⌫ ◐ ⬚ ● │
├──────────────────────────────────────────────────┤        │█                          │
│ G-pen ▾  Size ━━●━ 0.8pt  Opac ━━━━● Stab 25  AA │        │█   (canvas)               │
│ Correction ━●━  ☑ Stay in panel   Pass: Ink ▾    │        │▌                          │
├──┬─────────────────────────────────────┬─────────┤        │▌                          │
│✏ │                                     │ LAYERS  │        │                           │
│✒ │                                     │ ▾ 1 Roof│        └───────────────────────────┘
│⌫ │            (page)                   │   Ink   │         Layers / Brush as popovers
│◐ │                                     │ ▸ 2 Jo  │
│⬚ │                                     │ ⤒ Over  │
│✛ │                                     ├─────────┤
│💧│                                     │ BRUSH   │
├──┴─────────────────────────────────────┴─────────┤
│ SCRIPT · LAYOUT · DRAW · CAPTION · PRINT · MOTION │
└──────────────────────────────────────────────────┘
```

Rules taken from 2Dope's accepted direction:
- A tool owns its options; they appear on the top bar only while it's in hand.
- Tools with variants show a small corner mark and open a sub-tool flyout (CSP style),
  e.g. Fill → Bucket, Enclose, Leftover.
- Users can pin, reorder and hide tools per desk, with Restore defaults. This is saved per desk
  and is never document history.
- Deep settings (the Brush Studio) open from the bar; they never live permanently on it.

**Observed against the reference (2026-11-12).** Procreate's own canvas chrome was decoded from its
shipped package: five clusters — document actions, edit actions, paint tools, layers, colour — 44 pt
targets with 8 pt gaps, a second 44 pt row that appears only for the active tool's options, a
translucent system-colour bar over the canvas, a left size–opacity sidebar that is what handedness
moves, an 18 pt notification line under the bar, and auto-hide with a delay. Focus should follow
that grouping and those proportions, not merely "fewer buttons". Details, frames and the delta
table: [research/procreate-interface.md](research/procreate-interface.md). The full component,
metric and surface spec is [research/procreate-ui-style.md](research/procreate-ui-style.md), and the
ordered build list is [research/procreate-integration-matrix.md](research/procreate-integration-matrix.md).

### Tools per desk ("everything that step needs")

| Desk | Tools (rail) | Top bar while in hand |
|---|---|---|
| Script | — (writing pane) | add beat, characters list, import Fountain/text, page / line counts |
| Layout | Knife · Move/Swap · Detach · Resize · Shape (draw a closed panel) · Uncut · Reading order | cut mode, gutter, border, curve, presets, even out, snap |
| Draw | Brush · Pen (vector) · Eraser · Fill · Select · Transform · Eyedropper · Rulers | brush picker, size, opacity, stabilizer, correction, AA, pressure curve, target layer, stay-in-panel |
| Caption | Balloon · Caption · SFX · Tail · Text · Reading order | style, type size, copyfit, tail shape, font preset |
| Print | Preview · Marks · Preflight | trim/bleed/safe, imposition, dpi |
| Motion (new desk) | Camera · Cue · Timing | per-panel hold, move, enter effect; export to 2Dope |

---

## 2. Panel layer groups

### Model (recommended)

Today each page has three page-wide bitmaps (pencil, ink, colour). Proposal: a **layer tree per
page**, with a group per detected panel.

```
Page 3
 ├─ ⤒ Over panels        layers here draw above borders and gutters (break-out art, big SFX)
 │   └─ Hand reaching out
 ├─ ▾ 1 · Rooftop        panel group: mask ☑  eye  lock  opacity
 │   ├─ Ink
 │   ├─ Colour
 │   └─ Pencil (never prints)
 ├─ ▸ 2 · Jo             (folded)
 ├─ ▸ 3 · Street
 └─ Background           page-wide, under every panel (spread art, paper texture)
 Balloons sit on top of everything (Caption owns them).
```

- **Detection.** Panels still derive from cuts (rule 1). Each group stores an identity: an id, a
  label and an anchor point inside the panel. It never stores the outline. After a re-cut, a
  group belongs to whichever new panel holds its anchor; a split panel keeps the group in one half
  and the other half gets a new, empty group.
- **Masking.** Each layer in a panel group is clipped to the panel shape: "mask ☑" on the group,
  and it can be turned off per layer.
- **Over the panels.** Each layer has an "Over frame" toggle. On, the layer draws after the
  gutters and borders, still in its panel's group for organisation. That gives the classic
  pop-out: a fist through the border. The **Over panels** section holds page-wide pop-outs.
- **Select by label.** Click a panel on the canvas or its row to target it. Shift or Ctrl-click
  for several. An **All panels** chip applies settings to every group. Labels come from the beat
  ("1 · Rooftop") and can be renamed.
- **Group settings:** visibility, lock, opacity, mask on/off, label, beat link, border override,
  and later camera framing for Motion.

Render order: Background → each panel group (masked) → gutters and borders → over-frame layers
→ Over panels → balloons. This is still one renderer, so screen, print and export match.

### Cost and risk

- **Memory.** Full-page bitmaps per layer would be about 24 MB × layers × panels. Instead, each
  panel layer's bitmap is cropped to its panel's bounding box plus a margin. Residency already
  pages bitmaps in and out; it would work per layer instead of per page.
- **Migration.** Existing books convert as: page passes become the Background group's Ink,
  Colour and Pencil layers. Nothing is lost.
- **2Dope export gets better.** Panel group → a 2Dope group comp with real Ink/Colour layers.
  Over-frame layers → layers above the borders. That is closer to how an animator wants it.

---

## 3. Inking tools

Most of the engine is already here: the vendored 2Dope engine has Procreate-style dynamics.
inkflo just doesn't expose it yet (two placeholder brushes).

| Area | What to add | From |
|---|---|---|
| **Brush library** | The 10 comic presets of BRUSH-AND-INK §4 (G-pen, Maru, Mapping, Brush pen, Dry ink, Pencil HB, Rough, Ink wash, Flat, Tone), plus 2Dope's presets. Sets, favourites, search. | BRUSH-AND-INK, 2Dope `core/brush.ts` |
| **Brush Studio** | Procreate-style editor: Stroke (spacing, jitter), Stabilize (streamline, pulled string, motion filter, post-correction), Taper (start/end, size, opacity, shape), Shape (tip image, roundness, angle), Grain (image, scale, depth, movement), Dynamics (pressure/tilt/speed curves), a live preview pad. | 2Dope brush panel; Procreate brush research (124 keys) |
| **Brush import** | `.brush`/`.brushset` (Procreate) and `.abr` (Photoshop), the user's own files, plus PNG tips and grains. | 2Dope `io/brushimport.ts` (needs the clean-room review noted in the inventory) |
| **Vector pen** (CSP vector layer) | Editable ink: reshape points, change width after drawing, erase "to intersection" (cleans overshoots), simplify/smooth. | 2Dope `vectorstyle`/`vectorcut` (already vendored) |
| **Correction** | Post-correction (smooth after lift), anti-alias off for tight fills, QuickShape. | CSP study; vendored `quickshape`, `smoothing` |
| **Comic rulers** | Speed lines (parallel) and focus lines (concentrated) generators, straight/perspective rulers, panel-border-aware snapping. These are CSP's comic-specific tools. | CSP manual (behaviour only) |
| **Fill family** | Reference-layer fill, close gap, drag-fill, enclose-and-fill, leftover brush. | CSP study §1 |
| **Colour** | Disc / Classic / Harmony / Value / Palettes tabs, history, primary/secondary. | Dreams handbook study §4 |
| **Tone** | Procedural screentone fills (angle, lpi, dot/line/cross). | BRUSH-AND-INK §2 |

---

## 4. Drawing assist (Procreate first, Lazy Nezumi extras)

Source: 2Dope `docs/feature-deconstruction/14-drawing-assist.md`. That is a behaviour study of
the Procreate handbook and the Lazy Nezumi Pro manual. 2Dope already ships QuickShape, symmetry
and grid / isometric / 1- and 2-point perspective guides (`core/guides.ts`, `core/quickshape.ts`).

| Feature | Behaviour | Comic use |
|---|---|---|
| **Guides** (Procreate) | 2D grid, isometric, perspective with 1, 2 or 3 points, symmetry. Shown on screen, never printed. | Backgrounds, buildings |
| **Drawing Assist** (Procreate) | Per-layer switch: strokes follow the guide. | Inking clean architecture |
| **QuickShape** (Procreate) | Hold at the end of a stroke to snap to a line, arc, ellipse, rectangle or polygon. A second finger constrains it. Then edit with handles. | Balloons, props, panel shapes |
| **Assist strength** (Nezumi "accuracy") | 1 = exactly on the ruler; lower keeps some of the hand's wobble. | Ruled lines that still look inked |
| **Radial lines** (Nezumi) | Lines locked to rays from a centre, optionally curved. | **Focus/impact lines** |
| **Parallel lines** (Nezumi) | Locked to one angle, which rotates around the pen. | **Speed lines**, rain, hatching |
| **Ellipse ruler** (Nezumi) | Degree and rotation, auto-fit from a sketch. | Wheels, cups, cylinders in perspective |
| **Perspective auto-axis + box mode** (Nezumi) | Picks the vanishing point from the first motion; box mode clamps corners so they close without overshoot. | Fast, clean backgrounds |
| **Connected lines** (Nezumi) | A new line starts where the last one ended or met. | Technical props |
| **Inertia smoothing** (Nezumi) | Mass and drag; pressure from speed gives tapered, confident lines. | A G-pen feel with a mouse |
| **Pressure shaping** (Nezumi) | One global pressure curve: gain, softness, min/max. | Matches any tablet |

**inkflo additions on top:**
- **Panel-aware rulers:** a perspective guide can belong to one panel group, so each panel keeps
  its own camera.
- **Snap to panel border:** a stroke can stop exactly at the border.
- **Speed and focus line generators:** CSP-style fill tools that draw many lines at once, with
  density, length jitter and taper.

How it fits: every assist changes the stroke's points before rendering, so replay, undo and the
stored stroke data stay exact. 2Dope uses the same approach.

---

## 5. All the drawing tools

2Dope's draw audit (`docs/DRAW-CAPABILITY-AUDIT-2026-10-26.md`) lists what 2Dope has. inkflo
should offer the same and add the comic-specific ones.

| Group | Tools | In 2Dope | inkflo adds |
|---|---|---|---|
| Paint | Brush, Eraser, Smudge, Vector pen | ✓ | Over-frame target, stay-in-panel |
| Brushes | Library, sets, favourites, recent, per-brush size/opacity, import | ✓ | Comic presets (G-pen, Maru…), tone brush |
| Select | Freehand, rectangle, ellipse, automatic (ink-enclosed); add, subtract, invert; select layer contents | ✓ | Select panel, select by colour |
| Selection actions | Fill, copy, cut, paste, duplicate, delete | ✓ | Copy to new layer, paint inside the selection (2Dope's audit gap) |
| Transform | Move, scale, rotate (15° snap), flip, fit; apply/cancel | ✓ | Typed values, distort/perspective, mesh warp, liquify |
| Fill | Bucket, gap close, leftovers, reference layer, drag fill, gradients, auto-paint after inking | ✓ | Fill per panel, tone fill |
| Colour | Disc, values, hex, palettes, image extraction, harmony, eyedropper | ✓ | Book palette (spot inks), flat-check colours |
| Layers | Opacity, blend, alpha lock, clipping, masks, reference, groups, merge | ✓ | Panel groups, Over frame, Over panels |
| Adjust | Hue/saturation/brightness, blur | ✓ | Levels, posterize (mono print), halftone |
| Assist | QuickShape, symmetry, guides | ✓ | Section 4 |
| View | Reference window, rotate/flip canvas, QuickMenu | ✓ | Light table (neighbour pages), 2-page spread view |

Most of these live in 2Dope's `app.ts` / UI, so they are **ported** into inkflo's desks. The pure
parts are already vendored: fill, wand, autopaint, quickshape, selxform, vector modules.

---

## 6. Lettering: 2Dope's caption system, made comic-grade

### What 2Dope has (`docs/LETTERING-DESIGN.md`, `src/lettering/`, `view/caption.ts`, `lettertool.ts`)

- **CaptionSpec:** live text plus a live balloon, never baked.
  - **Styles:** speech, thought, shout, whisper, box, SFX, custom.
  - **Looks:** roundness, wobble, spikes, bumps, or a custom outline.
  - **Tails:** merged, seam, bubbles, lightning; with taper, tip, bend, count, shrink and zigs.
    Up to 4 tails, and a tail can follow a layer.
  - **Linked balloons.**
- **Lettering:** 10 bundled open-licence comic fonts (Comic Neue, Bangers, Patrick Hand…) and
  font import. Bold, italic and caps; Small/Body/Big sizes; tracking, leading and alignment; text
  outline and under-fill; text on an arc, wave or drawn path. Balanced, diamond-shaped line
  breaks fitted to the balloon's profile.
- **Letter tool:**
  - Tap to place.
  - Draw a loop and it is recognised as speech, box, thought or shout, or kept as drawn.
  - Draw out of an edge for a tail; a zigzag gives a lightning tail.
  - Drag to move; double-tap to edit.
- **Make caption from a drawing:** a traced outline becomes the balloon, and its sharp point
  becomes the tail.
- **Styles library:** capture and apply a look, six ready-made styles, `.2dope-style` files with
  embedded fonts.
- **Animation:** Fade, Pop, Type on, ink length, shake/wave/jitter keys.

`src/lettering/` is already vendored in inkflo and was built to move into a comics app. inkflo's
current balloon renderer is a stop-gap and should be replaced by 2Dope's.

### What inkflo adds (more robust, detailed, customizable)

| Area | Add |
|---|---|
| **Script link** | Every balloon knows its script line and speaker (today: yes). Edit the words on the page or in Script; both stay in sync. Renaming a speaker relabels everywhere. |
| **Character styles** | Per character: font, size, colour, balloon look and tail style (a robot gets square balloons in a mono font). New balloons for that speaker use it automatically. |
| **Book style sheet** | House style: default font, sizes in **pt** for print, leading, tracking, balloon ink width, padding, tail defaults. Change it once and every balloon follows unless overridden. Import/export style sheets. |
| **Balloon types** | Speech, thought, shout, whisper, caption box, **radio/electronic** (jagged lightning tail), **off-panel** (tail to the panel edge), **telepathic**, **inner monologue**, **connected** (several balloons, one speaker), **joined** (two shapes merged). |
| **Typography** | Kerning per pair, inline bold/italic/colour, the **crossbar-I rule** (serifed I only for the pronoun), ligature control, hyphenation off by default, emphasis presets, **multiple fonts per balloon**. |
| **Copyfit** | Shrink to fit, grow the balloon to fit, or warn. A minimum size in pt from the style sheet. An overflow badge. |
| **Panel awareness** | Balloons can **break the border** (Over frame, as for art), clip to their panel, or sit in the gutter. Reading-order check (exists). Tails that stop at the border for off-panel speakers. |
| **SFX studio** | Text on path, arc and bulge warps, 3D extrude (stacked offset), per-letter rotation/scale jitter, an outline stack (multi-colour strokes), and textures clipped to the letters. SFX can be drawn over or under art. |
| **Lettering guides** | Ames-guide-like line rulings for hand lettering, a baseline grid, and a safe-area warning. |
| **Languages** | **Lettering layers per language:** the same balloons, different text per language, with per-language copyfit. Export each language as its own CBZ, PDF or site. |
| **Export to 2Dope** | Balloons go out as **live 2Dope caption layers** (2Dope format 10), not PNGs. In 2Dope they stay editable and can Type on, Pop or Shake. Fonts travel with the project. |
| **Print** | Vector text in the PDF, fonts embedded, and the "lettering outside safe area" preflight (exists). |

---

## 7. Line and fill detection (Clip Studio + Procreate grade)

Sources: 2Dope's CSP fill study (`feature-deconstruction/13-…`, §1) and its fill engine
(`src/fill/`, already vendored here). The engine is already solid:
- soft line edges count as line;
- the fill grows under the line, so there is no white halo;
- gap closing is capped by the seed's distance, so a fill can't leak.

What's missing is the controls and the detection around it.

| Feature | Behaviour | From |
|---|---|---|
| **Threshold by drag** | Drop colour, then drag left or right to tighten or loosen what counts as the same area, previewed live. | Procreate ColorDrop |
| **Refer to** | The fill reads lines from: this layer, all visible layers, a marked **reference layer**, or the panel group. Colour lives on its own layer. | CSP "refer other layers", Procreate Reference |
| **Close gap** | Bridges breaks up to N px, with a **gap preview** (the bridged gaps glow while Fill is in hand). | CSP |
| **Area scaling** | Grow or shrink the fill by N px past the detected edge. | CSP |
| **Drag fill** | Drag across several areas to fill each one; one undo step. | CSP |
| **Enclose and fill** | Lasso a region and every closed area inside fills (hair, lace). | CSP |
| **Leftover brush** | Scrub over unfilled slivers; they take the neighbouring colour. | CSP "Paint unfilled area" |
| **Continue filling** | Keep tapping to fill more areas with the same settings. | Procreate |
| **Auto flats** | One command fills every closed area of a panel with distinct flat colours, ready to recolour. This is the colourist's flatting pass. | 2Dope `autopaint` + flatting practice |
| **Closure check** | Hold C to see open line ends and the areas a fill would leak into, before filling. | BRUSH-AND-INK §6 |
| **Re-derive** | After an ink edit, flats that touch the change re-flood from their stored seed points (fills are already data). | PLAN "flats go stale" |
| **Colour-separation lines** | Lines on a reference layer that block fills but never print (shadow shapes, hair clumps). | Harmony / CSP practice |
| **Line extraction** | Import scanned or photographed pencils/inks: brightness to alpha, threshold, despeckle, remove paper colour, and blue-line removal (drop non-photo blue). | CSP "Convert brightness to opacity", traditional inking |
| **Select by line** | Automatic selection of an area enclosed by ink (2Dope has it), plus select by colour with a threshold drag. | CSP / Procreate |

All of these share one cached **line map** per layer revision: barrier + distance field. Repeat
taps cost one flood. Heavy work moves to a Web Worker so the pen never stutters.

---

## 8. Dark mode and the canvas backdrop

**Themes:** Light (the printer's-desk paper), **Dark** ("Night desk": warm graphite chrome, ink-on-
black, not an inverted filter), and System (follows the OS, the default). A switch in the header
remembers the choice per device. Each desk keeps its accent colour in both themes.

- Every colour is a token in `tokens.css`, redefined for dark. Nothing in the UI hard-codes a
  colour.
- **The page stays paper** in dark mode. Art is judged on the real paper colour; only the chrome
  and the board around the page go dark (Procreate does the same).
- Pencil blue, selection teal and the red warnings are tuned for contrast on both backgrounds.

**Backdrop (Procreate-style):**
- The page floats on a dark or light board with a soft shadow.
- Around it, a quiet **dot or line grid** that pans and zooms with the canvas. It gets denser as
  you zoom in and fades out under the page.
- Options: Grid / Dots / Plain, and its opacity. A **vignette** keeps focus on the page.
- Separate from the drawing grid guide (section 4), which sits on the page and is never printed.
- The board colour is customizable: neutral grey for colour-critical work.

---

## 9. Print Look: vintage ink, halftone and paper (brainstorm)

**The idea:** a **Print Look** is a stack of "press" effects applied at render time. It is never
painted into the art, so it can be switched off, tuned or swapped at any time. It applies to the
book, a page, a panel group or a single layer. It is one renderer, so screen, print, CBZ and the
2Dope export all match.

Building blocks already in 2Dope's effect stack: roughen edges, film grain, texture
(paper/hatch/dots/weave), dither, posterize, threshold, colour fringe, vignette.

### Modules (each with one strength slider and a few details)

| Module | What it does | Controls |
|---|---|---|
| **Ink: dilute / wash** | Ink thins toward its colour like watered ink. Edges darken where wash pools; blooms where it dries unevenly. | dilution, edge darkening, bloom, granulation |
| **Ink: bleed & dot gain** | Ink spreads into the paper fibres, softening and fattening lines the way newsprint does. | spread, fibre direction (from paper) |
| **Ink: dry brush** | Ink skips on the paper's grain peaks: broken, textured lines. | skip, follows paper grain |
| **Ink: aged black** | Black fades to warm charcoal or brown-black; density varies across the page. | fade, warmth, unevenness |
| **Colour: halftone** | Colour becomes printed dots: Ben-Day or CMYK screens at real angles (15/75/0/45°). Mix: 0 = flat, 1 = all dots. | lpi, dot shape (round/line/cross/diamond), **mix**, per-channel angle |
| **Colour: misregistration** | Each colour plate shifts slightly, the classic off-register look. | offset, per plate, random per page |
| **Colour: limited inks** | Map colour to a fixed ink set: 4-colour newsprint, 2-colour riso (pink + blue), duotone, mono with one spot colour. | ink set, posterize steps |
| **Colour: age** | Yellowing, fading of cyan/magenta, lifted blacks. | years 0–80 |
| **Paper** | A paper texture under everything, which also modulates ink (grain, fibres, flecks). | paper type, colour, grain scale, tooth |
| **Wear** | Foxing spots, creases, edge wear, staple rust, coffee rings, show-through of the reverse page. | each 0–1, **wear brush** to paint where |
| **Press** | Roller streaks, plate wear, toner speckle (photocopy), riso grain, offset ghosting. | each 0–1 |

**One "Age" master slider** drives all the modules together along a curve, from Fresh off the
press to Attic box. Each module can still be fine-tuned. A **seed per page** makes every page wear
differently, so the book doesn't look stamped.

### Ready-made looks (also a starting point for other styles)

| Look | Recipe |
|---|---|
| **Golden Age newsprint** (1940s) | Pulp paper, yellowed, 4-colour limited inks, coarse Ben-Day, misregistration, ink bleed |
| **Silver Age** (1960s) | Ben-Day dots on flats, cleaner black, mild yellowing |
| **Bronze Age** (1970s) | Finer screens, muddier colour, light foxing |
| **Pulp cover** | Heavy dot gain, warm black, cover-stock grain |
| **Manga tankōbon** | Grey-white stock, screentone, crisp black, slight show-through |
| **Risograph zine** | 2-colour riso inks, riso grain, misregistration |
| **Photocopy zine** | Threshold black, toner speckle, edge noise |
| **Ligne claire album** | Matte bright paper, flat colour, no dots, gentle aged black |
| **Sunday strip** | Newsprint, bright limited palette, larger dots |
| **Noir ink wash** | Diluted ink washes, dry brush, cold-press paper |
| **Sumi / watercolour** | Wash, bloom, granulation, rice paper |
| **Screenprint poster** | Limited inks, slight misregistration, flat paper |
| **Clean digital** | Everything off (default) |

### Paper library (clean-room)

Papers are **generated, not scanned**: layered noise for pulp, fibres, flecks, tooth and
yellowing, from a seed. That means no licensing problem, any resolution, and nearly zero file size.

- **Built-in set:** Newsprint, Pulp, Bristol smooth, Cold-press, Hot-press, Kraft, Washi/rice,
  Manga grey stock, Riso stock, Aged album.
- **User additions:** import your own scans (PNG/JPG). They are stored in the book so it stays
  portable. A CC0 scanned set could ship later with the source of each scan recorded.

### How it stays fast and honest
- Looks render per page into a cached bitmap, refreshed only when art or settings change.
- Print desk has a **Clean / With look** switch.
- Export asks: bake the look, or ship it clean.
- 2Dope export: modules that 2Dope's effect stack can do natively (grain, texture, roughen,
  dither, posterize, fringe) go over as **live 2Dope effects**. The rest bake into the layers.
- Halftone and screentone share one generator (BRUSH-AND-INK §2 tone).

---

## 10. Presets for everything

One preset system, one library. Users capture, apply, share and reset.

| Preset kind | Captures | Applies to |
|---|---|---|
| **Layout** | Cuts, cut modes, gutter, border, curve. Stored in page-relative units, so it fits any trim. | A page, or new pages |
| **Page template** | Trim, bleed, layout, print look, guides | New pages |
| **Print Look** | The module stack and its settings | Book, page, panel group, layer |
| **Paper** | Generated paper parameters, or an imported scan | Print Look |
| **Lettering style** | Balloon look, tails, font, sizes, colours (2Dope's style format, extended) | Balloons, characters |
| **Character style** | Lettering style + speaker name | Every balloon for that speaker |
| **Brush / brush set** | Brush settings, tip, grain | Draw |
| **Book template** | Trim, style sheet, palette, print look, lettering, first-page layout | New books |

- **Library:** on the device in IndexedDB, with thumbnails, search, favourites and folders. The
  ready-made ones are read-only and can be duplicated.
- **Files:** `.inkflo-preset` JSON. It is versioned, validated, size-capped and carries any
  fonts or paper scans it needs (2Dope's portable preset rules). It can be shared with a class.
- **Snapshot, not link:** applying copies the settings into the book, so editing a preset later
  never silently changes finished pages. "Update from preset" is a deliberate action.
- **Quick capture:** "Save as preset" on the panel, the look, a balloon or a brush.

---

## Design rule for everything above

**Easy to make, easy to customize.** Every feature has a one-tap default that gives a good result
(a preset, a wizard, a ready-made look). Every default opens into full controls. Customizing
never means starting over: change one thing and keep the rest. Students get the defaults first;
the depth is one click away, never hidden for good.

---

## 11. Standard presets for every print kind

Each preset is labelled with **what it's for**, its trim, bleed and safe area, its pages-per-sheet
rule and its usual binding. Sizes are common industry values; **always confirm with your printer**.
The preset shows that note.

| Label | Trim | Bleed / safe | Binding | Notes |
|---|---|---|---|---|
| **US comic book (floppy)** | 6.625 × 10.1875 in | 0.125 / 0.25 in | Saddle stitch | Pages in multiples of 4 |
| **US graphic novel / trade** | 6.625 × 10.1875 in | 0.125 / 0.25 in | Perfect bound | Spine from page count |
| **Graphic novel (6 × 9)** | 6 × 9 in | 0.125 / 0.25 in | Perfect bound | Common print-on-demand size |
| **Manga (US digest)** | 5 × 7.5 in | 0.125 / 0.25 in | Perfect bound | Right-to-left reading option |
| **Manga tankōbon (B6)** | 128 × 182 mm | 3 / 5 mm | Perfect bound | RTL |
| **Manga (A5)** | 148 × 210 mm | 3 / 5 mm | Perfect bound | RTL |
| **European album (BD)** | 225 × 297 mm | 3 / 10 mm | Hardcover | Larger panels, 46–62 pages |
| **Magazine (Letter)** | 8.5 × 11 in | 0.125 / 0.375 in | Saddle stitch | |
| **Magazine (A4)** | 210 × 297 mm | 3 / 10 mm | Saddle stitch | |
| **Zine, half-letter** | 5.5 × 8.5 in | none or 0.125 in | Saddle stitch | Letter sheets folded in half |
| **Zine, A5** | 148 × 210 mm | none or 3 mm | Saddle stitch | A4 folded |
| **Zine, quarter-letter** | 4.25 × 5.5 in | none | Saddle stitch | |
| **Mini-zine, 8 pages from 1 sheet** | ¼ of Letter/A4 | none | Fold + one cut | Special imposition |
| **Picture book** | 8 × 10 in / 8.5 × 8.5 in | 0.125 in | Hardcover/perfect | |
| **Newspaper daily strip** | landscape strip, 3–4 panels | — | — | Web and print strip |
| **Sunday page** | half or tabloid page | — | — | |
| **Webtoon (vertical)** | 800 px wide, long scroll | — | Web | Sliced into images for upload |
| **Social carousel** | 1080 × 1350 px (4:5) or 1080 × 1080 | — | Web | One panel or page per slide |
| **Trading card** | 2.5 × 3.5 in | 0.125 in | — | |
| **Postcard** | 4 × 6 in | 0.125 in | — | |
| **Poster** | 11 × 17 in / 18 × 24 in / A3 | 0.125 in | — | |
| **Custom** | any | any | any | Saved as your own preset |

Each print kind sets: trim, bleed, safe area, dpi (300 for colour, 600–1200 for black line art),
reading direction, binding, and the page-count rule. It can be changed later; a page-size change
offers to rescale the art or keep it.

---

## 12. Export center

One place, two paths: **Print it** (guided) and **Export files** (everything, by hand).

### Print it (the student path)

Pick how it's being printed. inkflo produces exactly the right files and a one-page instruction
sheet.

| Choice | What you get |
|---|---|
| **Home printer, booklet** | An imposed PDF on Letter/A4: pages already ordered for a fold-in-half booklet, duplex-ready, with "flip on short edge" instructions and a test-sheet first page. |
| **Mini-zine (one sheet)** | One page with the 8 panels laid out and rotated correctly, plus fold-and-cut lines. |
| **Print shop** | Single pages with bleed, crop marks and fonts embedded, as a PDF; plus a separate cover file. |
| **Print-on-demand** | Interior PDF (single pages, bleed, no marks) and a cover PDF with the **spine width calculated** from page count and paper. |
| **Saddle-stitch at a shop** | Printer spreads (imposed) or reader spreads, whichever the shop asks for, with creep compensation for thick booklets. |

**Page count is checked automatically:**
- Saddle stitch needs a multiple of 4; perfect bound needs an even number. If the count doesn't
  fit, inkflo **adds blank pages and says so**: "Your book has 22 pages; booklets need multiples
  of 4. 2 blank pages will be added."
- You choose where the blanks go: at the end, before the back cover, or after the inside front
  cover. You can turn one into a notes or credits page instead.
- A thumbnail preview shows the final order before export, with blanks marked.
- Covers can be self-cover (part of the count) or a separate cover on heavier stock.

Preflight runs first, and problems are listed in plain words with a "show me" link. Examples:
low dpi, lettering outside the safe area, missing bleed, a panel crossing the fold.

### Export files (the artist path)

| Kind | Formats |
|---|---|
| **Pages** | PNG, JPG, WebP, TIFF, PDF (single pages, reader spreads, printer spreads) |
| **Line art for print** | 1-bit bitmap TIFF/PNG at 600–1200 dpi (what print shops prefer for black ink) |
| **Layered** | PSD (panel groups become PSD groups), OpenRaster (.ora) |
| **Every layer separately** | A zip of PNGs, organised `page / panel / layer`. Or by type: all inks, all colours (flats for a colourist), all lettering. Transparent, same size, so they stack. |
| **Lettering** | SVG (vector balloons and text), or a lettering-only layer for translators |
| **Reading** | CBZ (+ComicInfo.xml), fixed-layout EPUB, Webtoon slices (long strip cut at gutters to the upload height), social carousel |
| **Motion** | `.2dope` project, GIF / MP4 |
| **Web** | Publish Kit site |
| **Book file** | `.inkflo` (backup and sharing) |

- **Export sets:** save a combination as a preset. "Send to colourist" could be inks as 600 dpi
  bitmap TIFF + flats as layered PSD + script PDF.
- **Colour:** RGB by default. Grayscale and 1-bit modes for black-and-white printing. CMYK is a
  documented conversion step, not promised from the browser (PLAN §8).
- **Scope:** whole book, a range of pages, selected pages, or the current panel.
- **Naming:** `{book}-{page:03}-{layer}` patterns, editable.

---

## 13. Layer types: Pencil, Ink, Colour (and friends)

Each layer has a **type**. The type is a starting set of defaults, not a cage.

| Type | Defaults | Notes |
|---|---|---|
| **Pencil** | Blue, doesn't print, pencil brushes, faded while inking | Can be shown as non-photo blue in exports for traditional inkers |
| **Ink** | Black, prints, ink brushes, **is the fill reference** | Raster or vector (the vector pen makes a vector ink layer) |
| **Colour** | Under ink, fill tools, reads lines from the ink | Flats, shading, highlights; can be clipped to flats |
| **Tone** | Screentone generator, prints | Manga tone, halftone shading |
| **Lettering** | Balloons and text (live) | Owned by Caption, visible everywhere |
| **Reference** | Doesn't print, can block fills | Colour-separation lines, photo reference, 3D guides |
| **Paper / Look** | Paper and Print Look settings | Bottom of the stack, or page-wide |

**Interchangeable and crossing:**
- **Change type at any time:**
  - Pencil → Ink: "promote to ink" recolours to black and turns printing on. This is the
    clean-pencils-as-inks shortcut.
  - Ink → Reference: lines block fills but don't print.
  - Colour → Ink: coloured linework.
- **Any brush works on any layer.** A pencil brush on an Ink layer gives textured ink. The layer's
  "use layer colour" switch decides whether the brush keeps its own colour or takes the type's.
- **Colour holds:** ink lines can be recoloured from a Colour layer (coloured outlines in skies or
  fire, a classic colourist technique) without editing the ink.
- **Any layer can be a fill reference**, and the Ink type is just the default one.
- **Every type behaviour is a switch** you can flip per layer: prints, fill reference, type
  colour, locked to panel, over frame. The type picks the starting switches; the layer row shows
  the type's icon.
- **Multiples:** several ink layers (line weights, background inks) and several colour layers
  (flats, shade, light) per panel.
- **Passes stay intact:** Draw's Pencil / Ink / Colour switch selects the top layer of that type
  in the current panel. Export by type gathers every layer of that type.

This replaces today's three fixed page bitmaps. Section 2's panel groups hold these typed
layers.

---

## 14. Imported images and page kinds

Artists can bring in their own images, or work from collaborators, for anything that isn't a
carved comic page.

**Page kinds** (picked when adding a page, changeable later):

| Kind | Default setup |
|---|---|
| Comic page | Panels, script, the usual desks |
| Illustration / splash | One full-bleed image area, no panels |
| Front cover / back cover / inside covers | Cover layout with title, credits and barcode slots; can be on a separate cover file in Print it |
| Pin-up / guest art | One placed image with a **credit line** |
| Text / design page | Free layout: text blocks, placed images, shapes (intro, afterword, character sheet, credits) |
| Blank | Kept for page count; Print it can fill these automatically (section 12) |

**Image layers:**
- **Import:** PNG, JPG, WebP, PSD (layers kept as layers), ORA, SVG. Drag and drop or a file
  picker.
- **Placement:** fit, fill, or actual size at the image's dpi. Move, scale, rotate and crop.
  Mask to a panel or let it bleed.
- **Use as anything:** a finished illustration, a cover, a photo reference (Reference type, not
  printed), or a texture.
- **Stored in the book** so it stays portable; an over-size image is downsampled to the page's
  dpi, with a warning.
- **Credit and rights:** each imported image has fields for artist, source and licence/permission.
  Credits can appear on the page (guest pin-ups) and collect into an automatic credits page.
  Preflight warns when an image from someone else has no credit, or when its resolution is too
  low for print.
- **Low-res warning:** the effective dpi at its placed size is shown on the layer and checked in
  preflight.

---

## 15. Export by type: inks only, colours only, pencils only

A one-click choice in Export files, for the whole book or any page range:

| Choice | Output |
|---|---|
| **Inks only** | Black line art on white or transparent; optional 1-bit at 600–1200 dpi (for inkers' portfolios, colourists, print) |
| **Colours only** | Flats and shading without lines (for colourists and checks) |
| **Pencils only** | Pencils, in grey or **non-photo blue** (for printing bluelines to ink by hand) |
| **Lettering only** | Balloons and text on transparent (for translators and letterers) |
| **Images only** | Placed images |
| **Combined** | Any mix of the above, as one image or as separate layers |

Each one exports as flattened pages, or as every layer of that type separately (section 12).

---

## 16. Script and panels, both ways

The script is not a one-way handoff. Script and Layout edit the same beats and panels.

- **Stable links:** each beat is linked to a panel group (section 2's panel identity), not to a
  reading-order number, so re-cutting or reordering doesn't scramble them.
- **Script on every desk:** a script sidebar in Layout, Draw and Caption shows the selected
  panel's beat, editable in place. Editing the words updates the linked balloons live.
- **Drag to assign:** drag a beat onto a panel, or a panel onto a beat, to link them. An unlinked
  panel shows "no beat"; an unlinked beat shows "no panel yet".
- **Changes go both ways:**
  - Add a panel in Layout → an empty beat appears in the script.
  - Add a beat in Script → offer to add a panel, by splitting the selected panel or adding an
    empty cut.
  - Split a panel → its beat can be split too.
  - Merge panels → their beats merge.
  - Reorder beats → offer to reorder the panels (swap slots), and the other way round.
- **Book-level script:**
  - **Outline view:** all pages, all beats.
  - Drag beats between pages; the pages reflow.
  - **Page-turn markers** show where each page ends.
  - Import plain text or Fountain, and export a script PDF for a teacher or editor.
- **When work already exists downstream:** a script edit that touches inked or lettered panels
  says so once, for example "Panel 3 is lettered; update the balloon text?". It is one undo step.

---

## 17. A process that's easy to finalize and easy to fix

The desks are a process (Script → Layout → Draw → Caption → Print), never a locked wizard.

- **Go back any time.** Every desk stays editable. A backward edit that affects finished work asks
  once and is one undo step, for example "Re-flood 4 fills on page 7?" (PLAN's gates).
- **Clear status:** each page and stage shows to do / in progress / done on the stage rail and
  the book's production board. Marking a stage done can run that stage's checks first.
- **Finalize checklists:** per page and per book. Plain-language issues, each with a "fix it"
  link that jumps to the panel, balloon or layer. Examples: lines not lettered, low dpi images,
  missing credits, page count, lettering outside the safe area.
- **Named versions:** "Pencils done", "Sent to printer". Compare and restore, on top of the
  automatic restore points.
- **Optional lock:** lock a finished page or stage against accidental edits; unlocking is one
  click.
- **Undo everywhere:** one undo history per book, across desks.

---

## 18. Readable lettering: warnings, snapping and fixes

Lettering is judged at its **real printed size**, not its size on screen. inkflo knows the trim
and the print kind, so it knows how big every letter will be on paper (in pt) or on a phone
(in px).

**Readability levels** (thresholds come from the print kind's preset and are editable in the
book style sheet; the defaults below are starting points to tune with real printed tests):

| Level | Print (typical comic lettering) | Webtoon / screen | Shown as |
|---|---|---|---|
| **Good** | ≥ 7 pt cap height for body text | ≥ 16 px at the target width | nothing |
| **At risk** | 6–7 pt, or a thin font, or low contrast | 12–16 px | amber dot on the balloon |
| **Won't read well** | < 6 pt, hairline outline < 0.25 pt, text over busy art with no balloon | < 12 px | red dot; listed in finalize |

**Checks (all automatic, all explainable):**
- **Type size** at print size, per balloon and per line.
- **Stroke weight:** text outlines and balloon borders thinner than the press can hold (hairlines).
- **Contrast:** text colour against the balloon fill, or against the art behind captions and SFX
  without a balloon.
- **Effects over text:** Print Look textures, halftone and grain skip lettering by default.
  Turning that on is warned about.
- **Font weight:** very light or condensed fonts at small sizes.
- **Rotation and warps:** SFX and text on paths that are too squeezed to read.
- **Per export target:** a book letters fine at comic size but shrinks for manga digest or a
  phone. Export checks each target and warns before export ("Page 4: 3 balloons fall below
  6 pt at digest size").

**Snapping:**
- **Size snaps** to the style sheet's steps: Small / Body / Big in pt, plus custom steps. Dragging
  a size handle clicks into those steps. Holding Alt frees it.
- **Copyfit never goes below the minimum.** When text doesn't fit, inkflo grows the balloon
  first, then warns; it never silently shrinks text into the "won't read" zone.
- **"Keep readable" lock** (on by default): edits that would push a balloon into the red snap it
  back to the minimum and show why. It can be switched off per balloon for deliberate tiny text
  (whispers, background chatter), and those balloons are marked "small on purpose" so they don't
  nag.

**One-click fixes**, from the warning or the finalize checklist:
- **Enlarge to minimum** (and grow the balloon to fit).
- **Grow balloon** at the current size.
- **Thicken outline** to the press minimum.
- **Add a backing** (caption box or soft knock-out) behind text on busy art.
- **Switch to a heavier face** from the same family.
- **Show me** jumps to the balloon. **Fix all on this page** applies the safe fixes in one undo
  step.

**See it real:** a **Print size** view (calibrated to the screen's physical size) shows the page
at its true printed size, and a **Phone** preview shows the Webtoon/carousel size.

---

## 19. Read mode: preview the book like a comic reader (asked 2026-11-10)

- **Preview / Read:** a full-screen reader on the book screen and every desk, built like a CBZ
  reader.
  - Single page, two-page spread (with the cover alone), or vertical scroll for Webtoon books.
  - Right-to-left for manga.
- **Page turn animation:** a paper-like page curl (or slide/fade, and none with reduced motion).
  - Turn by swipe, click, arrow keys or the spacebar.
  - Optional guided view zooms panel by panel, from the same panel order the motion comic uses.
- **What it shows:** the print render (no pencil, look applied), exactly what CBZ and print get.
  Pencil and guides can be toggled on for review.
- **Reuse:** the same reader becomes `index.html` in the Publish Kit and `motion.html`'s still
  mode, so preview equals publish.

## 20. 3D book mockups for crowdfunding (future, asked 2026-11-10)

- **A procedural 3D mockup of the printed book** for Kickstarter and fundraising pages: "what
  it will look like".
- **Built from the print edition:**
  - Trim and page count give the spine width.
  - Binding gives the shape: floppy with staples, perfect-bound with a flat spine, or hardcover
    with boards and headbands.
  - Paper stock gives page-edge colour and thickness.
  - Cover finish: matte, gloss, spot gloss.
- **Scenes:** front cover, open spread (pages curve at the gutter), stack of copies, fanned
  pages, held in hand (simple silhouette), on a table with a soft shadow. Lighting and background
  presets, plus a turntable animation.
- **Export:** PNG/JPG at social and Kickstarter sizes (header 1024 × 576, square, story), a
  transparent PNG, a turntable GIF/MP4, and a mockup sheet showing several editions side by side
  (softcover vs hardcover vs deluxe).
- **How:** a small WebGL renderer, procedural geometry (no 3D assets to license), and the one page
  renderer for textures. Rendered on demand, never stored in the book.

---

## Suggested order (revised)

1. **Shell:** Studio/Focus toggle, per-desk tool rails with flyouts and a top settings bar, dark
   mode (Light / Dark / System) and the grid backdrop.
2. **Layers:** typed layers (section 13) inside panel layer groups, masking, Over frame / Over
   panels, image layers and page kinds (section 14), migration of existing books. Then the
   two-way script ↔ panel links (section 16), which need stable panel identity.
2b. **Print kinds + Export center:** the preset table (section 11), Print it (imposition,
   automatic blanks, POD spine, mini-zine), Export files (PDF, TIFF, PSD, per-layer zips, Webtoon
   slices, EPUB), export by type (section 15), finalize checklists and named versions
   (section 17).
3. **Lettering v2:** port 2Dope's caption renderer, Letter tool and fonts; add the script link,
   character styles and book style sheet, the readability guard and size snapping (section 18);
   export live captions to 2Dope.
4. **Inking:** brush library + Brush Studio → vector pen → assist (QuickShape, guides, rulers,
   speed/focus lines) → line and fill detection (section 7) + colour.
5. **Remaining tools:** selection painting, transform distort/warp, adjustments, light table.
5b. **Print Look + preset library:** paper generator, halftone/tone generator, ink modules,
   ready-made looks; one preset system for layouts, looks, lettering, brushes and templates.
   (Halftone/tone could move earlier if colour work needs it.)
6. **Motion desk.**
7. **Read mode** (section 19), then the Publish Kit reader that reuses it.
8. **3D mockups** (section 20), after print kinds exist.

---

## Original suggested order (superseded above)

1. **Studio/Focus shell + per-desk tool rails** with flyouts and the top settings bar. Use the
   existing desks.
2. **Layer tree with panel groups**, masking and Over frame. Migrate existing books. Render and
   export follow. This is the biggest change, so it goes early, before more art tools depend on
   the old passes.
3. **Brush library + Brush Studio**, then the vector pen, rulers and fill family.
4. **Motion desk** (cues per panel), feeding the 2Dope export.

Each step is shippable on its own. Pending from before: opening the `.2dope` export in the
2Dope app by hand.
