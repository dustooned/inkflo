# Affinity and DesignCraft study for Inkflo

## Evidence

- Affinity's published help describes master-page inheritance, page overrides, linked text frames, layer blend modes, and tonal blend ranges. The Windows install search did not locate the editor. Runtime behavior and PSD interchange remain open. [Master pages](https://www.affinity.studio/features/smart-master-pages) · [Text flow](https://www.affinity.studio/typography-software) · [Layers](https://www.affinity.studio/help/panels-layers-panel/) · [Blend ranges](https://s3-eu-west-1.amazonaws.com/affinity-docs/help/designer/en-US.lproj/pages/Layers/layerBlendRanges.html)
- DesignCraft 0.20.1 is installed. REA's static PE resource inventory identified the executable at SHA-256 `97ae9294519f2125aa97ef827960dc789b4ceba60cc5138a0c1a60e2a110a004`. Evidence `ev_46c90565954009e39e8c6763d42ece3c9add4cbdad3923b561c8bb60eb43d5bd` is checkpointed in the local `.rea-work/affinity-designcraft-evidence.json`.
- The separate DesignCraft source checkout is `66c7ce7` and declares workspace version 0.4.0. In that revision, `crates/doc/src/page.rs:93` stores an applied parent spread and overridden item IDs. `crates/doc/src/story.rs:88` separates story text from its ordered frames. `crates/doc/src/edit.rs:198` links frames. `crates/compose/src/lib.rs:430` composes stories and reports overset. `crates/render/src/lib.rs:924` maps item blend modes to renderer operations. [Source checkout](https://github.com/storytold/designcraft/tree/66c7ce7)

## Installed DesignCraft probes

1. Created a parent spread and applied it to two pages. The CLI reported two applications. The per-item override probe returned no IDs. It needs a fixture with an inherited item on the selected side.
2. Created two threaded frames. Both retained story 70, with no overset and no extra pages. The CLI accepted a Multiply/50% edit and reported one changed object. Pixel-level blending and group isolation still need a comparison fixture.
3. Exported the four-page sample with 9 pt bleed and crop marks. Poppler reported 612 × 792 pt trim, 630 × 810 pt bleed, and 678 × 858 pt media on page 1. This was a standard PDF export.

## Inkflo proposals

| Order | Feature | Scope and check |
|---|---|---|
| 1 | Book layout masters | Link pages to named masters for guides, margins, folios, and recurring header frames. Keep panel cuts, lettering, and artwork owned by the page. Test updating a common folio and overriding the cover. |
| 2 | Layer blend and clip controls | Start with Normal, Multiply, and Screen, clipping to a chosen layer, and explicit group isolation. Keep those controls distinct from panel masks and over-frame placement. Compare one collage across canvas, PSD, and print. |
| 3 | Linked type frames | Reflow one editable story across ordered frames and flag overflow in the final frame. Test a change on the first page that reflows the second page, then undo the edit. |
| 4 | Tonal blend ranges | Test once the core compositing rules are predictable. A comic use case is suppressing the paper whites of scanned ink. |

For DMA 6, use a short research zine with a recurring folio, two linked text frames, and a clipped collage. Update the folio, override the cover, revise the text, and proof the same composition for print.

## Affinity runtime follow-up

With an exact editor version available, apply a master to two pages, edit a shared element, override one page, and resize an upstream text frame. Use an overlapping image and ink stack to compare Multiply, clipping, group Passthrough versus Normal, and blend ranges. Check the same pixels before and after PSD or PDF export.
