# REA queue — what we study, in what order, and why

Companion to [../PLAN.md](../PLAN.md). Every study here answers a question we cannot answer
from scratch, and produces a **behaviour contract** we can test — not a feature list.

## Rules

1. **Behaviour, not code.** We do not decompile for implementation, ship proprietary assets,
   or copy structures that are not published. Apache-2.0/MIT reference sources are read
   directly and reused with attribution.
2. **Label every claim.** `observed` (read from a shipped binary, package or file format),
   `documented` (manual, spec, public docs), `inkflo choice` (our design decision). Never let a
   choice wear the costume of an observation.
3. **One question per pass.** "What does Clip Studio do for balloons?" is too big. "Where does a
   balloon tail attach when the speaker has no head visible, and what happens when the balloon
   is moved?" is a contract.
4. **Evidence lives in the repo.** Each pass writes `.rea-work/<target>/` with digests, the
   Evidence IDs used, and a short `README.md` of findings. The portable bundle is exported, not
   re-derived.
5. **Stop at the contract.** A study ends with acceptance criteria (initial state → one action →
   expected state → undo/cancel), not with code.

---

## Tier 1 — the comic desk

### 1. Clip Studio Paint 1.5 — `C:\Program Files\CELSYS\CLIP STUDIO 1.5\CLIP STUDIO PAINT\CLIPStudioPaint.exe`

The comic standard. The reason to study it is **page structure**, not brushes (2Dope already
covers brushes).

| Question | Method | Unblocks |
|---|---|---|
| How is a multi-page work modelled — pages, spreads, story folders, and what is the unit of undo? | Static PE read (`open_binary` → Ghidra): look for story/binder/page types, string clusters, command tables. Plus the manual's file-structure pages. | M0 `Book`/`Chapter`/`Page` model |
| Is the frame border vector, mask, or both — and how does it survive a page resize? | Create sample `.clip` files (1 page, 1 frame; then resized) and inspect the container; cross-check the manual. | Layout → Draw mask contract |
| How does the frame-border tool *divide* a frame — a shared border, a gutter band, or offset paths? Can the gutter change after the split? | One page, one frame; divide twice; change the gutter; resize. Compare the stored geometry. | Carving model: cut-strip vs drawn line |
| Where does a balloon tail attach, and how does it reflow when the balloon moves or the text changes? | Sample files + manual + hands-on notes. | M4 tail model |
| How are tones/patterns defined and tiled, and how does mono vs. grey vs. colour change the document? | Material assets in `%APPDATA%\CELSYSUserData`; document setup docs. | Tone slot, mono documents |
| Which export paths exist (comic, print, web) and what do their dialogs actually set? | Strings/resources + manual + one export of each kind. | M5 preflight checklist |
| **Brush settings**: what does the sub-tool detail actually expose (hardness, density, anti-aliasing, blending, paper, "apply by")? | Read the installed 1.5 sub-tool palettes and the manual's brush pages; enumerate every control with its range and default for the inking tools. | Brush schema in [BRUSH-AND-INK.md](BRUSH-AND-INK.md) |
| **Stabilizer vs correction**: how many levels, what changes, and how do they compose? | Manual + hands-on; compare stroke outputs. | Stabilizer model |
| **Ink closure**: how does fill decide a region is closed, and what do the "close gap" values do? | Fill a page with known gaps at each setting; record which leaks. | Fill + closure tools |
| **Vector ink**: how is a vector stroke re-shaped and re-weighted after drawing? | Draw, then use the vector eraser / point edit; inspect what changes. | Vector ink pass |

**Deliverable:** `docs/research/clip-studio-page-model.md` — page model, frame model, balloon
model, tone model, export presets.

**Local build, 2026-11-12:** the installed app is **CSP 5.0.4**. Its Windows package ships the
tablet (Simple Mode) interface: a "Switch to tablet interface" preference, three Android workspaces
as SQLite (`Illustration`, `Comic`, `By category`) with palette placements and shortcut maps, and
the full Simple Mode string set. Written up in
[research/csp-simple-mode.md](research/csp-simple-mode.md); useful for the Focus layout and for
layout presets.

### 2. Krita — `C:\Program Files\Krita (x64)` (GPL source available)

Cheap, honest evidence for the parts we would otherwise guess.

- Comic manager and page templates: what a template actually contains.
- Halftone filter: the algorithm, not the UI (read source).
- Layer groups and how "comic" documents differ from plain raster.
- `.kra` container: it is a ZIP + XML, so this doubles as our first real import target.

**Deliverable:** `docs/research/krita-comic.md` — template schema, halftone algorithm, `.kra`
mapping.

### 3. Procreate 5.4.9 — evidence in `2Dope\beta\.rea-work\procreate-5.4.9`

Already studied for canvas and brush feel. Reopen for the parts inkflo needs to match, and only
those:

| Question | Method | Unblocks |
|---|---|---|
| What is the full Brush Studio parameter set — groups, controls, ranges, defaults — for the six built-in inking brushes? | Static read of the extracted package + brush files; enumerate control names from strings and nib archives. | Brush schema |
| Are pressure curves per-parameter or one shared curve, and how is the curve edited? | Package + public documentation. | Dynamics |
| Which stabilization family is it (pulled string, exponential smoothing, other), and what is the response curve? | Observe stroke output at settings 0/25/50/75/100. | Stabilizer |
| QuickShape: what are the snap thresholds for line, arc and ellipse, and what cancels it? | Hands-on with the package installed; record angles and tolerances. | QuickShape |
| How do selection and transform interact with layers and clipping masks? | Hands-on; note the minimum viable subset for comic panels. | Selection |
| What is the interface made of — screens, bars, clusters, popovers, and their proportions? | Static read of the 18 storyboards and 113 nibs (88 decoded) plus `en.lproj/Localizable.strings`; frames decoded from `UIBounds`. Done 2026-11-12. | Focus/Studio chrome, layer and brush panels |

**Deliverable:** `docs/research/procreate-brush-studio.md` — a parameter table, not prose.
**Also written:** [research/procreate-interface.md](research/procreate-interface.md) — the interface
pass (chrome anatomy, panel structure, interface preferences, and what inkflo should and should not
take).

**Deep dive, 2026-11-12** — `Procreate-v5-4-4.ipa` and `Procreate-Dreams-v1-0-15.ipa` from
`D:\Downloads\Programs`, same method, full surface: [drawing features](research/procreate-drawing-features.md),
[UI style](research/procreate-ui-style.md), [Dreams motion](research/dreams-1.0.15-motion.md), and
the [integration matrix](research/procreate-integration-matrix.md) that orders the work.

### 4. Clip Studio inking tools — `C:\Program Files\CELSYS\CLIP STUDIO 1.5`

Specifically the inking workflow, not the whole app: sub-tool detail palettes, stabilizer levels,
reference-layer fill with gap closing, vector eraser, and the frame-border/closure interaction.
Contract and questions: [BRUSH-AND-INK.md](BRUSH-AND-INK.md) §8.

**Deliverable:** `docs/research/csp-inking.md`.

---

## Tier 2 — layout and print

### 4. DesignCraft — reference clone at `E:\2026\Dev\Apps\2Dope\reference\designcraft`, installed CLI

Page layout is inkflo's differentiator and the part most likely to be built badly. DesignCraft
is a working InDesign-family model in readable Rust.

- Master pages and how a page inherits from them.
- Text flow across frames (for captions that run between panels).
- Bleed/trim/safe representation, crop marks, imposition.
- The PDF export path (what is actually written, in what order).

**Deliverable:** `docs/research/page-and-print-model.md`.

### 5. PdfCraft — installed

- Minimal PDF writer requirements: font embedding, image compression, page boxes, marks.
- Whether client-side PDF/X-4 is realistic or whether we ship a conversion recipe.

**Deliverable:** decision note: "RGB PDF + preflight" vs. "PDF/X via external converter".

### 6. Print standards (documented, not a program)

PDF/X-1a and X-4, total ink coverage, rich black, overprint, 300–600 dpi line art, US comic
trim 6.625×10.187 in with 0.125 in bleed and 0.25 in safe, manga B6/A5, POD vendor specs.
This is reference reading, not REA — but it is what makes the preflight truthful.

---

## Tier 3 — motion comic

### 7. Moho 14 — installed

Camera and panel transitions: what a "panel-to-panel" move actually is, and what easing reads as
a comic rather than a cartoon. Study the camera layer and the smart-bone/panel workflow.

### 8. FilmCraft — reference clone

Timeline, render and mux plumbing we can lift conceptually for M7. Not the editing model — we
want a cue list, not a keyframe timeline.

### 9. Motion-book references (public docs and videos)

Madefire's motion book vocabulary, Marvel Infinite-style panel transitions, Webtoon's
scroll-based reveals. Extract a **cue vocabulary**, not an implementation: enter, hold, pan,
parallax, typewriter, shake, SFX pop.

**Deliverable:** `docs/research/motion-cue-vocabulary.md` — the JSON cue schema we ship.

---

## Tier 4 — publishing

### 10. Two or three live GitHub-Pages webcomics

Captured statically with the browser tools (`list_browser_targets` → `inspect_web_page`, no
interaction). Only structure: navigation, reading modes, chapter model, OG tags, 404 handling,
how they handle a new page.

Pick archetypes: one page-flip, one vertical-scroll, one archive-heavy. Record DOM shape and
CSS tokens, never their artwork.

**Deliverable:** `docs/research/webcomic-readers.md` — three archetypes and what we steal
structurally.

### 11. Toocheke / Comic Easel / Webcomic plugin — feature documentation

The taxonomy that webcomic readers expect: chapter vs. page, characters, locations, "first /
latest / random", RSS, comments. We are not building WordPress; we are matching expectations.

### 12. Patreon and Ko-fi public creator pages

Capture the structure of a support page: tier cards, goals, membership CTA, "about" block.
Derive `support.json`. Public pages only; no auth, no scraping of gated content.

---

## Tier 5 — formats (highest leverage)

Interop is adoption. A student who can bring in a `.psd` from a colorist, or hand a `.cbz` to a
reader, will forgive a lot of missing features.

| Format | Why | Method | Output |
|---|---|---|---|
| `.kra` | Krita; ZIP + XML; easiest real import | Build samples, read XML, map layers/groups | Import: raster layers → ink/flat slots |
| `.psd` | colorist handoff; industry norm | Read the spec + sample files; layered flatten/import | Import and export of flat layers |
| `.cbz` + `ComicInfo.xml` | the reader standard; our archive export | Spec + samples | Export, and import for page order |
| `.clip` | Clip Studio; the format students arrive with | Sample files, container inspection; import only if tractable | Stretch goal: page import |
| `.procreate` | Procreate; tablet audience | Existing package evidence + samples | Stretch goal: layer import |
| PDF/X | print handoff | See Tier 2 | Export path |
| `.inkflo` | ours | Design | ZIP + `book.json` + content-addressed pages |

---

## Explicitly out of scope

- Decompiling Clip Studio or Procreate to copy implementation.
- Shipping their brushes, tones, templates or fonts.
- Bypassing Patreon gating or any paywall.
- Building a general-purpose animation timeline. If a study suggests keyframes, the answer is
  "cue list over panels" (see PLAN §8).

---

## Order of work

| # | Pass | Reason it is here |
|---|---|---|
| 0 | Procreate brush studio + CSP inking | The Draw desk *is* the product; the contract is [BRUSH-AND-INK.md](BRUSH-AND-INK.md) |
| 1 | 2Dope architecture reuse inventory | Everything else assumes the spine |
| 2 | Clip Studio page/frame/balloon model | Shapes M0–M2 and M4 |
| 3 | DesignCraft page + print model | Shapes M1 and M5 |
| 4 | Krita templates + `.kra` | Cheapest real import, shapes M2 |
| 5 | Webcomic reader archetypes | Shapes M6 before we design the site |
| 6 | Patreon/Ko-fi support structure | Shapes `support.json` |
| 7 | PdfCraft / PDF-X decision | Unblocks M5 scope |
| 8 | Motion cue vocabulary + Moho | Only when M7 is next |
| 9 | `.psd` / `.clip` interop | Only after the core loop ships |
