# Brush and ink — the Draw desk contract

Target: **Procreate's feel, Clip Studio's inking control.** Not a painting app — a comic app whose
brush engine is good enough that artists do not miss Procreate for line art, and whose inking
tools are as quick as CSP's for panels, fills and closure.

Derived from: the Procreate 5.4.9 package already analysed in `2Dope/beta/.rea-work/` and
`docs/feature-deconstruction/13-clip-studio-fill-ink-layers-phone.md`; Clip Studio Paint 1.5 is
installed for further study (see `REA-QUEUE.md`). Nothing here is copied — these are behaviour
contracts.

---

## 1. What "feels like Procreate" means

1. **No perceptible lag.** Stamp pipeline on a worker where possible; draw from predicted points
   for the current stroke and reconcile on commit.
2. **Pressure does the obvious thing.** Size and opacity follow pressure by default, with one
   curve control, not five.
3. **The brush is a place, not a dialog.** Tap the brush → a studio panel (shape, grain, dynamics,
   taper) — the same shape as 2Dope's brush panel.
4. **Stabilization is invisible until you want it.** Pulled-string streamliner with a 0–100 slider;
   default 25 for ink, 0 for pencil.
5. **QuickShape.** Hold still at the end of a stroke → straight line, arc or ellipse; two-finger
   tap undoes it.

## 2. What "CSP power" means

1. **Ink that closes.** Gap-closing preview while inking; a "closure" check that lists open regions
   before fill.
2. **Fill that respects line art.** Reference-layer fill: fill from the ink layer, regardless of
   the active layer; expand/close gaps in px.
3. **Vector ink option.** A pen that stores strokes as points and can be re-shaped and re-weighted
   after the fact (CSP's vector lines), without leaving the Draw desk.
4. **Taper by speed and pressure**, plus start/end taper lengths — the difference between a
   G-pen and a brush pen.
5. **Tone and screentone** as a first-class fill: angle, frequency, shape, generated procedurally.

---

## 3. Brush settings (the schema)

One object, serialisable, importable/exportable as JSON. UI groups mirror the studio panel.

```ts
interface Brush {
  id: string; name: string; group: "ink" | "pencil" | "paint" | "texture";

  // Shape
  tip: "round" | "flat" | "square" | "texture";  // procedural tips first, images later
  size: number;            // px at 100% zoom, 1–400
  angle: number;           // 0–360, flat/texture tips
  roundness: number;       // 0–1
  hardness: number;        // 0–1 edge falloff

  // Paint
  opacity: number;         // 0–1, per stroke
  flow: number;            // 0–1, per dab
  spacing: number;         // 0.01–2 × size
  blend: "normal" | "multiply" | "screen";

  // Dynamics (each: {control, min, curve, jitter, invert})
  sizeDyn: Dynamic;
  opacityDyn: Dynamic;
  flowDyn: Dynamic;

  // Texture
  grain: { kind: "none" | "paper" | "noise"; scale: number; depth: number };

  // Stroke behaviour
  taper: { start: number; end: number; by: "pressure" | "speed" | "none" };
  stabilize: number;       // 0–100
  smoothing: number;       // 0–1 post-smoothing
  spacingJitter: number;   // scatter
  wetMix: number;          // 0 for ink/pencil

  // Eraser
  eraseMode?: "pixel" | "stroke";
}

type Dynamic = {
  control: "off" | "pressure" | "tilt" | "speed" | "direction";
  min: number; curve: number; jitter: number; invert: boolean;
};
```

Rules: every brush is one JSON object; presets are brushes with fixed ids; user brushes live in
IndexedDB and export as a `.inkflo-brushes.json`.

---

## 4. Presets to ship

| Preset | Kind | Notes |
|---|---|---|
| G-pen | ink | Hard round, pressure size, 0.55 curve, 25 stabilize — the default inker |
| Maru pen | ink | Smaller, harder, no taper — technical lines |
| Mapping pen | ink | Fine detail, high pressure sensitivity |
| Brush pen | ink | Soft edge, speed taper — for thick/thin |
| Dry ink | ink | Grain, low flow, builds up |
| Pencil HB | pencil | Blue-grey, grain, tilt shading |
| Rough pencil | pencil | Loose, wide spacing, jitter |
| Ink wash | paint | Flow build-up, wet mix |
| Flat brush | paint | Flat tip, angle-aware |
| Tone brush | texture | Screentone pattern, hard edge |

---

## 5. The three passes

Pencil and Ink are both line passes and share the engine; Colour is fills.

| Pass | Surface | Exported | Default brush | Colour |
|---|---|---|---|---|
| Pencil | own bitmap | never (unless "show rough" is on) | Pencil HB | `#4E7EA8` at 55% |
| Ink | own bitmap | always | G-pen | `#1B1C22` |
| Colour | flat bitmap | always | — | palette |

Pass switch is a view + edit target, never a mode that hides work. Undo is pass-scoped by default,
with "undo everything" on a modifier.

---

## 6. Inking workflow (the CSP part)

1. **Ink inside the panel** — strokes are clipped by the panel mask, not by a layer mask the user
   has to build.
2. **Closure overlay** (hold `C`): shows open line ends and the regions a fill would leak into.
3. **Fill** — tap a region: flood from the ink layer (reference), gap close 0–20 px, expand 0–4 px.
4. **Vector ink toggle** — pen stores a stroke record; dragging a point re-shapes; width can be
   re-weighted after the fact.
5. **Tone** — fill with a screen: angle 0–180, frequency 30–120 lpi, shape dot/line/cross.
6. **White gel / correction** — the eraser doubles as "white ink" on the ink layer.

---

## 7. Performance envelope

- One stroke = one path; dabs batched per frame.
- Predicted points for display only; commit on pointerup.
- Page bitmaps: park offscreen pages as compressed blobs (2Dope residency), budget 300 MB.
- iPad target: 60 fps with a 3 px G-pen over a 2048×3100 page.

---

## 8. REA questions to close before M2

**Procreate 5.4.9 (package already extracted at `2Dope/beta/.rea-work/procreate-5.4.9/`)**
- The brush studio's parameter set and ranges — which controls exist, in what groups, with what
  defaults for the six built-in inking brushes.
- How pressure curves are stored and edited (single curve vs per-parameter).
- The stabilizer's actual algorithm class (pulled string vs exponential smoothing) and its
  response curve.
- QuickShape's shape-fitting thresholds (angle snap, arc tolerance).

**Clip Studio Paint 1.5 (installed)**
- Sub-tool detail: which brush settings exist (hardness, density, blending, anti-aliasing, paper
  texture, "apply by").
- Stabilizer levels and how they differ from "correction".
- Vector eraser behaviour and how vector strokes are capped/tapered.
- Reference-layer fill, gap closing and "close gap" values.
- How the frame border and fill interact (closure rules for panel edges).

**Rules:** behaviour contracts only; no decompiled code, no shipped brushes, textures or fonts.
Every finding labelled observed / documented / inkflo choice, as in `REA-QUEUE.md`.

---

## 9. Implementation order

1. Stamp engine + presets (G-pen, Pencil HB) + pressure + stabilizer.
2. Taper, grain, dynamics curves.
3. Panel-clipped ink, closure overlay, flood fill with gap closing.
4. Colour flats, palette, tone.
5. Vector ink, QuickShape, brush import/export.
6. Brush studio UI (the panel), presets library, custom sets.
