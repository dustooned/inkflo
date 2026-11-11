# inkflo — the plan

**One book, one page, five desks. A comic studio that finishes the comic.**

inkflo is a comic production system for students and indie artists. Script, Layout, Draw,
Caption and Print are not separate apps or a wizard you click through once. They are five
views of the same document, so a panel you shape in Layout is already the mask you draw inside,
the clip for colour, and the box that lands on the print sheet. Draw is one desk with three
passes — pencil, ink, colour — because that is how the page is actually made. When the book is
done, one export produces the print PDF, the CBZ, the motion comic and a website — packaged as
a zip with a page of instructions that gets it online free, on GitHub Pages, without touching a
terminal.

This document is the working plan: what we are building, what it should feel like, what
programs and formats we reverse-engineer to get there, and in what order.

---

## 1. Why this, and why now

2Dope already proved the hard parts: a client-only TypeScript app with no backend, one local
document, workspaces as lenses over it, a deterministic compositor, a self-contained ZIP
project format, and a GitHub Pages deploy. inkflo reuses that spine for a different craft.

The difference is where the craft hurts. 2Dope is about *motion*: timing, exposure, keys.
inkflo is about *throughput and finishing*: a 24-page book has hundreds of handoffs, and the
tools artists already own are either too heavy (Clip Studio EX, InDesign) or stop at the
drawing (Procreate, Sketchbook). Nobody owns the boring middle: panels, lettering that
follows the script, flats that follow the ink, print setup, and the website.

### The five pains we are actually solving

| Pain | What it costs today | What inkflo does |
|---|---|---|
| Dialogue is retyped three times | Script → lettering → web captions | Script is the source; balloons, captions and web text read from it |
| Panels are redrawn per stage | Layout sketch → guides → crop → print | One panel object: mask for ink, clip for color, box for print |
| Flats go stale | Re-ink a page and the flats no longer line up | Flats are derived regions bound to ink cuts, with an explicit "re-derive" |
| Export is a specialist skill | PDF/X, bleed, DPI, CMYK, CBZ, hosting | Four presets that are correct by default, with a preflight that explains |
| Publishing is a second job | Build a site, buy hosting, wire Patreon | Publish Kit: a zip that is already a working site, plus a support page |

### Positioning

- **Clip Studio EX** — the industry answer, desktop, expensive, export is a hobby of its own.
- **Procreate** — the best drawing feel, no production pipeline, no pages.
- **Clip Studio EX** — the industry answer, desktop, expensive, export is a hobby of its own.
- **inkflo** — Procreate's feel, Clip Studio's ink, and a pipeline neither has:
  narrow enough to teach in an afternoon, complete enough to ship a book.

Explicit non-goals for v1: full animation, 3D, painting-grade brushes, real-time
collaboration, a backend or accounts.

---

## 2. The Spine — the synchronization system

The Spine is the single shared thing every desk edits. Everything in this plan depends on it,
so it gets designed before any tool.

```
Book
 ├─ Chapter  ── Page ── Panels ── LayerSlots (rough, ink, flat, shade, tone, letter)
 │                 └── PageState (per pass: todo | wip | review | done + who + when)
 ├─ Palette (book-level inks and spot colours)
 ├─ Caption (fonts, balloon styles, SFX set)
 └─ Publish (title, author, theme, support cards, motion cues)
```

**One document, five lenses.** Each desk is a projection of the same `Book`, not a copy:

| Desk | Sees | Edits | Locks (by default) |
|---|---|---|---|
| Script | page beats, panel descriptions, dialogue, captions, SFX | text, panel intent, page order | artwork |
| Layout | page, panels, gutters, tiers, shot, beat rhythm, reading path, balloon space | geometry, templates, camera, flow | artwork |
| Draw | the active panel, pass by pass: pencil → ink → colour | rough, ink, flat/tone/shade | caption |
| Caption | balloons, tails, captions, SFX, type | letter slot, balloon geometry, type | art pixels |
| Print | imposed pages, bleed/trim/safe, preflight | page setup, marks, output | everything |

The production board still tracks seven states per page — one per pass, not one per desk — so
Draw can be inked and half-flatted at once without becoming two places to work.

**Gates, not wizards.** Every page carries a `PageState` with one row per pass — script,
layout, pencil, ink, colour, caption, print. The
gates default to forward-only: you can always go back and edit, but a backward edit that
affects finished downstream work asks once ("Re-derive 4 flats on page 7?") and is one undo
step. This is the same instinct as 2Dope's linked cels (`core/cellink.ts`): edit once, ripple
deliberately, never silently.

**The production board** is the Spine made visible: pages down the side, passes across the
top, a dot per page/pass. It is the kanban students actually need, the teacher's view of a
class, and the artist's answer to "what is left". The bottom rail is the same data, focused
on one page.

**Determinism.** One compositor renders every output. Print, web page, thumbnail and motion
frame all come from `render(page, pass, profile)`, so what you approve on screen is what
ships. This is 2Dope's compositor and residency model, reused.

**Undo across desks.** A single command stack, with pass-scoped views: `Ctrl+Z` in Draw
undoes the active pass unless you hold the "everything" modifier. Every ripple is one command.

**Storage.** IndexedDB like 2Dope (autosave, versions, content-addressed page planes), plus
`.inkflo` as a self-contained ZIP: `book.json` (schema-versioned), `pages/*.png|webp`,
`thumbs/`, `publish/`, `LICENSE.txt`. Older builds refuse newer schemas rather than silently
dropping data.

---

## 2b. The shell — home, book, desk

Three screens over one document model, and the same shape on every one: rail left, canvas centre,
inspector right, stages bottom. That consistency is what makes five desks feel like one app
instead of five tools.

- **Home.** Folders and books, Procreate-style. A cover is drawn from the book's first laid-out
  page, with its stage and last-touched page underneath. Folders filter; there are no stacks —
  stacks are an app-version idea, not a beta one.
- **Book.** Pages as a grid with per-page stage dots, a **Preview** that flips through the
  sequence at reading speed, **Continue** at the stage you left, and a New page card.
- **Desk.** Five stages on the bottom rail with a docket that travels between them; the tool rail
  and the context bar change per desk; the inspector shows the page or the selection. Opening a
  book puts you back at the stage it was in — the resume, not a menu.

Prototype: [design/inkflo-app.html](design/inkflo-app.html) — home, four books, six pages, and all
five desks working end to end.

---

## 3. The five desks

### Script — the page as a text object

A real script editor, but short-form: each page is a list of panels; each panel has a
description, dialogue lines with a speaker, captions, SFX and a beat note. Import from
plain text or Fountain; export back to PDF for a teacher or an editor.

The point is not screenwriting software. The point is that **the script knows the page**. Move
a beat, and the layout gets a new empty panel placeholder; rename a speaker, and every balloon
with that tail relabels.

### Layout — panels and storytelling

Layout is where the page is directed, not just ruled up. Panel tool with grid templates
(3×3, 2×3, splash, tiered, 4-koma, webtoon strip), drag to resize, gutter snapping, tier
alignment and reading order — then the storytelling layer on top:

- **Carve** — one stroke splits every panel it crosses (see below). Templates only seed cuts;
  after that the page is free.
- **Shot** per panel: wide, medium, close, detail, from-behind, POV. Choosing one nudges the
  panel's proportion and its relationship to its neighbours.
- **Beat** per panel: establish, reaction, action, pause, reveal. The spread shows the page's
  rhythm as a bar, so a student can see a page that is five reactions in a row.
- **Flow**: the reading path drawn through the panels, with a page-turn marker where the eye is
  meant to carry to the next page.
- **Balloon space**: reserved zones, not balloons — anchor, preferred side, avoid neighbours.
  Caption sets the type later; Layout guarantees there is room for it.
- **Camera**: a start and end framing per panel, because that is what the motion comic uses.

Page templates carry trim, bleed and safe guides from the start, so the layout is print-shaped
before anyone draws.

#### Carving panels

Panels are not boxes you drag; they are what is left after a cut. The knife is a gesture: draw
across the page and it cuts. A stroke that crosses several panels cuts all of them, so one
gesture can turn a page into six panels. *Working prototype: [design/panel-carving.html](design/panel-carving.html).*

- **The cut is stored, the panels are derived.** A page keeps its cut paths; panels are
  recomputed by folding the cuts over the page rectangle. Move the gutter, change the outline,
  soften the curve — every panel on the page re-derives. Undo removes the cut and the page knits
  back together. This is the Spine applied to geometry: one source, many renders.
- **The cut is exact; the gutter is a band.** The split runs trim to trim at any angle, and the
  gutter is stroked from the same path. Where two cuts cross, the bands are unioned and their
  outline is drawn once — so the gap is a clean plus, not two lines crossing through it. The two
  borders sit at exactly ±gutter/2; nothing is inset per panel, so nothing can taper, wedge or
  stop short at the page edge.
- **Two cut modes.** *To edges* cuts the whole page along the line; *Panel only* stops at the
  boundaries of the panels the stroke touches, so a page can be cut one panel at a time. The mode
  is a property of the cut, set in the context bar and remembered.
- **Freehand is the input.** Curves come from the hand; a Curve control smooths the stored
  stroke (0–5), so a shaky cut becomes a clean arc. Shift gives a straight cut. A stroke that
  starts or ends inside the page is extended along its own direction to the trim, so a short
  flick still cuts the whole page.
- **Outline is a property of the page** (later, of a panel).
- **Reading order** comes from position and stays draggable — the one thing carving cannot infer.

What it deliberately is not: a grid with adjustable gutters. Grids are presets that seed cuts
(4, 6, 9, rows); after that the page is free.

**Linked by default, independent on purpose.** A panel is its own object — its own art slots,
caption refs and stage state — while its outline is derived, until you take it. Three moves:

- **Divider drag** (grab a linked panel's edge) moves the cut that made it. Every panel on both
  sides re-derives together, gutter preserved. This is the synchronous edit: you are moving the
  knife line, not the panel.
- **Panel drag** (grab the body) detaches it: the outline freezes, the panel lifts on a shadow,
  and it can overlap its neighbours. Relink puts it back under the knife.
- **Corners.** A detached panel's corners drag as vertices. A linked panel's corners are the
  cut's intersections, so editing them *is* editing the cut — the same gesture at two levels.

Overlap is a z-order, not a special case: a detached panel draws above the page until you move
it back. That is how a splash breaks the grid, and how a student can rough a layout that the
knife could not cut yet.

**Reorient by placement.** Press and hold a panel (260ms on touch; immediate drag with a mouse)
and drop it on another panel: the two trade slots, and each takes the shape of the slot it lands
in. Placement sets size — nothing is dragged to fit, and no panel edge has to be rebuilt by
hand. A swap is a permutation of slots, so the page stays tiled and the gutters stay honest; only
a float breaks the tiling, and only a float leaves a hole.

**Transform that carries the page with it.** Select a panel and its cut edges grow handles.
Dragging one moves the cut underneath — in X or Y — so every panel that shares that cut resizes
at the same time. There is no per-panel resize that leaves a neighbour behind: the panel you
grabbed changes, and the rest of the page absorbs it. That is the difference between moving a
box and composing a page.

Still to design: **insert/push reflow** — drop *between* two panels and push them apart instead
of swapping; **multi-select reorder** for moving a tier at once; **dividers** — a cut that stops
on an existing cut instead of the trim (a T-junction); **shape tool** — draw a closed loop and
get a panel; **free transform** for detached panels (scale/rotate their own polygon);
**per-cut and per-panel gutter/outline**; and **carve from a scribble** that simplifies a rough
loop into a 4–8 segment polygon.

#### Tools, per desk

Every desk carries its own small tool set — three to five tools, never more — plus one context
bar that shows only the sub-controls for the tool in hand. This is the Affinity / Clip Studio
pattern: a simple rail, a deep bar, no palette sprawl. Glyph on the rail, name under it, options
above the canvas.

| Desk | Tools | Context bar |
|---|---|---|
| Layout | Knife, Move, Resize, Shape | gutter / outline / curve; swap or float; even-out |
| Draw | Pencil, Ink, Colour, Eraser | size / opacity / taper; pass switch; flat tolerance |
| Caption | Balloon, Tail, Caption, SFX | type, copyfit, tail shape, reading-order check |
| Print | Imposition, Marks, Preflight | sheet, bleed, marks, ink coverage |
| Motion | Camera, Cue, Timing | framing, hold, transition, SFX |

Two rules make it feel simple: **a tool owns its options** (you never leave the canvas to change
a setting), and **a tool never appears in a desk that cannot use it** (no Knife in Caption, no
Balloon in Print). The tool also gates behaviour, not just settings — with the Knife in hand a
drag anywhere is a cut; with Move, the same drag lifts a panel.

### Motion — the comic that moves

The same pages, given time. Motion is a desk, not a second app: Layout already gave each panel a
camera (start and end framing) and Caption already owns the words. Motion adds a cue per panel —
enter, hold, pan, parallax, typewriter, SFX — plus page order and an audio track.

Playback and export reuse 2Dope's compositor and video path, so a motion comic publishes as
MP4/WebM or `motion.html`, and the same cue list can be handed to **2Dope** as a scene for real
animation. That handoff is the point: inkflo makes the comic, 2Dope makes it move.

### Draw — one desk, three passes

Drawing is one place with a pass switch, because artists already think in passes and because
changing desks mid-flow is what breaks concentration.

**Pencil → Ink → Colour**

- **Pencil.** A blue-pencil slot per panel, deliberately limited: one rough brush, an eraser,
  onion-skin against neighbours. Rough never prints; it exists so the inker can see intent.
- **Ink.** Crisp line engine (2Dope's stroke pipeline, tuned for closure), gap-closing preview,
  line-weight presets by panel size, taper, and a closure check before you leave the pass.
- **Colour.** Flats derived from ink cuts, a palette that belongs to the book (spot inks, paper
  white, shadow ramp), tone as a first-class slot (halftone/screentone with angle, frequency and
  shape, generated procedurally), shade clipped to flat, and an explicit re-derive when ink
  changes.

The pass switch never hides a pass, it changes what you are editing. A page can be inked and
half-flatted, and the desk shows both.

The engine is specified in [docs/BRUSH-AND-INK.md](docs/BRUSH-AND-INK.md): a stamp-based brush with
Procreate's parameter set and dynamics, plus Clip Studio's inking controls — closure, gap-closing
fill, reference layers, stabilizer levels and an optional vector ink pass. That document is the
contract for M2; the REA work in `docs/REA-QUEUE.md` fills in the numbers.

### Caption — lettering that follows the script

Balloons, tails, captions, SFX and the type system. Because Script owns the words and Layout
reserved the space, captioning is placement and typography, not transcription: pull a line from
the script, drop it in a balloon, and the tail snaps to the speaker the block already names.

Copyfit, tail shapes, a balloon library per book, SFX with a warp/blur library, and a
reading-order check that flags a balloon the eye reaches before its speaker.

### Print — the sheet, not the page

Imposition (single, spread, signature), bleed/trim/safe overlay, crop marks, page numbers,
ISBN/barcode slot, and a preflight that reads like a checklist instead of a warning wall:
resolution, ink coverage, font embedding, transparent pixels on the trim, panels crossing the
gutter.

### Study — the lens for learning

Not a stage, a sixth lens available on any page, including one you did not draw. It
overlays the page with what a teacher would point at: panel geometry and reading path, gutter
rhythm, balloon placement and tail direction, line-weight map, and where the eye lands first.

Students can trace over it on a scratch layer, pin notes to panels, and export a **breakdown
sheet** (page + overlay + notes as PDF) for a class or a portfolio. It is also the honest way to
study a published comic without copying it: the overlay is analysis, the scratch layer is
practice, and neither is exportable as artwork.

---

## 4. How it should feel

**The printer's desk, not a cockpit.**

The reference is a physical workspace: bristol board on a light table, pages taped at the
corners, a blue pencil, an ink bottle, a job docket moving along the bench. Tools are objects
with weight; the page is paper, not a viewport. We are not building a dark IDE with neon
accents, and we are not building a skeuomorphic imitation of wood and brass either. The
metaphor is carried by *material and motion*, not by textures of leather.

### Surfaces

Paper is the only lit surface. Everything else recedes: chrome in warm graphite, no glass, no
glow, no drop shadows except the physical ones a page and a panel would actually cast.

### Palette

| Token | Value | Use |
|---|---|---|
| `--paper` | `#EDE6D8` | the board / light table |
| `--paper-lift` | `#F7F2E8` | the page itself |
| `--ink` | `#191A1F` | text, ink lines |
| `--ink-soft` | `#4A4C55` | secondary text |
| `--rule` | `#C9BFA9` | hairlines, gutters |
| `--spot-red` | `#B8432F` | Caption desk accent, corrections |
| `--spot-ochre` | `#A8762A` | Script desk accent |
| `--spot-teal` | `#2F6F7E` | Layout desk accent |
| `--graphite` | `#5E5F68` | Draw desk accent |
| `--spot-green` | `#3E6B3A` | Print desk accent |

Each desk owns one accent, used only in the rail, the header rule and the active tool — never
on the artwork. A student always knows which desk they are at from colour alone. Inside Draw the
three passes keep their own small marks (blue pencil, black ink, red flat) without changing the
desk accent.

### Type

- UI: a neutral grotesque (Inter / system), 13–15px, tabular numerals for anything measured.
- Script and captions: a serif (Source Serif / Iowan), because that is what a script looks like.
- Comic lettering: a curated set of open-licence comic fonts, shipped as *lettering presets*,
  not as UI type.

### Motion

Page turns and panel snaps feel like paper: fast, slightly flexed, no bounce. The docket slides
along the rail when you change desk. Nothing animates that the user did not just touch.

### The rail

The bottom rail is the whole product in one line: `SCRIPT · LAYOUT · DRAW · CAPTION · PRINT · MOTION`,
with the current page's docket clipped to the active desk and a small dot per desk showing that
page's state. Drag the docket to move the page forward. It is a conveyor, not a tab bar.

Next to the canvas sits a narrow tool rail; the tools change with the desk (see *Tools, per
desk*), and the bar above the canvas shows only the options that tool can use. Draw expands in
place when it is active: three pass chips (`Pencil · Ink · Colour`) appear in the header beside
the page crumb, so the five-desk model never hides the three passes.

### Calm defaults

One tool visible, one panel of options, one accent. Advanced controls fold away (2Dope's
Simple/Full pattern). Phone and tablet get the same layout with the rail collapsed to a
thumb-reachable bar; the "Easy" mode is one panel at a time with three buttons: draw, letter,
publish.

### Accessibility

44px targets, keyboard-complete (no tool requires a drag), visible focus in ink-blue,
`prefers-reduced-motion` honoured, and a "Night desk" theme that is ink-on-black rather than
an inverted filter.

---

## 5. Export — the Publish Kit

Export is where the product earns its name, so it gets one dialog with four outputs and no
jargon on the surface.

### The four outputs

1. **Print** — PDF with pages, bleed, crop marks and a preflight report; plus per-page TIFF/PNG
   at 300–600 dpi; plus a `printer-handoff.md` that states trim, bleed, paper, binding and
   gutter allowance in the printer's own language.
2. **Web** — the Publish Kit (below). A zip that is already a working comic site.
3. **Motion comic** — MP4/WebM *and* `motion.html`, a self-contained player that can live on
   the same site.
4. **Archive** — `.cbz` with `ComicInfo.xml`, plus the `.inkflo` source.

### Publish Kit anatomy

```
inkflo-<book>-<version>/
  index.html                 single-file reader, no build step, no dependencies
  motion.html                motion comic player (only if cues exist)
  support.html               support / membership page (optional)
  assets/
    pages/001-<hash>.webp    content-addressed, immutable
    thumbs/…
    og/001.png               auto-generated social cards
  theme/
    theme.css                design tokens only
    theme.json               name, author, options
  data/
    comic.json               the contract: title, author, pages, direction, cues
    chapters.json
  .github/workflows/pages.yml
  README-PUBLISH.md          numbered steps with the exact clicks
  UPDATE.md                  how to add a page, change a theme, fix a 404
  CREDITS.md / LICENSE.txt
```

`comic.json` is the only contract between the app and the site. The site is deliberately dumb:
it reads JSON and renders. That means a student can hand-edit it, a teacher can generate it,
and a future inkflo version can still publish into an old site.

### Themes

Presets are *site archetypes*, not skins, because the reading mode and the page geometry have
to agree:

| Preset | For | Defaults |
|---|---|---|
| **Newsprint** | classic page-flip comic | 6.625×10.187 in trim, LTR, spread view |
| **Tankōbon** | manga | B6, RTL, right-to-left nav, gutter-aware |
| **Webtoon** | vertical strip | 800px column, infinite scroll, no page breaks |
| **Sunday** | newspaper strip | 3–4 panels, single column, large type |
| **Zine** | riso / photocopy | A5, two-colour, rough paper texture |
| **Noir** | high-contrast digital | dark chrome, page-glow, minimal nav |

Every theme is `theme.css` + `theme.json` only: tokens plus a handful of slots (nav shape,
page frame, typography scale, motion level). "Resources for future customization" means we ship
the token file, a one-page guide, and eventually an in-app theme editor that writes the same
file. No theme may require touching `index.html`.

### Support pages

A small builder inside Publish: cards for Patreon, Ko-fi, Gumroad, Discord and a newsletter,
each with a copy template and tier table. It writes `support.json`, which the site renders.
Presets: *Early access*, *Behind the scenes*, *PDF rewards*, *Name in the credits*,
*Discord role*. We are honest about gating: the exported site is a speed bump, not a lock;
real paywalled content belongs on Patreon, and the kit links there instead of pretending.

### Getting it online, for free

Two paths, both documented in `README-PUBLISH.md` with screenshots:

**A. No account.** Unzip, drag the folder onto Netlify Drop or Cloudflare Pages. Done. This is
the path for a class that has 20 minutes and no GitHub accounts.

**B. GitHub Pages.** Create a repository, upload the folder contents, Settings → Pages → deploy
from `main` / root. The kit also ships `.github/workflows/pages.yml` for people who prefer the
Action, and `UPDATE.md` covers the three failures that actually happen: 404 on deep links
(because of relative paths), a stale cache after replacing pages, and the 100 MB file / 1 GB
site limits.

The kit also generates `feed.xml`, `sitemap.xml` and per-page OpenGraph images, because a comic
nobody can find is not published.

### Updates

Re-export is incremental: only changed pages get new hashes, `comic.json` gets a new version,
and `UPDATE.md` says "replace `assets/pages/`, upload `comic.json`". The site shows a "new
chapter" badge from `chapters.json` dates. No rebuild, no CLI.

### Class mode

A teacher creates an assignment (page count, script locked, rubric). Students open the
`.inkflo` template, work the desks, and export a submission zip. The teacher opens it, sees the
pass board, and can publish a class gallery with the same Publish Kit in `mode: "class"`.

---

## 6. What we reverse-engineer, and why

Full queue with questions, artifacts and evidence rules: [docs/REA-QUEUE.md](docs/REA-QUEUE.md).

The short version, in order:

1. **2Dope** — the spine itself (already ours): document, history, residency, compositor,
   export, deploy.
2. **Clip Studio Paint 1.5** (installed) — page/story model, frame borders, balloons, tones,
   mono vs colour documents, print presets. The comic app to beat.
3. **Krita** (installed, open source) — comic manager, templates, halftone filter, layer
   groups. Read the source, not the binary.
4. **Procreate** (IPA evidence already captured) — pencil/ink feel and brush import, only where
   2Dope's findings do not already cover it.
5. **DesignCraft + PdfCraft** (cloned source, installed CLIs) — page masters, text flow,
   imposition, PDF writing, bleed and marks.
6. **FilmCraft** (cloned source) — motion timeline, muxing, export plumbing for motion comics.
7. **Moho 14** (installed) — camera moves and panel transitions for motion comics.
8. **Two or three real GitHub-Pages webcomics** (captured statically) — reader archetypes and
   navigation.
9. **Patreon / Ko-fi public creator pages** (captured) — the support-card schema.
10. **Formats** — `.clip`, `.procreate`, `.kra`, `.psd`, `.cbz` + `ComicInfo.xml`, PDF/X. This
    is the highest-leverage REA we can do: interop is what makes an app adoptable.

Rules we keep, from 2Dope's practice: behaviour contracts only, no proprietary code, no
shipped assets, clean-room with attribution for Apache-2.0/MIT sources, and every finding
labelled **observed** (binary), **documented** (manual) or **inkflo choice**.

---

## 7. Build order

Each milestone is a commit-sized slice with a testable "done when". No milestone starts before
the Spine supports it.

| M | Slice | Done when |
|---|---|---|
| **M0** | Shell: home/folders/books, book grid, desk frame, stage rail, tool rail + context bar, undo | A book opens at its last stage and every desk is reachable |
| **M1** | Script + Layout desks | A script's 24 panels become a 6-page layout with shots, beat rhythm, reading path and balloon space |
| **M2** | Draw desk — Pencil and Ink passes | One page goes rough → inked with closure check; the pass switch and undo behave across both |
| **M3** | Draw desk — Colour pass | Auto-flat from ink, palette applied, tone placed, re-derive after an ink edit |
| **M4** | Caption desk | Balloons typeset from script, tails snap to speakers, SFX placed, copyfit, reading-order check |
| **M5** | Print desk | 24-page PDF with bleed, crop marks and a passing preflight |
| **M6** | Publish Kit | Exported zip serves a working site locally and on GitHub Pages, with themes and support cards |
| **M7** | Motion desk | Panel cues render to MP4 and `motion.html`, and the same cue list opens in 2Dope as a scene |
| **M8** | Class mode + Study lens | Teacher creates an assignment; student submits; class gallery and breakdown sheets publish |
| **M9** | Interop | Import `.kra`/`.psd` layers; export `.cbz`; round-trip a `.clip` page if the format allows |

---

## 8. Risks and decisions to make early

- **CMYK in a browser.** We cannot reliably produce true CMYK from Canvas. Decision: ship RGB
  PDFs with a correct preflight and a `printer-handoff.md` for digital/POD printers, and offer
  an optional Ghostscript/ImageMagick conversion script. Do not promise PDF/X-4 in v1.
- **Fonts.** Caption needs real comic fonts. Only open-licence families ship; users can import
  their own, and we never bundle a commercial font.
- **Tablet memory.** Reuse 2Dope's residency model from day one, or M2 will not run on an iPad.
- **Scope gravity.** Every desk invites animation. The motion comic is a *cue list over panels*,
  not a timeline with keys. If we add keyframes, we have rebuilt 2Dope.
- **Students without GitHub.** Path A (drag to Netlify) must be as polished as Path B, or the
  class use case dies on account creation.
- **IP.** Clip Studio's tones, brushes and templates are not ours to ship. Procedural tones,
  original brushes, and clean-room behaviour only.

---

## 9. Open questions

1. **First platform:** tablet web (draw-first) or desktop web (layout-first)? It changes the
   default desk and the canvas budget.
2. **Print reality:** is a real print run in scope, or is "print" a high-res PDF for a local
   shop or POD? This decides how much of M5 we build.
3. **Motion comic depth:** subtle camera and typewriter, or panel-to-panel choreography with
   SFX? The second is a different M7.
4. **Support pages:** Patreon-first, or platform-neutral cards from day one?
5. **Class mode:** is this a teacher tool (assignments, rubrics) or just a personal study
   tracker with a shareable gallery?
6. **Caption scope:** lettering only, or does Caption also own the web captions, alt text and
   the motion-comic titles? Owning them keeps one text source; it also makes Caption bigger.
