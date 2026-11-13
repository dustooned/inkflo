# Inkflo handoff for Claude

Continue in `E:\2026\Dev\Apps\inkflo\beta`. Start with `git status --short --branch` and `git log -5 --oneline`, then read [CLAUDE.md](../CLAUDE.md) and the newest sections of [BUILD-STATUS.md](BUILD-STATUS.md).

## Where things stand (November 13, 2026)

`main` is pushed and GitHub Pages serves it. [Live app](https://dustooned.github.io/inkflo/)

Shipped in this round, newest last:

- **Export for drawing** in Layout and Caption: a layered PSD (or a ZIP for a range) with a summary before download.
- **Bucket fills stop at panel seams.** Carved panels share their cut edge, so the walls now include the seam.
- **Draw tools on moved panels.** Select lines, Transform, Smudge and Clone map the pointer into the panel's source space (`ui/placement.ts`). Brushes and fills already did.
- **Interface cleanup.** One-row header and tool options that scroll sideways when full. Steady tool rail, thin scrollbars, an Export ▾ menu, and a regrouped book view.
- **Icons and tooltips.** An original line-icon set (`ui/icons.ts`), looked up by control label, and styled hover/focus tooltips (`ui/affordances.ts`).
- **Canvas menu.** Right-click, or a touch long press, opens each desk's practical actions plus undo, view and export. Menus support arrow keys.
- **Draw sidebar** docks the Layers panel. **Focus/Simple** brush column fits its fields. Customize tools has its own icon.
- **Knife** cuts from lines drawn inside the page; **Auto Shape** snaps held cuts to line, arc, zig-zag or smooth curve.
- **iPad performance**: fast resampling during gestures, overlay-only hover frames, no blur/masks on touch.
- **Scroll page-break art**, **collage cut-outs** (cut, torn edge, paper edge, duplicate), **copy and paste** across layers, books and apps.
- **Previews**: balloon kind and look pickers, style sheet strip, page-image and PSD thumbnails. Balloon **Fine-tune** fold with spike, bump and tail controls.
- **Manual** at `public/manual/index.html`, linked from home, each desk header and the canvas menu.

Checks: 358 tests, typecheck and production build. Browser checks are written up per section in BUILD-STATUS.

## Findings worth knowing

- **Rebuild from strokes** is deterministic. On the starter, it draws the same shapes but anti-aliased. The saved starter bitmaps have hard, stair-stepped edges. Re-exporting `public/examples/the-last-train.inkflo` after a rebuild would ship smoother lines (not done).
- The "thin unfilled strip" between borderless panels does not exist. Each fill already grows one pixel across the seam.
- The built-in browser pane captures only its top-left quarter while hidden. Use Claude in Chrome for screenshots, or DOM measurements.

## Still open

You need to test these:
- Open the Drawing template PSD in Procreate, Clip Studio, Affinity and Photoshop. Check whether the group masks clip.
- On an iPad with an Apple Pencil, test long press, fills and moved-panel tools.

Claude can do these next:
1. **Procreate brush import (`.brush` / `.brushset`).** A zip with `Brush.archive` (an NSKeyedArchiver binary plist), `Shape.png` and `Grain.png`. Read the shape and grain exactly, and map the settings that `BrushSettings` can express. Research: [procreate-drawing-features.md](research/procreate-drawing-features.md) §4.
2. **Deeper Clip Studio `.sut` import.** `io/sut.ts` reads about 15 `Variant` columns and the tip PNG. Next steps: pressure-curve blobs, spray, texture, and colour jitter. Each blob layout needs reverse-engineering from the user's own files (clean-room rules apply).
3. Re-export the starter after a rebuild (see above).
4. Sort the remaining controls into the four surfaces from [procreate-ui-style.md](research/procreate-ui-style.md) §5: tool bar, card, popover, panel.

Follow the clean-room rules, keep one renderer and one undo stack, keep the user's Gmail attribution on commits, and publish through the existing Pages workflow when asked.
