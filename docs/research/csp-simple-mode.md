# Clip Studio Paint's Simple Mode on the PC install

2026-11-12 · local read of `C:\Program Files\CELSYS\CLIP STUDIO 1.5\CLIP STUDIO PAINT`, **CSP
5.0.4** (executable SHA-256 `11a8ceab…e0b89`, 93,357,664 B). Question: does the Windows build carry
the tablet (Simple Mode) interface, and is its UI available as data? Answer: **yes, in three
separate layers** — the mode itself, the tablet workspaces as SQLite, and the full string set.

Reference only. Nothing from CSP ships in inkflo (the palette/workflow vocabulary may be studied;
files, icons, layouts and assets may not).

## 1. The mode is in the Windows build

`observed` strings in the English catalogue
(`resource/english/742DEA58-ED6B-4402-BC11-20DFC6D08040`, 3.5 MB) and in the executable:

| String | Meaning |
|---|---|
| `Switch to tablet interface` | a preference, sitting under a **Layout** heading next to interface scaling, dark mode and touch operations |
| "When you change the settings, the position and size of the palette dialog and the command bar settings are reset. The change will be effective after the application is reactivated." | switching resets palette placement and needs a restart |
| `Show Studio Mode/Simple Mode switch button`, `Studio Mode/Simple Mode switch button` | an optional on-canvas mode toggle |
| "Tap to switch to Studio Mode, and tap again to return to Simple Mode. You can drag the button to place it wherever you like." | the toggle is draggable |
| `Switched to Simple Mode`, `Switch to Simple Mode`, "All canvases will close to switch to Simple Mode" | runtime switch, with a confirmation |
| "This layer type is not supported in Simple Mode…", "Cannot open Flipbook on a keyframe track" (Dreams) | mode-specific limits are named |

Executable identifiers: `simpleui`, `simplemode`, `applicationchangetosimpleui`,
`changetooriginaluimodefromsimpleanimationconfirm`, `usesimpletimeline`, `simpletimelineframerate`,
and three settings keys — **`SimpleModeTabletPaletteLayout`**, **`SimpleModeTabletHorizontalFlipLayout`**,
**`SimpleModeTabletCanvasReferenceViewVisibility`**.

So the tablet UI is compiled in; Windows simply does not boot into it.

## 2. The tablet workspaces are shipped as data

`Settings/PAINT/WorkSpace` holds three families — `Android`, `Mac`, `Win` — each with three presets
per language. The **Android** set is the tablet/Simple Mode layout:

| File (English) | Bytes | Workspace name | Palettes | Command-bar items | Command / tool shortcuts |
|---|---|---|---|---|---|
| `presetAndroid_0.spws` | 143,360 | **Illustration** | 47 | 22 | 870 / 258 |
| `presetAndroid_1.spws` | 196,608 | **Comic** | 47 | 22 | 871 / 252 |
| `presetAndroid_2.spws` | 151,552 | **By category** | 47 | 22 | 870 / 258 |
| `presetWin_1.spws` (desktop, for contrast) | 143,360 | Illustration | **37** | 22 | 882 / 260 |

Each `.spws` is a **SQLite 3** database (magic `SQLite format 3`), read-only-queryable. Schema:

| Table | Contents |
|---|---|
| `workspaceinfomation` | the workspace name (`Illustration`, `Comic`, `By category`) |
| `workspaceplacement` | one binary blob (48–53 KB) with the palette layout |
| `workspacepreference` | units |
| `workspaceshortcutmenu` | ~870 rows: `menucommandtype`, `menucommand`, `shortcut`, `modifier` |
| `workspaceshortcuttool` | ~258 rows: tool UUID → shortcut |
| `workspacetoolbaritem` | 22 rows: `categoryindex`, `itemgroupindex`, `commandIDtype`, `command`, `option`, `itemcolor`, `name` |
| `workspacetoolbardatamode` | tablet / slate / remote-controller flags |

### The tablet palette set (`observed`)

The Android workspace names **47** palette kinds. Ten of them exist only there, with an `I` suffix:
`palettekindcolorsetI` and `palettekindmaterial0I` … `palettekindmaterial9I`. The desktop workspace
has 37 and none of the `I` variants. Shared vocabulary: action, align/distribute, brush size, colour
blend, colour circle, colour guide, colour history, colour set, colour slider, history, item bank,
layer comp, layer find, layer order, light table, material 0–9, memory information, mix, multi-view,
navigator, property, quick access, sub tool, sub view, timeline, tool, tool option, tool slider.

### The placement blob

A typed binary tree, not JSON. Keys are length-prefixed ASCII; values carry a one-byte type tag:

```
… "contentrectI" 00 00 00 37
   "typename" 06 01 "rect"
   "bottom" 13 02 06 a5      ← int, 2 bytes LE  = 0xA506
   "right"  13 02 0a f0
   "top"    13 00
   "left"   13 00
   "name"   06 01 "palettekindcolorsetI"
   "contentxscaleI" … "rational" { "denominator" 13 01 08, "numerator" 13 01 11 } → 17/8
```

Per palette it stores a `contentrect` (top/left/right/bottom), `contentxscale`/`contentyscale` as
rationals, and a `name`; the frame stores `dockplacementmainframerectI` (here 61450 × 42246 in
fixed-point), `dockplacementmainframexscaleI/yscaleI`, `dockplacementmainframemaximize`,
`dockplacementcommandbarvisible`, `dockplacementswitchallpalette` and
`dockplacementswitchworkonly`. Docked palettes in the shipped presets carry zero rects — their
positions are computed at runtime — so the frame rect and scales are the reliable geometry.

## 3. Strings, tutorials, assets

- The English catalogue carries the whole Simple Mode vocabulary: mode switching, unsupported-layer
  warnings, "Switch to simple Layer palette", "Simple view", "Simple tone settings", Tabmate command
  lists per mode, and the tutorial links
  (`introduction_simple_tab/tutorial/tutorial.html`, `simple-material-palette`, `assets-simple-brush`).
- The executable names shipped tutorial documents: `SimpleLayerTutorial.clip`,
  `SimpleFillToolTutorial.clip`, `SimpleLayerClipAndLockAlphaTutorial.clip`,
  `SimpleLayerCompositeModeTutorial.clip`, `SimpleLayerOrderTutorial.clip`,
  `SimpleSelectToolTutorial.clip`, `SimpleMaterialTutorial.clip`, `Simple3DLayerEdit*Tutorial.clip`,
  `SimpleBasicTutorial.clip`.
- Icons are not addressed by name in these tables; `workspacetoolbaritem.command` is the stable key,
  and the image is resolved by command ID at runtime. No icon-to-file map was found.

## 4. Limits

- The placement blob is an undocumented typed format; a full parser is needed for every palette's
  geometry, and docked rects are zero in the presets anyway.
- Item `name` values inside the `english` Android workspace are **Japanese** — the workspace is not
  localised; labels should come from command IDs.
- Nothing here is a screenshot: appearance (spacing, radii, colours) still needs the running app or
  the asset files.
- This is the Windows build; the iPad/Android tablet builds may add or drop palettes.

## 5. What inkflo can take

| Take | Why |
|---|---|
| The **mode concept**: one canvas, a mode toggle, a curated palette subset, bigger targets | Simple Mode is a *different arrangement of the same tools*, not a different app — the same lesson as Procreate's Focus |
| The **tablet palette set** as a checklist | which palettes a touch-first comic UI actually surfaces (47 vs 37) |
| The **restart/reset contract** | switching layout resets palette placement and says so — honest, and it avoids half-migrated layouts |
| The **mode limits stated in words** | "this layer type is not supported in Simple Mode" beats a disabled control with no explanation |
| **Two named workspace presets per craft** (Illustration, Comic) | inkflo can ship `Comic` and `Illustration` layout presets the same way |

Do not ship: the `.spws` files, CSP icons or assets, or the workspace names as product names.

## 6. Reproduce

```powershell
# read a workspace without touching the install
python .rea-work\csp-simple\spws.py "…\Settings\PAINT\WorkSpace\Android\english\presetAndroid_0.spws"
python .rea-work\csp-simple\dumpws.py <copy.spws>       # names, toolbar items, placement
python .rea-work\csp-simple\palettes.py <copy.spws>     # palette kinds + shortcut counts
python .rea-work\csp-simple\scanstrings.py CLIPStudioPaint.exe "simplemode|simpleui"
```

The scripts are in `beta/.rea-work/csp-simple/`; the copied `.spws` files are git-ignored.
