# Procreate's UI style, as a spec inkflo can build from

2026-11-12 · second half of the deep dive on `D:\Downloads\Programs\Procreate-v5-4-4.ipa` and
`Procreate-Dreams-v1-0-15.ipa`. This is the **visual and component** system: the control kit, the
metrics, the surfaces, and the patterns that make the app read as Procreate. The feature pass is
[procreate-drawing-features.md](procreate-drawing-features.md); the chrome anatomy is
[procreate-interface.md](procreate-interface.md).

Nothing here is copied: no icons, fonts, colours, artwork or layout files. Sizes and structure are
observations; the components are ours to build.

## 1. What the evidence is

| Source | Contribution |
|---|---|
| Procreate 5.4.4 nibs (115; the 113 of 5.4.9 plus `PreviewView` / `PocketPreviewView`) | frames, outlets, target-actions, fonts, system colours, blur views |
| `ProControls`, `ProControlsEssentials`, `ProControlsPocket`, `ProControlsDeprecated` bundles | the control kit: 50 named classes |
| Class names (`observed`, no bodies) | 16 `…CardViewController`s, 36 popovers, 57 toolbars, 144 view controllers |
| English strings | labels, hints, and the tone of the wording |
| Dreams 1.0.15 (41 nibs, 6 storyboards) | shares the same `ColorPanel`/`Layers`/`ProControls` resources; its own UI is **built in code**, so it contributes module and component names, not layouts |
Limits: no `Assets.car` decode (icon shapes and weights unknown), no runtime, no shader, no measured
contrast or radii. Corner radii, shadows and exact paddings are **not** in the archives and are
marked unknown below.

## 2. The control kit

`observed` — every class in the `ProControls*` bundles, grouped by what it is:

| Kind | Classes | Read as |
|---|---|---|
| Sliders | `ProSlider`, `ProSliderControl`, `ProSliderTrackView`, `ProSliderControlVariation`, `ProBrushSlider`, `ProBrushSliderControl`, `ProBrushSliderTrackView`, `ProBrushSliderSelector`, `GrooveView`, `ProMultiSliderTrackLayer` (Dreams) | one slider family with a groove/track, a control, and a variation for size/opacity; brush sliders are a sized variant |
| Buttons | `ProButton`, `ProSwipableButton`, `ProButtonSelector`, `ProBarrelRollController` (brush size roll) | flat buttons plus a swipe-to-adjust button and a "barrel roll" size scrub |
| Tabs | `ProTabBar`, `ProTabBarButton`, `ProTabView`, `ProTabViewController`, `SegmentMask` | a segmented tab bar with a moving mask, used by Brush Studio and the colour panel |
| Toggles | `ProToggle`, `ProToggleSelector` | switch with a selector for state |
| Numeric | `ProNumberPad`, `ProMultiNumericField`, `ProKeyShortcutControl`, `ProKeyShortcutHeader`, `KeyTagLabelView`, `KeyTagPlaceholderView` | keypad entry, multi-field numeric rows, and **keyboard-shortcut tags rendered into menus** |
| Message | `ProMessageBar`, `ProMessageBarPermanent` | the notification/toast bar, transient and pinned variants |
| Structure | `ComponentSeparatorLine`, `FadeMaskContainerView`, `ProVisualEffectView`, `GraphBackgroundModel` | hairline separators, masked scrolling edges, blur surfaces, graph/grid backing for curves |
| Motion | `ProStretchyBlobView`, `PulseView`, `FadeMaskContainerView` | the morphing blob, a pulse indicator, fade-masked content |
| Text | `ProLabel`, `ProImageView`, `RenameTextField`, `FullscreenRenamingViewController` | labels, images, inline rename |

Three things follow for inkflo's CSS layer:

1. **A slider is a component, not an `<input type=range>`.** It has a groove, a control, a label, a
   value readout, a scrub gesture, and a numeric-entry path. inkflo's `slider()` helper is close;
   it should become the one slider component with those parts.
2. **Key tags are part of the menu.** Procreate renders the shortcut inside the popover row. Cheap
   in the DOM, and it teaches the keyboard.
3. **A message bar has two modes** (transient hint, permanent notice). That maps to `toast()` and a
   pinned hint line.

## 3. Metrics

`observed` from decoded nib frames (design geometry, not device measurements):

| Element | Value |
|---|---|
| Canvas bar, one row | 44 pt |
| Canvas bar with the tool-options row | 95 pt total, 0.5 pt hairline under it |
| Button target | 44 × 44 pt; tool cells 44 pt wide × full bar height |
| Gap inside a cluster | 8 pt; 14 pt between action groups |
| Size/opacity sidebar | 51 × 519 pt (iPad), 40 × 519 pt (Pocket) |
| Notification bar | 18 pt message line + optional 32 pt control slot |
| Floating toolbar wrapper | 772 × 83 authored; bottom painting bar 976 × 50 |
| Gallery nav bar | 64 pt; buttons 43–72 pt wide × 84 pt tall; nav stack gap 24 pt |
| Layers row | thumbnail, two-line title (17 pt name, 12 pt state), 2 pt stack spacing, slide tray behind |
| Brush Studio | preview block on top, `Settings` title, section column, tab collection |
| Numeric keypad | 11 keys in 4 pt stacks, a title label (`Canvas Size`) |

`inkflo choice`: adopt 44 pt targets, 8/14 pt gaps, 44/95 pt bars, the 51 pt sidebar, and the
18/32 pt message bar as **tokens**. inkflo's desktop app can scale them by a single `--ui-scale`
(1.0 on tablet, 0.85 on desktop) rather than re-specifying every control.

## 4. Surface and colour

`observed`:

- **Blur, not paint.** The top bar sits on a `UIVisualEffectView`; the gallery and the rename field
  use the same material. The chrome is a translucent layer over the canvas.
- **System colours only.** Nib values reference `labelColor`, `systemBackgroundColor`, `clearColor`
  — no custom palette is archived; light/dark comes free from the system.
- **System type.** `.SFUI-Regular` 17 and 18, `.SFUI-Bold` 20, `.SFUI-Light` 17 for layer names and
  12 for their second line.
- **Line weight.** Hairlines are 0.5 pt (the bar separator, the notification bar's rule).
- **Unknown:** corner radii, shadow values, exact opacity of the blur, and every icon.

`inkflo choice`: in Focus, a `backdrop-filter: blur(24px) saturate(1.4)` surface over the page with
token colours that behave like system colours; page stays paper; 0.5 px hairlines at 1× (1 px at
2×); type scale 12 / 13 / 15 / 17 / 20 with `system-ui`. This gets the *material* right without
touching anyone's artwork.

## 5. The four surfaces, and when each is used

Procreate uses exactly four shapes for settings, and the naming in the package is consistent:

| Surface | Class pattern | Size/shape | Used for |
|---|---|---|---|
| **Card** | `…CardViewController` (16 of them: HSB, Curves, Color Balance, Glow, Noise, Glitch, Chromatic Aberration, Grid, Crop, Liquify ×3, Drawing Guide, Transform settings, Document) | a centred floating panel with a title, a preview/thumbnail area, stacked sections and sliders | deep settings for one adjustment or tool |
| **Toolbar** | `Floating*Toolbar`, `Shifting*Toolbar` (57 toolbar classes) | a horizontal strip over the canvas; floating variant hovers, shifting variant pushes the canvas | the live options of the tool in hand (amount, mode, reset) |
| **Popover** | `…Popover` (36) | an anchored bubble with a grid/list, often with key tags | choosing one of N: blend mode, brush, guide type, selection mode, actions |
| **Panel** | `Layers`, `ColorPanel`, `Brush` storyboards | a docked sheet with a nav bar and a scroll view | browsing: layers, brushes, palettes |

The rule is legible: **one value → slider on a toolbar; a few values → card; a choice → popover; a
collection → panel.** inkflo currently mixes these (settings live in popovers and a context bar), so
the UI pass should sort every control into one of the four.

## 6. Component anatomy

**Card** (`observed` structure, `inferred` ordering): title row (title label, close/reset), a
preview block (brush stroke preview, curve graph, layer thumbnails, guide diagram), then sections of
labelled sliders, then a footer with Reset and Done. `GraphBackgroundModel`, `ProVisualEffectView`
and `ComponentSeparatorLine` are the pieces.

**Layers panel**: a `UINavigationController` whose row is the cell described in the interface doc —
thumbnail, name, secondary state line, visibility, lock, alpha-lock background, clipping indicator,
depth, a slide tray (Select Contents / Duplicate / Clear / Delete), a blend button that opens a
popover, and a long-press drag.

**Brush Studio**: preview block, a `Settings` title, a section column, and a tab collection. The
sections are code-built, named by strings: Stroke (Spacing, Jitter, StreamLine), Stabilize, Taper,
Shape, Grain, Wet Mix, Color Dynamics, Dynamics, Properties, Apple Pencil, About this brush.

**Toolbar with a numeric path**: every slider can be tapped to open a keypad (`ProNumberPad`,
`BrushNumericKeypad` with a title and 11 keys). So the flow is drag → tap → type, never "open a
dialog to type".

**Menu**: a data-driven grid (`ProPopoverMenu`), rows carry an icon, a label, a state and a key tag.
Context menus (`ProContextMenu`) are the same data with a different anchor (long-press).

## 7. Per-tool surface patterns

`observed` from the class set — every tool follows the same three-part shape:

| Tool | Live bar | Deep card | Choice popover |
|---|---|---|---|
| Adjustments | `Floating*Toolbar` (amount, reset) + `Shifting*Toolbar` when the canvas shifts | `*CardViewController` | `FilterCrossMenu` (the adjustment picker) |
| Liquify | `FloatingLiquifyToolbar` / `ShiftingLiquifyToolbar` | `DocumentLiquifyModeCard`, `…SettingsCard`, `…AdjustCard` | `LiquifyToolbarModeSelectionPopover` |
| Drawing Guide | `FloatingDrawingGuideToolbar` / `Shifting…` | `DocumentDrawingGuideSettingsCard` | `DrawingGuideModeToolbar`, `DrawingGuideSymmetryOptionsPopover` |
| Selection | toolbar with Add/Remove/Invert + Feather | `SelectionToolbarFeatherPopover` | saved-masks popover |
| Transform | toolbar with mode + snap toggles | `TransformSettingsCard` | interpolation / numpad |
| Brush | `BrushViewController` bar (size/opacity) | Brush Studio | brush library |

`inkflo choice`: give each Draw tool the same trio — a **tool bar** row under the top bar, a
**card** for its deep options, and a **popover** only for discrete choices. That is the structural
change that will make the Draw desk feel like the reference, independent of visuals.

## 8. Motion and feedback

`observed` names only: `ProStretchyBlobView` (20 selectors — a morphing blob, the thing that makes
Procreate's panels feel alive), `PulseView`, `FadeMaskContainerView`, `ValkyrieTransformModeHandleAnimation`,
`AnimationSettingsCard`, `ProSliderControl` animations. `inferred`: panel open/close morphs from a
button into a card, sliders animate to value, tool changes cross-fade the toolbar.

`inkflo choice`: 120–180 ms ease-out for surface changes, a single "morph from the button" motion
for cards, no bounce, and respect `prefers-reduced-motion`. Motion should never gate a tool.

## 9. Wording

`observed` conventions in the string table:

- **Panels and tools are Title Case** (Layers, Brush Studio, Color Balance, Drawing Assist).
- **Controls are sentence case and short**: "Amount of StreamLine", "Dot pitch", "Depth", "How much
  this brush smudges".
- **Hints are full sentences, second person**: "A finger will always clone", "The interface will
  return after the set delay".
- **Numbers carry units in the label**: `%@pt`, `%.1f%%`.
- **Destructive confirmations state the consequence and that it cannot be undone.**

inkflo should keep its own voice but adopt the shape: Title Case surfaces, sentence-case controls,
unit-bearing values, plain-language confirmations.

## 10. The spec to build against

Tokens (one place, `src/styles/tokens.css`):

```css
--tap: 44px;            /* minimum target */
--bar: 44px;            /* one chrome row */
--bar-2: 95px;          /* chrome + tool options */
--gap: 8px;             /* inside a cluster */
--gap-group: 14px;      /* between clusters */
--hairline: 1px;        /* 0.5pt at 1x */
--sidebar: 51px;        /* size/opacity, the thing handedness moves */
--msg: 18px;            /* message line */
--msg-tool: 32px;       /* message bar control slot */
--radius: 10px;         /* inkflo choice; reference value unknown */
--blur: 24px;           /* backdrop blur */
--type-1: 12px; --type-2: 13px; --type-3: 15px; --type-4: 17px; --type-5: 20px;
```

Components to build once and use everywhere: **Slider** (groove + control + label + value + scrub +
numeric entry), **Card** (title, preview slot, sections, footer), **Popover** (rows with icon,
label, state, key tag), **Toolbar** (tool options row), **MessageBar** (transient/permanent),
**TabBar** (with moving mask), **Panel** (nav bar + scroll + rows), **KeyCap**.

Do not: copy icons or the brush previews, mimic the exact blur recipe of a screenshot, or reproduce
the iPad's pixel layout on desktop — the proportions and the four surfaces are the transferable part.

## 11. Unknowns

- No `Assets.car` decode: icon set, weights, and the brush-thumbnail style are unknown.
- Radii, shadows, blur radius/opacity, and exact paddings are not archived.
- Dreams' own UI is code-built; its nibs are shared resources, so its layout cannot be read this way.
- 16 CardViewControllers are named but their control lists are Swift and therefore name-only.

## 12. Evidence

| Evidence | Covers |
|---|---|
| `ev_58d08d7f…`, `ev_48771e8b…` (Procreate 5.4.9 chrome) | bars, tiles, frames, fonts, colours |
| `ev_859b9583…` (Dreams 1.0.15, 41 documents) | shared panels, control resources |
| `pc-classes.tsv` / `dr-classes.tsv` | control kit and surface inventory |
| `pc-strings.tsv` / `dr-strings.tsv` | labels, hints, wording conventions |
| `procreate-544.json`, `dreams-1015.json` | archive identity and counts |
