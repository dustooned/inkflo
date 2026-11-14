# inkflo UI audit, 2026-11-14

Every screen was walked at desktop (1280 × 800), iPad landscape (1180 × 820) and iPad portrait
(820 × 1180), in dark and light themes. The same page (Night Shift, page 1) was used throughout.
Measurements come from the live DOM. Findings are ranked by how much they get in an artist's way.

**How to read the ranks:** P0 blocks or loses work on Monday. P1 slows an artist down every
session. P2 is polish.

---

## P0: must fix before Monday (fixed 2026-11-14, see BUILD-STATUS)

| # | Where | Problem | Evidence | Fix |
|---|---|---|---|---|
| 1 | Top bar, iPad portrait | **Export is pushed off-screen.** The top bar doesn't wrap or collapse. | 820 px wide: the Export button sits past the right edge. | Collapse the view buttons into one "View" menu below ~1000 px; Export always stays visible. |
| 2 | Context bars, iPad | **Controls are hidden off the right edge** with no visible cue. | Overflow at 820 px: Layout 664 px, Caption 495 px, Draw 422 px. At 1180 px: Layout 304 px, Caption 135 px. | Two tiers: the tool's own options stay in the bar; page-wide settings (gutter/border/curve, Page templates, Style sheet, Page checks) move to the sidebar. Add an overflow "More" menu. |
| 3 | Draw tool rail, desktop/landscape | **The bottom tools are cut off.** The rail scrolls, but nothing shows that it can. | Rail is 144 px too tall at 800 px high, 124 px at 820 px. Position image and Artist mark are hidden. | Compact rail below ~900 px: icon only (labels in tooltips), tighter padding, plus a fade or chevron when it scrolls. |
| 4 | Saving | **A hard reload within 400 ms of an edit can lose that edit.** This is a known issue. | `docs/BUILD-STATUS.md` known issues | Flush on `beforeunload` too; save immediately after a stroke ends (pen-up), not only on the 400 ms timer. |

## P1: slows artists down (fixed 2026-11-14, see BUILD-STATUS)

| # | Where | Problem | Evidence | Fix |
|---|---|---|---|---|
| 5 | Everywhere | **No single control kit.** Buttons come in 10 heights, text in 8 sizes, corners in 6 radii. | Button heights 18–61 px (32, 33, 28, 44, 23…); fonts 11, 11.5, 12, 12.5, 13, 14, 16, 17 px; radii 0, 5, 6, 7, 8, 9 px. | Three sizes (compact 32 / regular 40 / touch 44), one type scale (11 / 12 / 13 / 15 / 18), radii 6 / 10. Apply them through `tokens.css` and the `.btn` / `.seg` / `.field` classes. |
| 6 | Everywhere | **Small touch targets.** Controls under 32 px per desk: Draw 21, Script 18, Layout 16, Print 8, Caption 7. | Layer row icons ~16 px, the card ↑ ↓ × buttons, page pager arrows, checkboxes. | Hit areas of at least 44 px on touch (`pointer: coarse`) without changing the look: padding plus invisible hit slop. |
| 7 | Sidebar switch | **Each desk's switch looks different.** Draw's Layers / Bins is a tall icon button; Layout's and Caption's are small segmented controls. | Screenshots: Draw vs Layout and Caption. | One `side-switch` component for every desk, the same height and style. |
| 8 | Caption | **Balloon kind is buried.** Speech, thought, shout and the rest are only in the Letter tool's flyout. | Context bar shows Review / Script dialogue / Place from script / Page checks, but no kinds. | A kind strip in the context bar (six swatch buttons) when Letter is active. |
| 9 | Export → Export files | **Too long.** Eight options take about three screens of scrolling. | Scroll height 1816 px in a 560 px area. | Group into Share (Web image, CBZ, Spreads), Production (Page images, Layers, Two-ink), and Apps & games (2Dope, Game package), plus the book file. Show one group at a time. |
| 10 | Layout | **One action, three places.** Grid presets appear as Presets chips, the Page templates dialog, and Layout bins. | Inspector, context bar and Bins all offer grids. | Keep Bins (tap = whole page, drag = split panel). Presets chips become a "Grids" bin shortcut, and Page templates opens Bins. |
| 11 | Book screen | **Delete sits beside Rename,** in red, at the same size. | Header: Rename, Delete side by side. | Move Rename and Delete into a "⋯" book menu. Delete asks for confirmation with the page count. |
| 12 | Script | **The right inspector is mostly empty** while the editor and legend are cramped. | Inspector shows only the beat and panel counts. | Fold the counts into the context bar ("4 beats · 6 panels ⚠") and give the width to the editor. The legend becomes a collapsible drawer. |
| 13 | Top bar | **Six icon-only buttons in a row** (layout toggles, theme, spread, focus, checks). | Header icons with no visible labels. | Group into "View ▾" (panels, spread, focus, theme) and keep Checks visible with a count badge. |

## P2: polish (fixed 2026-11-14, see BUILD-STATUS)

| # | Where | Problem | Fix |
|---|---|---|---|
| 14 | Tool rail labels | 8.5 px uppercase labels; context-bar desk name at 9.5 px. | 10–11 px minimum. |
| 15 | Print | The Print kind dropdown is an unstyled browser control; the other selects are styled. | Use the `.field select` style. |
| 16 | Light theme | The cream page sits on a beige board, so the page edge is faint. | Darker board in light theme, or a stronger page shadow. |
| 17 | Layout | Panel numbers are small (mono, about 11 px at fit zoom). | Scale with zoom; minimum 13 px; a pill background. |
| 18 | Draw | "Saving…" appears just from opening the desk (group sync marks the page dirty). | Only mark dirty when the sync actually changed the page. |
| 19 | Home | Create tiles and books share one grid, and there's no search. Test books ("E2E …") clutter this device's library. | A "New" row separate from "Your books"; search once there are 12+ books. (Delete the E2E books locally.) |
| 20 | Script cards | Only about two cards fit on screen; "Reveal settings" uses the browser's default triangle. | Compact card mode; a styled disclosure. |
| 21 | Book screen | Page thumbnails and numbers are small; page actions only appear on hover (none on touch). | Bigger thumbnails, a visible "⋯" on each page. |

## What's already good

- The stage rail (Script → Print) with per-stage state reads clearly.
- The light theme is complete and consistent.
- iPad portrait Draw folds the sidebar away and gives the page the space.
- The floating Size / Opacity sliders work well on a tablet.
- Print's "1 thing to fix" preflight is clear and actionable.
- Export → Print it: four clear cards with a plain-language note.

## Not covered by this audit

- **Real iPad and Apple Pencil:** pressure feel, palm rejection, gesture conflicts, Safari quirks.
- **Performance** with large books (memory, long undo history) on a tablet.
- **Screen reader** pass (labels exist on most icon buttons; not walked with VoiceOver).

## Suggested order (Saturday → Monday)

1. **P0 1–4:** top bar and context bar overflow, compact rail, save on pen-up.
2. **P1 5–7:** control kit tokens, touch hit areas, one sidebar switch. These touch every desk,
   so do them early and once.
3. **P1 8–13:** desk-by-desk fixes (Caption kinds, Export groups, Layout duplicates, Book menu,
   Script width, View menu).
4. **P2** as time allows, then freeze Sunday night: full artist walkthrough, then deploy.
