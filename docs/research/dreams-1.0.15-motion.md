# Procreate Dreams 1.0.15: what the package shows, for inkflo's Motion desk

2026-11-12 · REA + local structural read of `D:\Downloads\Programs\Procreate-Dreams-v1-0-15.ipa`.
Reference only; nothing is copied. Companion to the Procreate deep dive
([drawing features](procreate-drawing-features.md), [UI style](procreate-ui-style.md)). This is the
short one: Dreams matters to inkflo only where the Motion desk is concerned.

## 1. What was read

| Item | Value |
|---|---|
| Source | `D:\Downloads\Programs\Procreate-Dreams-v1-0-15.ipa`, 796,446,323 B, SHA-256 `ba466689…539b75` |
| Bundle | `au.com.savageinteractive.Dreams`, 1.0.15 (17462), iPad, minimum iOS 16.0 |
| Executable | thin ARM64, 16,528,768 B, pointer format 6 |
| Tables | **1,267 classes, 9,986 selectors** (435 classes Swift, name only) |
| Interface | 41 nibs, 6 storyboards (`LaunchScreen`, `PocketColor`, `ColorPanel`, `Layers`, `ProContextMenuOldPopover`, `ProPopoverMenu`) — almost all shared resources; Dreams' own UI is built in code |
| Wording | 1,470 English string pairs |
| Not available | bodies, runtime, layout of the code-built UI, `Assets.car` |

The interface finding matters: unlike Procreate (storyboard-driven), Dreams has no readable layout
for its timeline. Its UI evidence is class names, module names and strings.

## 2. Module map (`observed`)

The Swift module names are the architecture, and they are a good model for a motion editor:

| Module | Classes | Role |
|---|---|---|
| `TimelineSwift` | `Timeline`, `TimelineBuild`, `TimelineDerived`, `TimelineRender`, `TimelineShapes`, `TimelineInteractions`, `TimelineSnapping`, `TimelineMultiselect`, `TimelineChanges`, `TimelineWorld`, `TimelineInteractor`, `VisualPlayhead`, `DragEntityBody` | the timeline as a derived, incrementally rebuilt document |
| `ViewerUI` / `ViewerSwift` / `ViewerTheme` / `ViewerSessionEffects` | `TrackContextMenuViewModel`, `TrackKeyframeContextMenuViewModel`, `MultiselectKeyframeContextMenuViewModel`, `TimelineColors`, `PlayheadEssential` | menus and colour per track/keyframe, the playhead |
| `Flipbook` | `FlipbookViewController`, `FlipbookPickerView(paging/deck/lifecycle)`, `FlipbookPickerCell`, `FlipbookDeckViewLayout`, offset converters | frame-by-frame drawing, paged picker |
| `StagePopover` | `OnionSkinColorCell`, `OnionSkinColorControl` | the onion-skin settings popover |
| `Theatre` | `TheatreAboutContentView` | the project/stage shell |
| `Transactor` | `DeferredAudioTrackIdentifier` | undo/transaction plumbing |
| `RenderSwift`, `StorageSwift`, `CommonUI`, `CommonAssets` | project render and storage | — |

`TimelineChanges` + `TimelineDerived` + `TimelineBuild` reads as: edits produce a change set, the
timeline is rebuilt from it, renderables are derived. That is a **cue list compiled to a render
plan**, not a retained keyframe graph — which is the model inkflo's PLAN already argues for.

## 3. Tracks, and the rules that make them types

`observed` strings give a complete, opinionated track model:

| Concern | Strings |
|---|---|
| Types | drawing, video, keyframe, audio, text, group (each with its own add/delete strings) |
| Lifecycle | add track, delete, duplicate, duplicate contents, group contents, copy/cut/paste tracks, convert drawing layers to tracks / timeline content |
| State | hide/show, mute/unmute, solo, "track visibility", "Track options" |
| Limits | "Maximum number of tracks exceeded", "Maximum number of video tracks exceeded" |
| **Type rules** | "Cannot paint on a keyframe track", "Cannot paint on a video track", "Cannot open Flipbook on a keyframe track / video / audio / text / group / when empty", "Cannot drop this content onto a video track", "Invalid track for this content" |

That last group is the design lesson: Dreams *names* what a track is for and refuses the wrong
action with a specific reason. inkflo's Motion desk should do the same for cue targets (panel,
page, spread) instead of silently ignoring a drop.

## 4. Keyframes and content

`observed`: `add keyframe`, `add keyframe at start`, `delete keyframe`, `clear keyframes`,
`distort keyframe`, `Keyframes`, plus context-menu view models for a track, a keyframe, and a
multi-selection of keyframes. `TimelineSelectPopover` / `TimelineSelectCardView` is the selection
surface.

`inkflo choice`: keep the cue list. A cue is a named effect on a panel with a start and duration; a
"keyframe" UI invites a timeline inkflo does not want. What is worth borrowing is the **context menu
per object type** (track menu vs keyframe menu vs multiselect menu), because it keeps destructive
actions close to the thing they affect.

## 5. Onion skin

`observed`: onion skin on/off, `onion skin frames` (count), `onion skin opacity`,
**`onion skin color backward` and `onion skin color forward`** (separate colours),
"Onion skins blend primary frame", `Edit onion skin`, and a dedicated colour control
(`OnionSkinColorControl`, `OnionSkinColorCell`).

Two details are better than what most apps do: forward and backward tints are independent, and the
current frame can blend into the onion stack. If inkflo ever shows neighbouring panels while
drawing (a light table), those two rules are the ones to copy.

## 6. Timeline interaction

`observed`: `TimelineSnapping`, `TimelineMultiselect`, `DragEntityBody`, `DragBindingHandleActivity`,
`TimelineSelectionActivity`, `VisualPlayhead`, and the onboarding line "Flick the timeline away to
make more room to draw." Plus `Enable Timeline Edit with finger`, `Enable Undo and Redo gestures`.

`inferred`: drag-and-drop with snapping and multi-select, a timeline that can be flicked out of the
way and returns, and per-gesture enable/disable.

`inkflo choice`: the Motion desk should have a **collapsible cue strip** (flick/hide, returns on
demand) rather than a permanent timeline, snapping when dragging cues between panels, and
multi-select of cues. That is a small build on top of inkflo's existing panel order.

## 7. What to take, and what not to

| Take | Why |
|---|---|
| Track/cue **types with named rules** | prevents ambiguous drops; cheap validation with good messages |
| Change-set → derived render plan | matches inkflo's cue model and keeps undo simple |
| Context menu per object (track / cue / multiselect) | keeps destructive actions local |
| Forward/backward onion tints + primary blend | the best small idea in the package for a comic light table |
| Collapsible timeline / cue strip | the canvas is the product; the timeline should yield |
| Snap + multiselect when dragging cues | expected of any timeline |

| Skip | Why |
|---|---|
| Keyframe graph, distort keyframes, video tracks | inkflo is a comic pipeline, not a compositor |
| Audio tracks and the audio session plumbing | out of scope for now |
| Flipbook frame drawing | inkflo's animation is panels and pages, not flipbooks |

## 8. Evidence

| Evidence | Covers |
|---|---|
| `ev_859b9583…` | Dreams 1.0.15 Interface Builder decode (41 documents, all shared resources) |
| `beta/.rea-work/procreate-deep/dr-classes.tsv` | 1,267 classes (TimelineSwift, Flipbook, ViewerUI…) |
| `beta/.rea-work/procreate-deep/dr-methods.tsv` | 9,986 selectors |
| `beta/.rea-work/procreate-deep/dr-strings.tsv` | 1,470 English string pairs |
| `dreams-1015.json` | bundle identity, archive counts, Mach-O facts |
