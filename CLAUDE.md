# inkflo — repo notes for Claude Code

This repo holds the inkflo app (Vite + TypeScript, `src/`) and its design prototypes (`design/`).
Read this before writing code. Current state: **`docs/BUILD-STATUS.md`**.

## What is here

```
design/
  inkflo-app.html        the shell prototype: home, book, five desks, export modal
  panel-carving.html     the deep Layout prototype: cuts, swap, detach, resize, even
  desk-preview.html      the original five-desk visual study
  preview-*.png          rendered states, used as visual acceptance references
PLAN.md                  product plan: desks, carving model, publish kit, build order
src/                     the app (see docs/BUILD-STATUS.md for the module map)
docs/
  BUILD-STATUS.md        ← what is built, verified and missing. Read this first.
  BUILD-HANDOFF.md       ← the build spec. Read this second.
  2DOPE-REUSE-INVENTORY.md  what came from 2Dope's engine and how
  BRUSH-AND-INK.md       brush engine + inking requirements (Procreate / CSP parity)
  REA-QUEUE.md           what to reverse-engineer and why
  research/procreate-interface.md  the reference's chrome, panels and interface settings
  research/procreate-drawing-features.md  every drawing tool, brush and adjustment, with decisions
  research/procreate-ui-style.md   the control kit, metrics and surfaces, as a build spec
  research/procreate-integration-matrix.md  feature → inkflo gap → decision → order of work
  research/dreams-1.0.15-motion.md  what the Dreams package says about timeline and cues
  research/csp-simple-mode.md      the tablet/Simple Mode UI that CSP ships on Windows
```

The prototypes are **reference implementations**: geometry, interaction and visual language are
decided there. Port the behaviour, not the file structure. They are single-file HTML with no
build step; the app will be a real project.

## Rules

1. **The page document is the truth.** Panels, gutters and the print sheet are *derived* from
   stored cuts. Never persist derived geometry.
2. **One undo stack per book**, commands not snapshots. Every mutation goes through it.
3. **No backend.** IndexedDB for the library, `.inkflo` zip for files, static hosting only.
4. **Clean-room.** No assets, fonts, brushes or code from Clip Studio, Procreate or Adobe.
   Behaviour may be studied (see `docs/REA-QUEUE.md`); bytes may not be shipped.
5. **One renderer.** Screen, export, motion and thumbnails all come from the same render path.
6. **Don't add a framework** unless the spec says so. Canvas 2D + DOM, like 2Dope.

## Stack

Vite · TypeScript (strict) · Canvas 2D for art · SVG for page geometry · IndexedDB (idb-keyval
or raw) · Vitest · Playwright. No React/Vue/Svelte. No CSS framework; design tokens in
`src/styles/tokens.css` mirroring the prototype palette.

## Start here

1. `docs/BUILD-HANDOFF.md` — milestones, data model, acceptance criteria.
2. `docs/BRUSH-AND-INK.md` — the brush/inking contract for the Draw desk.
3. `design/inkflo-app.html` — the shell to port.
4. `design/panel-carving.html` — the Layout behaviour to port.
