# Touch and Pencil checklist (real tablet)

`e2e/touch.e2e.mjs` (`npm run e2e`) injects genuine multi-touch into Chromium and checks the results (tap-to-pick,
finger drag, pinch and twist, one-undo). It cannot judge feel, size or the Apple Pencil, so run this list on a
real iPad or Android tablet before a release. Tick each on **Draw**, **Layout** and **Caption** where it applies.

## Transform and Select
- [ ] **Tap picks.** In Select (Q), tap a line, then painted art, then empty space: each behaves; a box appears.
- [ ] **Targets are fingertip-sized.** Corner and side handles and the rotate knob can be grabbed first time; a
      small selection's centre is still draggable (the box grows to 28 px minimum).
- [ ] **Two fingers.** Pinch scales, twist turns, drag moves the selection, and the *view* does not move. Lift:
      one undo reverts the whole gesture. With nothing selected, two fingers still pan and zoom the view.
- [ ] **Pencil.** The Pencil drags the box and handles exactly like a finger; hover shows no stray marks.
- [ ] **Palm.** Resting a palm while using the Pencil does not move the selection or the view.
- [ ] **Long press.** Holding still opens the canvas menu, but not while dragging a handle.
- [ ] **Arrange menu.** Opens by tap; X / Y / W / H / Angle accept typing with the on-screen keyboard; the
      keyboard does not cover the field.
- [ ] **Distort and Warp.** Corners and grid nodes are easy to grab; the preview stays smooth on a large page.

## Big art
- [ ] **600 dpi, full page.** *Whole layer* then drag: the preview follows without stalling; it sharpens on release.

## Layout and Caption
- [ ] **Layout Select.** Tap a panel selects it; dragging a gutter resizes; the panel box handles are reachable
      next to a gutter.
- [ ] **Balloons.** Pinch resizes (to readable sizes), twist turns, and tails stay on their speakers.

## Page
- [ ] **No page zoom.** Pinching outside the canvas, or double-tapping, does not zoom the browser page.
- [ ] **Safe areas.** Controls clear the notch and home bar.
