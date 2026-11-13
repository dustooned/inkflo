# Procreate 5.4.4: the drawing feature surface

2026-11-12 · REA static read of `D:\Downloads\Programs\Procreate-v5-4-4.ipa`. Reference only: no
asset, font, icon, brush or code is copied into inkflo. This is the **feature** pass — what the app
can do, how its own model splits it up, and what inkflo should do about each part. The interface
pass is [procreate-interface.md](procreate-interface.md) and the visual system is
[procreate-ui-style.md](procreate-ui-style.md); the build order is
[procreate-integration-matrix.md](procreate-integration-matrix.md).

Labels follow [REA-QUEUE.md](../REA-QUEUE.md): `observed` = read from the shipped package,
`inferred` = follows from names and structure, `inkflo choice` = our decision.

## 1. What was read

| Item | Value |
|---|---|
| Source | `D:\Downloads\Programs\Procreate-v5-4-4.ipa`, 777,430,382 B, SHA-256 `7b1dad3a…68b54e` |
| Bundle | `au.com.savageinteractive.procreate`, 5.4.4 (56832), iPad, minimum iOS 16.0 |
| Executable | thin ARM64, 19,119,424 B, `__text` 12,247,856 B, pointer format 6 |
| Tables | **1,707 Objective-C classes, 19,141 selectors** (318 classes have no readable method list — Swift, name only) |
| Interface | 115 nibs, 18 storyboards — the 113 of 5.4.9 plus `PreviewView` and `PocketPreviewView` |
| Wording | 2,511 English string pairs across 10 tables |
| Not available | method bodies, runtime behaviour, shader source, default values, `Assets.car` artwork |

Everything below is class, selector and string vocabulary plus decoded nib structure. Where a
number is quoted it is a count of what the package declares, not a quality claim.

## 2. The model, in the app's own words

Procreate's engine is a set of **modes**: one object family per interaction, each with
`start` / `tick` / `updateState` / `terminateAndCommit`. The complete list (`observed`) is the
cleanest statement of "all the drawing features":

| Mode | What it is |
|---|---|
| `StrokeMode`, `StrokePreviewMode`, `StrokeAnimatedMode` | painting, previewing, animating a stroke |
| `SelectionMode`, `LayerSelectMode` | marquee/wand selection, and pick-the-layer-under-the-pen |
| `TransformMode`, `Transform3DMode` | free/uniform/distort/warp; 3D object transform |
| `FilterMode`, `FloodMode` | adjustments and fills |
| `LiquifyMode`, `TextMode`, `TextureEditMode` | liquify, type, texture-set editing |
| `CompositeMode` (+ playback variants) | how the stack is composited, and animation playback |
| `ClearMode`, `CopyMode`, `DuplicateMode`, `MergeMode`, `ResizeMode`, `BlockMode` | destructive edits, each its own undoable mode |

That split is worth copying in spirit: in inkflo, every canvas interaction should be a mode object
with the same lifecycle, so preview, commit and undo are uniform. inkflo already does this loosely
per tool; the package shows it done as one protocol.

## 3. Paint: the stroke pipeline

`observed`, from the `ValkyrieStroke*` family (18 classes) and the brush shaders:

| Stage | Classes | Notes |
|---|---|---|
| Input → plots | `ValkyrieStrokePlot`, `ValkyrieStrokePlotControl`, `ValkyrieStrokePointArray` | raw points become plot records |
| Stabilise | `ValkyrieStrokeFFTSmoothing`, `plotSmoothing`, `plotMovingAverageStabilization`, `plotFFTSmoothingAmount/Bias/Kind`, StreamLine window | a stage pipeline, not one slider |
| Space | `plotSpacing`, `plotSpacingJitter`, `plotSpacingSpeed`, `plotSpacingVersion` | per-brush, versioned |
| Jitter | `plotJitterLateral/Longitudinal` plus Roll and Tilt variants | jitter is directional, not isotropic |
| Synthesize | `ValkyrieShaderStrokeSynthesize`, `FragmentStrokeSynthesize` (+Patch), `ValkyrieStitcher` | dabs into tiles |
| Transfer | `FragmentStrokeTransfer`, `ShaderStrokeTransferComponents`, `KernelFastpathTransfer` | wet/bleed transfer between passes |
| Smudge | `KernelSmudge`, `KernelSmudgeInitialize`, `ShaderStrokeSmudgeInitialize` | smudge carries albedo/metallic/roughness between dabs |
| Record | `ValkyrieStrokeRecording`, `StrokeRecordingFrame` | stroke recording exists as data (timelapse and replay) |

`inkflo choice`: keep inkflo's stroke-as-data (it already stores strokes and replays them) and add
the two missing stages — windowed StreamLine with pressure strength, and directional jitter. Do not
copy the tile/stitch GPU pipeline; Canvas 2D dabs are enough for our page sizes.

## 4. The brush model: 278 properties

`ValkyrieBrush` declares **539 selectors / 278 properties** (`observed`). Grouped as the Brush
Studio groups them:

| Group | Properties (representative) |
|---|---|
| Stroke | `plotSmoothing`, `plotSpacing`, `plotSpacingJitter`, `plotSpacingSpeed`, `plotMovingAverageStabilization`, `plotFFTSmoothingAmount/Bias/Kind`, `streamlinedWindowPointCount`, `plotJitterLateral/Longitudinal` (+Roll, +Tilt) |
| Stabilize | `globalStabilization`, `globalPlotFFTSmoothing*`, `smoothingZoomCompensation`, `smoothingCatchup(AtEnd)`, `smoothingRadiusMode`, `smoothingValue`, `dynamicPressureSmoothing`, `pencilPressureSmoothing` |
| Taper | `pencilTaperStartLength/EndLength/Size/Opacity/Pressure/Shape/SizeLinked` and the same set for `fingerTaper…` |
| Shape | `shapeImage/Path/Texture`, `shapeCount(+Jitter/Roll/Tilt)`, `shapeRotation`, `shapeRoundness`, `shapeScatter` (+Roll), `shapeAngle`, `shapeAzimuth`, `shapeFlipX/YJitter`, `shapeNoise`, `shapeRandomise`, `shapeFilter(Mode)`, `shapeInverted` |
| Grain / texture | `grainImage/Texture/Path/BlendMode`, `heightTexture/Amount/Scale`, `metallic*`, `roughness*`, `textureDepth(+Jitter/Minimum/Tilt)`, `textureBrightness/Contrast/Movement/Rotation/Zoom/Orientation/Scale/OffsetJitter`, `texturizedGrainFollowsCamera` |
| Wet | `wetEdgesAmount`, `burntEdgesAmount`, `burntEdgesBlendMode`, `dynamicsWetPull`, `dynamicsWetnessJitter`, `dynamicsPressureBleed` (+Response) |
| Colour dynamics | jitter and tilt for hue, saturation, lightness, darkness, opacity; `hueJitterTiltAngle`, `bleedTiltAngle`, `secondaryColorJitter*`, `dualBlendMode` |
| Pressure / tilt / roll | `dynamicsPressure*`, `dynamicsTilt*`, `dynamicsRoll*`, `dynamicsSpeed*` each for size, opacity, flow, bleed, brightness, saturation, hue, secondary colour, shape roundness |
| Flow / mixing | `renderingMaximumFlow`, `renderingMaxTransfer`, `renderingModulatedTransfer`, `renderingRecursiveMixing`, `dynamicsLoad/Dilution/Blur/Grade/Falloff/Attack` |
| Per tool | `paintSize/Opacity`, `smudgeSize/Opacity`, `eraseSize/Opacity`, `cloneSize/Opacity/Offset`, `savedPaint/Smudge/EraseSizes/Opacities` |
| Metadata | `name`, `displayName`, `authorName`, `authorPicture`, `thumbnailPath`, `signaturePath`, `version`, `importedFromABR`, `resetPoint`, `getResetPath` |

`inkflo choice`: inkflo's `BrushSettings` covers shape/spacing/dynamics/taper at a fraction of this.
Adopt the *structure* (Stroke · Stabilize · Taper · Shape · Grain · Wet · Colour dynamics ·
Properties), expose roughly 40 controls, and treat the rest as import-only. The one high-value
addition is **directional jitter + per-device taper** (Pencil vs finger), because that is what
separates a tidy comic line from a wobbly one.

## 5. Every tool, and what it actually is

| Tool | `observed` engine | Key parameters | inkflo today | Decision |
|---|---|---|---|---|
| **Paint** | `StrokeMode` + brush | §4 | ✅ brush, pencil, per-brush size/opacity | adopt missing stabilise/taper pieces |
| **Smudge** | `KernelSmudge` with carryover buffers; `lightGlaze`/`heavyGlaze`/`intenseGlaze`; `dynamicsSmudgePull` | smudge size/opacity, pull | ✅ smudge | add glaze strength + pressure pull |
| **Erase** | same stroke mode, `eraseSize`/`eraseOpacity`; per-layer alpha | — | ✅ eraser (ink/pencil/vector variants) | keep |
| **Clone** | `DocumentCloneController`, `CanvasPaintableClonePuck`, `cloneOffset` | offset, size, opacity, "finger always clones", clone lock/unlock | ✅ clone (Set source) | keep; add clone lock |
| **Liquify** | `LiquifyMode` (40 selectors), `LiquifyBrushSettings`, particles, puck | radius, pressure, chaos, momentum; modes **Push, Twirl Left/Right, Pinch, Expand, Crystals, Edge, Reconstruct, Turbulence** | ❌ | adopt 5 modes (Push, Twirl, Pinch, Expand, Reconstruct) as a panel-level effect |
| **Fill** | `FloodMode` + `DocumentFloodController` | threshold, realtime drag, `sampleLayer`, `masked`, `preserveAlpha`, `layer`, colour fill in selection | ✅ bucket, drag, lasso, leftovers, auto flats, gap close | add live threshold drag + "refer to layer" choice |
| **Selection** | `SelectionMode` (104 selectors in the controller) | kinds automatic/freehand/rectangle/ellipse; feather (preview, one commit); invert; saved masks with thumbnails; x-ray; colour fill; add/remove | ✅ marquee + line selection | add saved selections, feather, automatic (wand) selection |
| **Transform** | `TransformMode` (100 selectors) | kinds **Freeform, Uniform, Distort, Warp**; Advanced Mesh; angular vs Cartesian snapping with lock/hand-over; interpolation Nearest/Bilinear/Bicubic; numeric keypad; flip/rotate/nudge | ✅ move/scale/rotate/flip, typed values | add Warp grid + snapping + interpolation choice |
| **Text** | `TextMode`, `TextRenderer`, `TextImposter`, `TransformedTextLayer`, `TextAnimation` | live text, rasterized on transform, animated text | ✅ lettering engine (2Dope) | keep; do not adopt a separate text layer model |
| **Adjustments** | `FilterMode` + 13 `ValkyrieFilter*` classes | see §6 | ⚠️ HSB + blur only | adopt 8 of 13 |
| **Drawing Guide / Assist** | `ValkyrieDrawingGuide` (82 selectors) | 2D grid (size, thickness, opacity), isometric, perspective nodes with per-node colours, horizon angle; symmetry vertical/horizontal/quadrant/radial/rotational; assist per layer with Pencil double-tap | ✅ grid, isometric, perspective, symmetry, assist, snap | add per-node perspective colours and guide colour/opacity controls |
| **QuickShape** | `ValkyrieShapeDetection` (40 selectors) | 12 shapes each with an error metric + fit: line, arc, circle, ellipse, triangle, equilateral triangle, quadrilateral, rectangle, square, polyline | ✅ quickshape | add the "possible shapes" notification + delay setting |
| **Snapping / Magnetics** | `ValkyrieSnapper` + `SnapperInterface` | distance and velocity thresholds, edge fade, angular/Cartesian contexts | ✅ assist lock/snap (partial) | adopt velocity threshold, keep the rest |
| **Layers** | `ValkyrieLayer`, `LayerBacking`, `MergeMode`, `MaterialLayer` | **26 blend modes** (§7), masks, clipping, alpha lock, reference layer, groups, materials | ⚠️ no blend, no alpha lock, no clipping; group mask + opacity | adopt blend + alpha lock + clipping |
| **Colour** | `FragmentColorPickerRing/Classic/Harmony`, `IndexedImagePalette`, `ColorProfile`/ICC | disc, classic, harmony, value, palettes, history, colour profiles | ⚠️ basic picker + palettes | adopt Disc/Classic/Harmony + history |
| **Reference** | `ReferenceMediaViewController` (92), PIP, face-paint, countdown | image/import reference, picture-in-picture, camera | ❌ | adopt PIP reference window (cheap, high value for comic artists) |
| **Timelapse** | `VideoRecorder` (22), `VideoSegmentInfo` (27), `VideoTimelapseWriter`, `VideoManager` (31) | segmented recording, export speed, watermark-free | ❌ | skip (out of scope; inkflo's replay is data) |
| **Animation Assist** | `ValkyrieDocumentAnimation`, `AnimationSettingsCard/Popover`, `FloatingAnimationToolbar` | onion on/off, count, opacity, previous/next tint colours, blend mode, frame rate, loop/one-shot/ping-pong | ❌ (inkflo has a Motion desk, not frame animation) | skip; Motion desk uses cues |
| **3D / materials** | `Transform3DMode`, `SceneMesh`, `MaterialLayer`, PBR material/light shaders | paint on 3D objects, PBR maps | ❌ | skip |
| **Import / export** | `AdobeFileStreams` (42 classes), video export, share | PSD import **and** export, PNG, CBZ, print PDF with bleed and marks, separations | ⚠️ interop exists; verify round trips | check PSD against a real colourist file |

## 5b. Input: Pencil, touch, hover, pressure

`observed`, from selectors and strings — this is the part of "feel" that is not the brush engine:

| Behaviour | Evidence | inkflo today | Decision |
|---|---|---|---|
| **Hover preview**: a hovering Pencil shows the stroke before contact | `hoverFill`, `hoverOutline`, `hoverPressure`, `previewWetMixEnabled`, `previewPressureScale`, `previewSize`, `previewTiltEnabled` | ❌ | adopt where the browser reports pen hover (`pointermove` with `pressure === 0` and altitude) |
| **Pressure curves**, global and per-user | `ProPressureCurve` (16 selectors), `DefaultPressureCurve`, `StylusCurveViewController`, "reset all pressure and smoothing" | ⚠️ pressure drives size/opacity, no curve editor | add one global curve editor (gain, softness, min/max) |
| **Per-device rules**: finger vs Pencil differ | `pencilTaper*` vs `fingerTaper*`; "A finger will always clone / smudge"; `initOnDevice:` | ⚠️ single input model | split by `pointerType`; let a finger be paint / navigate / clone |
| **Touch to pick the layer under the pen** | `LayerSelectMode`, `KernelLayerSelect`, `LayerSelectState`, "3D material layer can't be selected" | ❌ | adopt: long-press selects the layer under the pen |
| **QuickMenu as one surface** for the most-used actions, invoked by gesture / Pencil double-tap / squeeze | `QuickMenu` strings including per-gesture variants, `Customize QuickMenu` | ❌ | adopt a small radial/panel menu on long-press |
| **Pencil double-tap / squeeze** bound to a user-chosen action | "Double-tap on compatible Apple Pencil will toggle Drawing Assist", "…will invoke QuickMenu", `StylusButtonListView` | ❌ | web equivalent: pen barrel button (where exposed) and a two-finger tap |
| **Canvas gestures**: pinch zoom, rotate, two/three-finger undo/redo, flick | gesture-control strings, `Two-finger and three-finger tap will not undo or redo` | ⚠️ zoom/pan only | add rotate + two-finger tap undo |

The pattern worth copying: **input is a policy, not a constant.** Procreate exposes the same
behaviour as a settable rule per device and per gesture, and every rule has a sentence in the UI.

## 6. The adjustment set, with real parameters
`observed` — one class per adjustment, each carrying `paintDefaults`, `reset`, `undoDescription`
and `interpolate:` (i.e. **every adjustment is animatable**):

| Adjustment | Parameters |
|---|---|
| Hue, Saturation, Brightness | `hue`, `saturation`, `brightness` |
| Curves | `redPoints`, `greenPoints`, `bluePoints`, `gammaPoints`, `curveTexture` |
| Color Balance | `shadows`, `midtones`, `highlights` |
| Gradient Map | `ValkyrieFilterGradient` + `GradientBrowser` palettes |
| Halftone | `dotPitch`, `screenKind` (also the comic tone generator) |
| Noise | `amplitude`, `frequency`, `octaves`, `turbulence`, `scale`, `noiseType`, `multiChannel`, `combinator` |
| Glitch | `glitchAmount`, `glitchType` |
| Chromatic Aberration | `amount`, `mode`, `transverseOffset/Strength/Transparency`, `axialOrigin/Strength/Falloff/Transition`, `blurAmount/Scale` |
| Glow | `ValkyrieFilterGlow` |
| Blur / Motion Blur / Perspective Blur | per-filter radius/angle/centre |
| Sharpen | strength |
| Opacity | amount |

For inkflo the interesting ones are **Halftone** (screentone, already a Draw tool), **Curves** and
**Color Balance** (colourist work), and **Noise/Glitch** only as Print Look modules. Everything
here is non-destructive in Procreate (a filter sits in the layer stack); inkflo's adjustment
currently bakes into pixels, which is the bigger architectural gap than the missing filters.

## 7. Layers and blending

`observed`: 25 named blend modes in the string table — Normal, Multiply, Screen, Overlay, Soft
Light, Hard Light, Color Dodge, Color Burn, Linear Burn, Add, Subtract, Divide, Difference,
Exclusion, Hue, Saturation, Color, Luminosity, Lighter Color, Darker Color, Vivid Light, Pin Light,
Hard Mix, Luminance, Phoenix — plus Erase / Behind / Mask as layer behaviours and Passthrough for
groups.

Also present: alpha lock (`Layer-Background-Alpha-Lock`), clipping masks, layer masks, reference
layers, layer groups with Passthrough, material/3D layers, and `MergeMode` for merge-down vs
combine-down (two different operations — do not treat them as synonyms).

`inkflo choice`: add **12 modes** (Normal, Multiply, Screen, Overlay, Soft Light, Hard Light, Color
Dodge, Color Burn, Linear Burn, Add, Difference, Luminosity) via a compositing step in the render
path, plus alpha lock and clipping. Canvas 2D `globalCompositeOperation` covers the standard set;
the linear-light modes (Linear Burn, Vivid Light, Pin Light, Hard Mix) need a per-pixel pass or a
shader and are not worth it for print-oriented comic art.

## 8. Under the hood: what is worth copying

| Pattern | Evidence | Why it matters to inkflo |
|---|---|---|
| **Modes with one lifecycle** | every `…Mode` implements `start`/`tick`/`terminateAndCommit` | uniform preview/commit/undo for every tool |
| **Checkpointed undo with coalescing** | `registerUndoState:`, `beginCheckpoint:`, `compressUndos`, `discardableUndos` | live sliders become one undo step; matches inkflo's command stack |
| **Everything animatable** | filters `interpolate:startTime:currentTime:…` | not for inkflo now, but it is why Procreate's adjustments feel live |
| **Snapping as a service** | `ValkyrieSnapper` with angular/Cartesian contexts and velocity threshold | one snapper all tools share (panel borders, guides, selection edges) |
| **Shape detection with error metrics** | `ValkyrieShapeDetection` (12 shapes × `…Error`) | pick the best shape, not the first threshold that passes |
| **Selection as a stored artifact** | `saveMask:`, `loadMaskThumbnail:`, `savedMasks`, `swapToMask:` | saved selections with thumbnails is a real workflow feature |
| **Per-tool floating toolbars** | `Floating*Toolbar` + `Shifting*Toolbar` per adjustment | the options bar is per-tool state, not a global panel |
| **Recording as data** | `StrokeRecording`, `VideoRecorder` | replay/timelapse can come from stored strokes; no video pipeline needed |

## 9. What not to take

- **PBR material set** (metallic/roughness/height maps, triplanar grain) — large surface area, no
  comic use.
- **3D painting, Animation Assist, timelapse video** — different products; inkflo's Motion desk is
  a cue list.
- **Clone puck and liquify chaos/momentum** — invisible to a reader, expensive to build.
- **The brush library's factory content** — brushes are artwork; inkflo ships its own.

## 10. Evidence

| Evidence | Covers |
|---|---|
| `beta/.rea-work/procreate-deep/pc-classes.tsv` | 1,707 classes with superclass and method counts |
| `beta/.rea-work/procreate-deep/pc-methods.tsv` | 19,141 selectors |
| `beta/.rea-work/procreate-deep/pc-strings.tsv` | 2,511 English string pairs |
| `beta/.rea-work/procreate-deep/procreate-544.json` | bundle identity, archive counts, Mach-O facts |
| `pc-summary.json`, `sel-*.txt` | the counts and selector families quoted above |
