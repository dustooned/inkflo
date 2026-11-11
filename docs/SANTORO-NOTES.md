# Notes from the Santoro handbook and a layout template set (2026-11-10)

Sources the user shared:
- *The Santoro School's Handbook for Making Better Comics* (Frank Santoro and Kurt Ankeny), a
  16-page scanned PDF.
- A zip of layout templates: PSD, Procreate and PNG grids plus a golden-ratio sheet. These are by
  Georg von Westphalen, not Santoro, and carry a **single-user licence** ("not allowed to share
  or sell").

**Clean-room rule:** nothing from either source ships in inkflo. No images, grids or text. We take
the *ideas*, which are general design practice, and build our own versions. The construction
geometry below is standard geometry (diagonals, circles, rabatment), drawn by our own code.

## What the handbook teaches, and what inkflo can do with it

| Idea (in our words) | What inkflo could add | Where |
|---|---|---|
| **Compose spreads, not pages.** A printed spread is seen at once, so the eye jumps to the biggest panel, and the right-hand page is glanced at first. | **Spread view** in Layout and the Book grid: pages side by side as printed (reader spreads already exist in Export). | Layout, Book |
| **Reveals happen on the page turn.** Cause and effect on the same spread spoil the surprise. | **Reveal check:** mark a beat as a *reveal* in the Script. Warn when it lands on a left-hand page or on the same spread as its setup. "Move to the next right page" is a fix. For webtoons, a reveal should come one screen-height after its setup. | Script, Layout, preflight |
| **The fixed grid as a meter.** The same grid on every page sets a rhythm; the "downbeat" panel carries the punchline or the turn. | **Fixed-grid mode** (one grid for the whole book; a page can break it on purpose). **Downbeat:** mark a panel, show beat numbers 1-2-3-**4**, and suggest the bottom-right slot for page-turn hooks. | Layout |
| **Geometry of a page.** Diagonals find the centre; a circle as wide as the page; arcs swung from the corners with the short side as radius ("rabatment") give an upper and a lower square, each with its own diagonals and circle. These lines are "tuning forks" for placing figures, balloons and the action. | **Composition guides** (Display menu, also over a spread): Centre and diagonals, Rabatment squares, Full construction, Thirds, Golden section. Off by default, faint, and never printed. The rulers can **snap to guide lines**. | Layout, Draw, Caption |
| **The centre matters.** A 2 × 3 grid puts a dead gutter crossing at the page centre; good artists shift a row to avoid it. | **Layout hint:** "A gutter crossing sits at the page centre." Offer to stagger the middle row (shift that cut). | Layout preflight |
| **The notecard method.** Draw each panel small on a card, then rearrange the cards on a page-sized sheet to edit pacing. | **Card board** in the Script desk: each beat is a small sketch card, dragged into page slots. This is the Script ↔ Layout link made visual. Warn when a card's shape is far from its panel's. | Script |
| **Colour as emphasis, in tiers:** symbolic connections, clarity in a busy scene, or mood per panel. | **Colour emphasis:** a "mute everything but…" layer option, and a page-level mood tint in Print Look. | Draw, Print Look |
| **Grisaille and two colours.** Paint values in grey, then print with two inks. A tint chart of two inks' screen percentages gives a wide range of tones. | **Two-colour print mode** in Print Look: map grey value layers to two spot inks, with a live tint chart and a two-plate separation export. This links halftone (§9) to separations (§15). | Print Look, Export |
| **Outside black and white.** Any medium can print today. | Already planned: Print Look paper and textures; imported images (§14) for scanned paint. | — |

## From the template set (ideas only)

- **Modular grids:** a page split into columns of uneven widths and rows of uneven heights,
  including thin strip rows, with a constant gutter. Panels are built by merging cells.
  → Add **modular grid guides** to Layout (columns, rows, gutter, uneven sizes) that the knife
  snaps to. Merging cells then becomes "cut along these lines".
- **One canvas, two orientations:** a portrait page grid and a landscape strip grid.
  → Covered by print kinds (strip and Sunday kinds exist now). A strip grid preset is worth
  adding.
- **A golden-ratio sheet:** two overlapping squares with their circles and diagonals across a
  landscape spread. → The same composition guides as above, applied to a **spread**.
- **The tip** "keep each panel in its own folder, with balloons in a sub-folder" is how inkflo
  already works (panel groups, and lettering is separate).

## Suggested order

1. Composition guides overlay (small, high value, shared by Layout, Draw and Caption).
2. Spread view and the reveal check (uses reader-spread maths that already exists).
3. Downbeat and fixed-grid mode.
4. Modular grid guides with knife snapping.
5. Card board in Script.
6. Two-colour print mode, together with Print Look.
