# Procreate's interface, from the shipped package

2026-11-12 · REA static read of the local Procreate 5.4.9 `.ipa`. Reference only; nothing from the
package (icons, fonts, artwork, layout files) is copied into inkflo. This pass answers one question
that [EXPLORE-DESK-UI.md](../EXPLORE-DESK-UI.md) leaves open: **how close can we actually get to
Procreate's chrome, and what exactly does its chrome consist of?**

> **Version note.** The deep dive supplied later reads `Procreate-v5-4-4.ipa` and
> `Procreate-Dreams-v1-0-15.ipa` from `D:\Downloads\Programs`. 5.4.4 ships the same 113 nibs as
> 5.4.9 plus `PreviewView` and `PocketPreviewView`, so every frame below still holds. The feature
> surface is in [procreate-drawing-features.md](procreate-drawing-features.md), the visual system in
> [procreate-ui-style.md](procreate-ui-style.md), Dreams in
> [dreams-1.0.15-motion.md](dreams-1.0.15-motion.md), and the build order in
> [procreate-integration-matrix.md](procreate-integration-matrix.md).

Companions, from 2Dope's earlier passes on the same file, all under
`2Dope/beta/docs/research/`: `procreate-5.4.9/README.md` (identity, selection, transform, feather
popover), `procreate-5.4.9/DRAW-ANIMATE-CONTINUATION-2026-10-31.md` (brush surface, Draw, Animation
Assist), `layer-systems/README.md` (the layer cell) and `export-settings/README.md` (export
wording). This document covers only the **interface**: screens, bars, clusters, popovers and the
wording that names them.

Labelling follows [REA-QUEUE.md](../REA-QUEUE.md): `observed` is read from the shipped archives,
`inferred` follows from structure and names, `inkflo choice` is our decision.

## 1. What was read

| Item | Value |
|---|---|
| Source | `D:\Downloads\Misc\Compressed\Procreate_5.4.9_Pro.ipa`, 1,011,183,296 B |
| Bundle | `au.com.savageinteractive.procreate`, 5.4.9 (57074), iPad only, minimum iOS 16.3 |
| Archive | 2,537 members; **505 interface members**: 113 `.nib`, 18 `.storyboardc`, 317 `.strings`, 17 `Assets.car` |
| Interface Builder | **88 of the 113 nibs decoded** (two decodes: 64 + 24 documents) — 6,613 nodes, 3,626 edges, 1,005 outlets, 870 target-actions, 196 selectors |
| English strings | `en.lproj/Localizable.strings`, **1,922** key/value pairs, plus the brush, canvas-size and settings tables |
| Not decoded | 25 nibs (keyboards, intro/launch, Add-to-Procreate and widget scenes, some material cells), all 17 `Assets.car` icon catalogues |

Frames are real: the archives store `UIBounds`/`UICenter` as a tagged little-endian double blob, so
point sizes below are decoded from the nib, at the size its author laid it out at. They are design
geometry, not a device measurement.

Limits, up front: **no method bodies, no runtime behaviour, no pixel screenshots**; icon glyphs live
in `Assets.car`, which this Windows host cannot decode; a target-action selector in an archive does
not prove a live handler; dynamic rows (menu items, brush sections) are built in code and are absent
from the archives.

## 2. The interface surface map (`observed`)

The 18 storyboards are the app's screens. This is the whole shape of Procreate, in its own names:

| Storyboard / nib | Screen |
|---|---|
| `Gallery.storyboardc` | Library: thumbnails, stacks, selection, rename, About |
| `Document.storyboardc` / `DocumentPocket.storyboardc` | The canvas screen and its chrome |
| `DocumentNavigation.nib` | The canvas bars (see §3) |
| `Brush.storyboardc` + `BrushSettingsController.nib` | Brush Studio |
| `LayersResources.bundle/Layers.storyboardc` | Layers panel (a `UINavigationController`) |
| `ColorPanelResources.bundle/ColorPanel.storyboardc` | Colour panel: `disc`, `classic`, `harmony`, `value`, `palettes`, `HistoryPalette` |
| `ProLibrary.storyboardc` / `ProLibraryPocket` | Project browser used by the document actions |
| `ProMenuOldResources.bundle/ProPopoverMenu.storyboardc` | The Actions (wrench) menu |
| `ProContextMenuOldResources.bundle` | Long-press context menu over canvas content |
| `GestureControls.storyboardc` | Gesture settings |
| `Preview.storyboardc` | Full-screen artwork preview |
| `CanvasInformation` / `CanvasPresetEditor` | Canvas info and the new-canvas editor |
| `Introduction` / `LaunchScreen` | Onboarding |
| `PlugIns/Add-to-Procreate.appex`, `OpenRecentArtworkWidget.appex` | Share-extension and widget surfaces |

Everything inkflo shows is in that list — which is the useful part: there is no hidden fourth mode.
Procreate is **Gallery → one canvas screen → modal cards and popovers over it**.

## 3. The canvas chrome, decoded

### 3.1 The layer stack of the canvas screen (`observed`)

`DocumentPocket.storyboardc` names its own layers, and they are the clearest statement of the
architecture in the package:

`Document Base` · `Canvas Wrapper` · **`Show Interface`** · `Notification Bar Wrapper` ·
`Navigation Bar Wrapper` · `Navigation Container` · `Bottom Toolbar Container` ·
`Shifting Toolbar Wrapper` · `Shifting Toolbar Container` · `Painting Toolbar Wrapper`

So the canvas sits underneath, the chrome floats **over** it in named wrappers, and one
`Show Interface` control — a 50 × 50 button in the Pocket layout — brings the chrome back. That is
Procreate's full-screen mode, expressed as view hierarchy rather than a setting.

iPad frame: 1024 × 768. Pocket frame: 393 × 852.

### 3.2 `DocumentNavigation.nib` — two bars, five clusters (`observed`)

Authored at 742 × 139, i.e. a 95 pt bar with a 44 pt row beneath it. Outlets and accessibility
identifiers give the grouping:

| Cluster | Members | Geometry |
|---|---|---|
| Document actions, left of the bar | `galleryButton` (58 pt), a hidden 4 pt divider, a 32 pt icon button, `modifyButton` (200 pt), `modifyBar`, `modifyStack` | 58 pt and 200 pt buttons; `thinLine` is a 0.5 pt hairline under the bar |
| Edit actions, right of the bar | `actionsButton`, `filtersButton`, `selectionsButton`, `transformButton` (+ `Compact…` twins) | 44 wide × bar height each, **8 pt gaps** |
| Compact edit row | `compactActionButtons` ×4 | 44 × 44, **14 pt gaps**, hidden by default |
| Paint cluster | `paintButton`, `smudgeButton`, `eraseButton`, `layersButton`, `colorButton` + `colorView` | 5 × 44 wide × full bar height, 8 pt gaps |
| Status readouts | `previewModeLabel`, `fpsReadoutLabel`, `msReadoutLabel` and their containers | small labels, hidden unless enabled |

Accessibility identifiers in full: `Navigation Toolbar`, `Modify Bar`, `Primary Navigation Bar`,
`Gallery`, `Spacer`, `Actions`, `Filters`, `Selections`, `Transform`, `Paint`, `Smudge`, `Erase`,
`Layers`, `Color`, and the four `Compact …` variants.

Read as a design (`inferred`):

- **Two independent axes.** *What you do to the document* (actions, filters/adjust, selections,
  transform) sits apart from *what you paint with* (paint, smudge, erase), and layers/colour are
  the last two, next to the paint tools. inkflo's current Focus bar mixes navigation, paging, undo,
  display and layout into one strip; Procreate never does.
- **The bar grows a second row** (`modifyBar`, 95 pt total) when the active adjustment or tool has
  options; `thinLine` is the hairline under it. The tool buttons are full-bar-height, so the row is
  a single touch surface.
- **The chrome is translucent.** `Document.storyboardc` puts a `UIVisualEffectView` (1024 × 44)
  behind the top bar, and the nibs only reference system colours (`labelColor`,
  `systemBackgroundColor`, `clearColor`). Procreate's chrome is a blur over the canvas in system
  colours, not a painted panel — and system SF fonts only (`.SFUI-Regular` 17/18, `.SFUI-Bold` 20).
  A web build can be legitimately close here: `backdrop-filter` plus `system-ui` is the same recipe,
  with no borrowed assets.
- **A left-edge sidebar** of 51 × 519 pt (iPad) / 40 × 519 pt (Pocket) holds size and opacity. That
  matches the string `Size & Opacity sidebar` and the `Right-hand interface` preference: the
  sidebar, not the toolbar, is the thing that moves for handedness.

### 3.3 Floating bars (`observed`)

| Nib | Frame | What it is |
|---|---|---|
| `FloatingToolbarWrapperView` | 772 × 83 | a wrapper that floats a toolbar over the canvas (`outerVerticalStack`, `toolbarHeight`, identifiers `FloatingWrapper`, `FTVToolbarHeight`) |
| `ShiftingToolbarView` | height/width by constraint, `notchHeightOffset` | the bar that shifts when a tool needs room; identifiers `Liquify View for Toolbar Height`, `Liquify Buttons Outer view` |
| `NotificationBar` | message 375 × 18, tool view 32 | a **hint/toast bar** that can also host a small control (`messageLabel`, `messageView`, `toolView`, `toolOffset`) — undo hints, assist on/off, etc. |
| Bottom painting toolbar | 976 × 50 (iPad); 345 × 50 plus a 44 pt bar (Pocket) | the Pocket bottom bar and its painting counterpart |

The notification bar is the piece inkflo has no equivalent of, and it is cheap: one 18 pt line plus
an optional 32 pt control slot, above the canvas, non-blocking. Procreate uses it for exactly the
feedback we currently send to `toast()`.

## 4. Panels

### 4.1 Layers (`observed`, extending 2Dope's cell decode)

The panel is a `UINavigationController`; the row is a Swift cell with outlets `thumbnail`,
`thumbnailBackground`, `layerLabel`, `information`, `title` (a `LayersCellTitleModel`), `visibility`,
`lock`, `lockIcon`, `blendMenuTarget`/`mode`, `clipped`, `clippedOther`, `cutout`, `backgrounds` ×2,
`depth`, `activity`, `menu`, `actions` ×2, `reveal`, `slide`, `stack` (2 pt spacing), and a
long-press recogniser for reorder. Accessibility: `layers-cell-layer`, `.sliding`, `.background`,
`.clippedother`.

State is inline (thumbnail, name, secondary text, visibility, lock, alpha-lock background, clipping,
depth); destructive and selection actions live behind the horizontal slide; blend opens a menu.
Group cell and `Layers.Applicable.Blend` are separate nibs — blend is a picker, not a slider.

### 4.2 Brush Studio (`observed`)

`Brush.storyboardc` view: a **preview container** at the top (`previewContainer`,
`previewOuterContainer`), a **section column** (`sectionColumn`, `sectionContainer` with top/leading/
bottom/width constraints), a **`Settings` title label**, and a **tab collection** (`tabs`,
`tabContainer`, `tabOuterContainer`, `tabStack`) with data source/delegate wired. `BrushSettingsController.nib`
and `BrushNumericKeypad.nib` supply the editing card and the numeric entry. Sections themselves are
code-built, so their titles come from strings, not archives: Stroke, Stabilize, Taper, Shape, Grain,
Wet Mix, Colour Dynamics, Dynamics, Properties.

### 4.3 Colour (`observed`)

`ColorPanel.storyboardc` ships one scene per tab — `disc`, `classic`, `harmony`, `value`,
`palettes`, `HistoryPalette` — inside a `UINavigationController`, plus `Palette` and a
`ColorBalanceCardView.nib` for the separate colour-balance card.

### 4.4 Gallery (`observed`)

810 × 1080. A custom `GalleryLayout` collection view, a 64 pt nav bar, and two button sets:

- **default**: `Add` (`New Canvas`), `Import`, `Photo`, `Stack`, plus `WhatsNew`;
- **editing**: `Select`, `Share`, `Duplicate`, `Preview`, `Delete`, plus `Close`.

Rename is **in place**: `renameBlur` (`UIVisualEffectView`), `renameContent`, `renameText`
(`ProTextField`, 300 × 38), `renameThumbContainer` — a blurred inline editor over the item name, not
a dialog. Nav stack spacing is 24; buttons are 43–72 pt wide by 84 pt tall in the authored frame.

### 4.5 Menus and popovers (`observed`)

`ProPopoverMenu` and `ProContextMenuOld` are both `UICollectionView`-driven popovers with data
source/delegate in code and height/leading/trailing constraints — i.e. the Actions menu and the
long-press menu are **data-driven grids of items**, not fixed nib layouts. `ProNumericKeypad` (a
"Canvas Size" label, 11 keyed buttons in 4 pt stacks) is the shared numeric entry. `Preview` has
`back`/`forward`/`closePreviewPressed:` and tap/double-tap/pinch navigation recognisers.

## 5. The interface as a settings object (`observed`)

The string table names the preferences Procreate exposes, which is the shortest list of what its
interface *is*:

| Group | Strings |
|---|---|
| Appearance | `Light interface`, `Dark interface`, `Auto-hide Interface`, "The interface will return after the set delay" |
| Handedness / layout | `Right-hand interface`, `Size & Opacity sidebar` |
| Gestures | `Gesture controls`, per-gesture strings (`Two-finger and three-finger tap will not undo or redo`, `Holding a finger on the canvas will invoke QuickMenu`, `Double-tap on compatible Apple Pencil will invoke QuickMenu`, `Swiping down with three fingers…`, `Tapping with four fingers…`, `Squeeze…`, `Tapping ⎇ …`) |
| QuickMenu | `QuickMenu`, `Customize QuickMenu`, `Swap QuickMenu`, `Invoke QuickMenu` |
| QuickShape | `QuickShape Delay`, `Customize QuickShape`, `QuickShape on/off` |
| Undo | `Rapid undo delay`, `Disable Undo and Redo`, `Undo`, `Redo` |
| Input | `Connect Stylus`, `Brush cursor visibility`, `Brush outline style` |

Two of these matter beyond naming: **auto-hide** is a first-class behaviour with a delay, and
**handedness moves the sidebar, not the toolbar**. Both are cheap in the DOM and both change how the
app feels more than another slider would.

## 6. What inkflo should take, and what it should not

`inkflo choice` below; the API and data model are unaffected.

| Procreate element | inkflo today | Change |
|---|---|---|
| Two-axis chrome: document actions vs paint cluster | Focus has one corner bar (back, desk, pager, undo/redo, inspector, fit, spread, display, layout) | Split it: **document actions** top-right (actions, filters/adjust, select, transform), **paint cluster** right edge (brush, eraser, fill, layers, colour), **paging/undo** in a minimal top-left group. Keep Studio as the everything-visible mode. |
| Second bar for the active tool's options | Settings live in a popover / context bar | Let the top bar grow a **44 pt second row** with the active tool's options and a title button, hairline-separated, hiding the row when the tool has none. |
| 44 pt targets, 8 pt gaps, 0.5 pt hairline, full-bar-height tool cells | Mixed sizes | Adopt 44 × 44 minimum, 8 pt cluster gap, 14 pt between action groups, full-height tool cells. |
| Translucent system-colour chrome over the canvas | Token palette, solid panels | In Focus, `backdrop-filter: blur()` over the page with token colours that resolve like system colours (light/dark automatic). Page stays paper. |
| Left/right size–opacity sidebar (51 pt / 40 pt wide) | Prototype has an edge slider set | Make it the size–opacity sidebar, both sides, remembered per device; it is what "left-handed" moves. |
| Notification bar (18 pt line + 32 pt control slot) | `toast()` | Replace transient toasts with a persistent hint bar under the top bar: message + optional control (assist on/off, threshold, feather). |
| Auto-hide interface with a delay + `Show Interface` | Not present | Focus only: hide chrome after N s idle, restore on touch/pen down; a corner button toggles it. |
| Inline rename with blur | Dialog | Rename books/pages in place over a blurred thumbnail. |
| Actions/long-press menus as item grids | Popover lists | Keep the list, but drive both from one item model so Actions and context menus cannot drift apart. |

Not to take: the icon set (`Assets.car` is the package's artwork), the SF-only typography as a
*specification* (we may use the platform UI font, but our type scale is ours), and any measured
pixel-for-pixel reproduction of an iPad layout. The target is **Procreate's proportions and
grouping**, not its pixels.

## 7. Unknowns

- No method bodies and no runtime: hit areas, animation, the delay default for auto-hide, and which
  controls actually appear for a given tool are unknown.
- 25 nibs and every `Assets.car` remain undecoded. Glyph shapes, icon weights and the exact
  spacing inside code-built rows (menu items, brush sections, gesture cells) are unknown.
- `hierarchy_complete` is false throughout; rows built at runtime may add controls.
- Procreate **Pocket** is a different layout family in this same package (`…Pocket` nibs). The
  observations above are the iPad layout unless the frame is 393 × 852.
- This is a repack (`cryptid 0`, no `embedded.mobileprovision`); authenticity is unverified, as in
  the earlier 2Dope passes.

## 8. Reproduce

Scripts and the reduced inventory live in `beta/.rea-work/procreate-ui/` (extracted bundles are
git-ignored):

```powershell
cd beta\.rea-work\procreate-ui
python inventory.py "D:\Downloads\Misc\Compressed\Procreate_5.4.9_Pro.ipa" --list-only
python extract_ui.py     # 140 UI members into ui-subset
python extract_ui2.py    # the 64 omitted chrome documents into ui-subset2
python strings.py "ui-subset\Payload\Procreate.app\en.lproj\Localizable.strings" > localizable-en.tsv
```

Then, in REA: `open_bundle_resources` on each subset `.app` → `decode_interface_builder`
(`max_documents` 64). `summarize_ui.py` and `geometry.py` turn the exported Evidence bundle into the
outlet/action and frame tables used above; `python geometry.py evidence-ui.json <document>` prints
one document's frames.

## 9. Evidence

| Evidence | Covers |
|---|---|
| `ev_58d08d7fbbdc2901ce5504151e0de9839338118f57740ce28f08d474101b0b6e` | IB decode, 64 documents (4,792 nodes; includes `DocumentNavigation`, Gallery, Brush, Colour panel) |
| `ev_48771e8b1436ff2a3c5da31771a9d6cbd2881d97f8202456717e07ed564dd208` | IB decode, 24 chrome documents (`NotificationBar`, `ShiftingToolbarView`, `ProLibrary`, Layers, menus) |
| `ev_e03a1da6981c6829bbec9ee2268ce4655b1853c28fc3bf6f25268dbee4e070ff` | summary view of the second decode |
| `ev_4a372bb70a5901ccd98615b6d5369c1b672ee23c774e4aa52da2ad9fc54e7fd2` | summary view of the first decode |
| `beta/.rea-work/procreate-ui/ui-inventory.json` | every interface member of the IPA with size and CRC |
| `beta/.rea-work/procreate-ui/evidence-ui.json` | the exported bundle the tables were generated from |
