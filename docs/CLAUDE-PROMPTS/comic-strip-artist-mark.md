# Inkflo prompt for Claude — Comic strips and Artist marks

Work in `E:\2026\Dev\Apps\inkflo\beta`. Check Git status and read `CLAUDE.md` and the latest `docs/BUILD-STATUS.md`. Preserve existing edits. This prompt defines the next prototype.

## Goal

Make it easy to start a comic strip, draw or place artwork, add a reusable creator mark, and export the same strip for a phone and for print. Inkflo should be quick to learn, with familiar comic publishing choices and room to compose freely.

## 1. Start a comic strip

- Add **Comic strip** alongside **New book**, **New vertical comic**, and **Open starter comic** in the library. Offer **3 panels**, **4 panels**, and **Stacked strip**. Default to three horizontal panels and open Draw with the cuts already in place. Keep Script and Layout reachable from the normal desks. The page and its cuts should remain editable through the usual tools.
- Use the existing `daily-strip` print kind as the horizontal starting point. Choose a suitable trim for the stacked preset and keep physical dimensions visible in Print. Present formats as presets. Custom dimensions and publisher-specific settings belong in the existing print controls.
- Keep the project screen centered on **Continue** and the page grid. Put Artist mark setup under **Project details** or the existing **Assets** entry. Use the normal export surface for publishing. A new Book Design desk is outside this prototype.

## 2. Place a reusable Artist mark

- Let the creator designate an existing book image asset as the **Artist mark**, or import a transparent PNG or WebP and use it immediately. It can be a signature, monogram, or drawn symbol. Reuse the existing asset store and image placement.
- Provide an easy **Place Artist mark** action and a way to select, move, resize, or hide an instance on a page. Use page-level placement suited to a signature in a corner or margin. Keep placement editable and undoable. A hidden mark should also be absent in export.
- Store the mark once and reference it. Save and reopen must preserve transparency and placement. Use the existing asset copy mechanism to bring the mark into another book. A built-in signature drawing pad and automatic repeating marks can follow once placement works well.

## 3. Make import and export sizes easy to understand

- On import or placement, show source pixel dimensions. When physical placement size is known, show effective print resolution using the placed dimensions and flag art below the project's intended resolution. Apply a working-copy size reduction only as an explicit choice if the current asset pipeline can preserve the full-resolution source. A source that cannot be used safely within browser limits should produce an actionable message.
- Add a simple single-strip **Web image** export using the existing renderer. Offer a sensible pixel-width default and a custom width. Use PNG first. If the download is already encoded for a preview, show its actual byte size. Use the existing print proof and layered PSD paths for **Print** and **Export for drawing**. Preserve the editable file and source asset across all exports.
- Show expected pixel dimensions before export, and physical trim for print. The web image is sized in pixels. The print proof follows the book trim and print settings. Reuse the existing browser limits and presizing logic where applicable.

## End-to-end acceptance

1. Create a three-panel strip from the library with minimal clicks. Draw or import a small amount of artwork in two panels, adjust a boundary in Layout, and confirm the panels remain independently editable. Try the other two layouts and undo a layout change.
2. Import a small transparent artist symbol, place it near a strip corner, reposition and resize it, then undo and redo. Hide it and confirm it disappears in the preview and export. Reopen an exported `.inkflo` file and confirm the asset and placement survive. Copy the asset to another project through Assets.
3. Export the visible mark with the same strip as a phone-width PNG and a print PDF. Verify the PNG width, print trim dimensions, correct panel order, mark placement and transparency against the background. Open the layered PSD route and confirm it still works after these changes.
4. Test a deliberately undersized image at print size and an oversized reference. Verify the UI reports the relevant dimensions and any explicit reduction leaves the source recoverable.
5. Run `npm test` and `npm run build`. Do the strip workflow in a browser at desktop and tablet widths. Report physical-device or third-party app tests only when actually run. State commit and deployment status.

## Code starting points

- `src/ui/home.ts` and `src/ui/bookview.ts` — library and project entry points.
- `src/geom/printkinds.ts` and `src/geom/carve.ts` — print presets and derived panel geometry. Inspect the existing cut helpers and verify horizontal strip geometry.
- `src/ui/bookassets.ts`, `src/io/bookassets.ts`, and `src/ui/imageplacement.ts` — reuse asset storage and the editor.
- `src/ui/exportdialog.ts`, `src/io/printexport.ts`, and `src/render/page.ts` — output controls, print, and shared rendering.

Keep one undo stack and one renderer. Use the existing touch-friendly controls. Keep the prototype focused on getting a strip out the door. Live book masters, QR placement, metadata automation, and expanded web publishing remain follow-on work.
