/**
 * inkflo's own line icons: 24 × 24, 1.8 px round strokes in currentColor. Drawn for this app
 * (clean-room: nothing traced from another product). Controls keep their text label as the
 * accessible name; the icon is decoration, and the tooltip shows the name on hover.
 */

const P = (d: string) => `<path d="${d}"/>`;
const C = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const R = (x: number, y: number, w: number, h: number, rx = 1.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
const DOT = (cx: number, cy: number, r = 1.2) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS = {
  // chrome
  back: P('M15 5l-7 7 7 7'),
  prev: P('M14 6l-6 6 6 6'),
  next: P('M10 6l6 6-6 6'),
  undo: P('M9 7L4 12l5 5') + P('M4 12h10.5a4.5 4.5 0 0 1 0 9H12'),
  redo: P('M15 7l5 5-5 5') + P('M20 12H9.5a4.5 4.5 0 0 0 0 9H12'),
  spread: R(3, 5, 8, 14, 1) + R(13, 5, 8, 14, 1),
  theme: C(12, 12, 8) + P('M12 4a8 8 0 0 1 0 16z').replace('<path', '<path fill="currentColor"'),
  focus: P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  simple: R(4, 5, 16, 14, 2) + P('M8 15h8'),
  done: C(12, 12, 8.5) + P('M8 12.5l2.7 2.7L16 9.8'),
  export: P('M12 15V4M7.5 8.5L12 4l4.5 4.5') + P('M5 13v6h14v-6'),
  exportDrawing: R(4, 5, 10, 14, 1) + P('M14 12h7M18 9l3 3-3 3'),
  more: DOT(6, 12) + DOT(12, 12) + DOT(18, 12),
  pin: P('M9 4h6l-1 6 3 3H7l3-3zM12 13v7'),
  customize: P('M5 7h9M18 7h1M5 17h3M12 17h7') + C(16, 7, 2) + C(10, 17, 2),
  fit: R(6, 6, 12, 12, 1) + P('M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5'),
  inspector: R(4, 4, 16, 16, 2) + P('M14 4v16M16.5 8h1.5M16.5 11h1.5'),
  display: C(12, 12, 3.2) + P('M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8'),
  zoomIn: C(10.5, 10.5, 6.5) + P('M15.5 15.5L20 20M10.5 8v5M8 10.5h5'),
  zoomOut: C(10.5, 10.5, 6.5) + P('M15.5 15.5L20 20M8 10.5h5'),
  rotate: P('M19 12a7 7 0 1 1-2.05-4.95') + P('M19 4v4h-4'),
  flip: P('M12 3v18') + P('M9 7L4 17h5zM15 7l5 10h-5z'),
  copy: R(8, 8, 11, 11) + P('M16 8V6a1.5 1.5 0 0 0-1.5-1.5h-8A1.5 1.5 0 0 0 5 6v8.5A1.5 1.5 0 0 0 6.5 16H8'),
  trash: P('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5M13.5 10.5v5'),
  eye: P('M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z') + C(12, 12, 2.6),
  layers: P('M12 4l8.5 4.5L12 13 3.5 8.5z') + P('M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5'),
  assets: R(3.5, 5, 17, 14, 2) + C(9, 10, 1.8) + P('M4 17l5-4.5 4 3.5 3-2.5 4.5 3.5'),
  actions: C(12, 12, 8) + P('M8 12h8M12 8v8'),
  eyedropper: P('M14.5 4.5l5 5M17 7l-9.5 9.5L5 19l2.5-2.5') + P('M13 9l2 2'),
  pressure: P('M3 18c4 0 5-10 9-10s4 6 9 6'),
  stroke: P('M4 17c3-6 6-6 8-3s5 3 8-3'),
  rulers: P('M4 16L16 4l4 4L8 20z') + P('M8 12l2 2M11 9l1.5 1.5M14 6l2 2'),
  palette: P('M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2.5-1.5H18a3 3 0 0 0 3-3c0-5-4-9-9-9z') + DOT(7.5, 11) + DOT(10, 7.5) + DOT(14.5, 7.5),
  // desks
  script: P('M6 3.5h9l3.5 3.5v13.5H6z') + P('M9 10h6M9 13.5h6M9 17h4'),
  layout: R(3.5, 3.5, 17, 17, 1.5) + P('M12 3.5v9M3.5 12.5h17M9 12.5v8'),
  draw: P('M4 20l1-4L15.5 5.5a2 2 0 0 1 3 3L8 19z') + P('M13.5 7.5l3 3'),
  caption: P('M12 4.5c4.7 0 8.5 2.9 8.5 6.5s-3.8 6.5-8.5 6.5c-.9 0-1.8-.1-2.6-.3L5 19.5l1.4-3.6C4.6 14.6 3.5 12.9 3.5 11c0-3.6 3.8-6.5 8.5-6.5z'),
  print: P('M7 9V3.5h10V9') + R(3.5, 9, 17, 8, 2) + P('M7 14h10v6.5H7z'),
  // cutting: what the knife does, and the shape the cut settles into
  cutAcross: R(3.5, 4, 17, 16, 1) + P('M12 3.5v17').replace('<path', '<path stroke-dasharray="3 2.5"') + P('M2 16.5l20-7'),
  cutPanel: R(3.5, 4, 17, 16, 1) + P('M12 3.5v17').replace('<path', '<path stroke-dasharray="3 2.5"') + P('M3.5 15l8.5-3') + DOT(12, 12, 1.3),
  cutStraight: P('M4.5 19L19.5 5') + DOT(4.5, 19, 1.6) + DOT(19.5, 5, 1.6),
  cutArc: P('M4.5 18A12 12 0 0 1 19.5 7') + DOT(4.5, 18, 1.6) + DOT(19.5, 7, 1.6),
  cutZigzag: P('M4 18l4.5-9 4 7 4-10 3.5 6') + DOT(4, 18, 1.3) + DOT(20, 12, 1.3),
  cutSmooth: P('M4 17C8 4 13 20 20 7') + DOT(4, 17, 1.3) + DOT(20, 7, 1.3),
  readingOrder: R(3.5, 3.5, 7, 7, 1) + R(13.5, 3.5, 7, 7, 1) + R(3.5, 13.5, 17, 7, 1) + P('M10.5 7h3') + P('M17 10.5v3'),
  layoutCode: P('M8.5 8L4.5 12l4 4M15.5 8l4 4-4 4M13.3 6.5L10.7 17.5'),
  // erasing vector lines: what part of the line goes
  eraseTouched: P('M3 12h5.5M15.5 12h5.5') + C(12, 12, 2.4),
  eraseCrossings: P('M8 5v14M16 5v14M3 12h5M16 12h5') + P('M10.5 12h3').replace('<path', '<path stroke-dasharray="1.5 2"'),
  eraseWhole: P('M3.5 15C8 5 14 17 20.5 7').replace('<path', '<path stroke-dasharray="2 2.6"') + P('M15.5 15.5l4.5 4.5M20 15.5L15.5 20'),
  // transform box
  scaleFreeform: R(8, 8, 8, 8, 0.5) + P('M3.5 12H7M20.5 12H17M12 3.5V7M12 20.5V17M5.3 10.3L3.5 12l1.8 1.7M18.7 10.3l1.8 1.7-1.8 1.7M10.3 5.3L12 3.5l1.7 1.8M10.3 18.7l1.7 1.8 1.7-1.8'),
  scaleUniform: R(8.5, 8.5, 7, 7, 0.5) + P('M4 4l3.5 3.5M20 20l-3.5-3.5M20 4l-3.5 3.5M4 20l3.5-3.5M4 7.5V4h3.5M20 16.5V20h-3.5M16.5 4H20v3.5M7.5 20H4v-3.5'),
  scaleDistort: P('M5 6.5L19 4v16L5 17.5z') + DOT(5, 6.5, 1.6) + DOT(19, 4, 1.6) + DOT(19, 20, 1.6) + DOT(5, 17.5, 1.6),
  scaleWarp: P('M3.5 8c3-3 5 3 8.5 0s5.500-3 8.500 0M3.500 12c3-3 5 3 8.500 0s5.500-3 8.500 0M3.500 16c3-3 5 3 8.500 0s5.500-3 8.500 0'),
  snap: P('M3.5 7.5h17').replace('<path', '<path stroke-dasharray="3 2.5"') + P('M7.5 3.5v17').replace('<path', '<path stroke-dasharray="3 2.5"') + R(10.5, 10.5, 6, 6, 0.5),
  pivot: DOT(12, 12, 2) + P('M19 12a7 7 0 1 1-2.05-4.95') + P('M19 4v4h-4'),
  flipV: P('M3 12h18') + P('M7 9L17 4v5zM7 15l10 5v-5z'),
  resetBox: P('M5 12a7 7 0 1 0 2.05-4.95') + P('M5 4v4h4'),
  // text alignment
  alignLeft: P('M4 6h16M4 10h10M4 14h16M4 18h10'),
  alignCenter: P('M4 6h16M7 10h10M4 14h16M7 18h10'),
  alignRight: P('M4 6h16M10 10h10M4 14h16M10 18h10'),
  alignJustify: P('M4 6h16M4 10h16M4 14h16M4 18h16'),
  alignTop: P('M4 4.5h16') + R(7, 8, 4, 11, 0.8) + R(13, 8, 4, 7, 0.8),
  alignMiddle: P('M4 12h16') + R(7, 6, 4, 12, 0.8) + R(13, 8, 4, 8, 0.8),
  alignBottom: P('M4 19.5h16') + R(7, 5, 4, 11, 0.8) + R(13, 9, 4, 7, 0.8),
  // guides and rulers
  radial: C(12, 12, 2) + P('M12 3v4.5M12 16.5V21M3 12h4.5M16.5 12H21M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M5.6 18.4l3.2-3.2M15.2 8.8l3.2-3.2'),
  rulerParallel: P('M4 17L12 4M9 20l8-13M14 22l7-10'),
  rulerPerspective: P('M12 4L4 20M12 4l8 16M12 4v16M6.5 14h11') + DOT(12, 4, 1.4),
  // display
  sun: C(12, 12, 4) + P('M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4'),
  moon: P('M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z'),
  system: R(3.5, 5, 17, 11, 1.5) + P('M9 20h6M12 16v4'),
  gridLines: R(3.5, 3.5, 17, 17, 1.5) + P('M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17'),
  plain: R(3.5, 3.5, 17, 17, 1.5),
  // pages and files
  save: P('M5 4.5h11l3.5 3.5v11.5H5z') + P('M8 4.5v5h7M8 19.5v-5h8v5'),
  newPage: P('M6 3.5h8l4 4v13H6z') + P('M14 3.5v4h4M12 11v6M9 14h6'),
  movePage: R(7, 6, 10, 13, 1) + P('M3 12h2.5M3 12l1.5-1.5M3 12l1.5 1.5M21 12h-2.5M21 12l-1.5-1.5M21 12l-1.5 1.5'),
  merge: P('M6 4c0 6 6 5 6 10v6M18 4c0 6-6 5-6 10') + P('M9.5 17L12 20l2.5-3'),
  backup: P('M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18z') + P('M12 17v-5M9.8 14l2.2-2.2 2.2 2.2'),
  actualSize: R(3.5, 6, 17, 12, 1.5) + P('M8.5 10v4M7.5 11l1-1M15.5 10v4M14.5 11l1-1') + DOT(12, 11.2, 0.8) + DOT(12, 13.2, 0.8),
  liquify: P('M12 3.5c3.5 4.2 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-5.8 6-10z') + P('M9.5 14a2.5 2.5 0 0 0 2.5 2.5'),
  liquifyPush: P('M3.5 12h9M9.5 8l4 4-4 4') + C(18, 12, 2.6),
  liquifyTwirl: P('M19 12a7 7 0 0 0-7-7M5 12a7 7 0 0 0 7 7') + P('M12 2.5l2.5 2.5-2.5 2.5M12 21.5L9.5 19l2.5-2.5'),
  liquifyPinch: P('M3.5 12h5M20.5 12h-5M12 3.5v5M12 20.5v-5') + P('M6.500 9.500L8.500 12l-2 2.500M17.500 9.500L15.500 12l2 2.500'),
  liquifyBloat: C(12, 12, 3) + P('M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3') + P('M9.5 5.500L12 3.500l2.500 2M9.500 18.500l2.500 2 2.500-2'),
  // draw tools
  brush: P('M20.5 3.5l-8 8') + P('M11 9.5l3.5 3.5') + P('M11 9.5c-3 .5-5.5 2.5-6.5 6l-1 4.5 4.5-1c3.5-1 5.5-3.5 6-6.5'),
  smudge: P('M4 15c2.5-3 4.5-3 6.5 0s4 3 6.5 0') + P('M7 9c2.5-3 4.5-3 6.5 0s4 3 6.5 0'),
  eraser: P('M9 19l-4.5-4.5L14 5l6 6-8 8z') + P('M9.5 9.5l6 6M9 19h11'),
  pencil: P('M4 20l1.2-4.2L16 5l3 3L8.2 18.8z') + P('M14 7l3 3M5.2 15.8l3 3'),
  // erasers: one small eraser block, marked with what it takes away
  eraseInk: P('M7 14.5L3.5 11 11 3.5l3.5 3.5z') + P('M7.25 7.25l3.5 3.5') + P('M17.5 12.5c-2 2.6-3 4.1-3 5.4a3 3 0 0 0 6 0c0-1.3-1-2.8-3-5.4z').replace('<path', '<path fill="currentColor"'),
  erasePencil: P('M7 14.5L3.5 11 11 3.5l3.5 3.5z') + P('M7.25 7.25l3.5 3.5') + P('M13 21l.8-2.8 5.4-5.4 2 2-5.4 5.4z') + P('M17.6 14.4l2 2'),
  eraseVector: P('M7 14.5L3.5 11 11 3.5l3.5 3.5z') + P('M7.25 7.25l3.5 3.5') + P('M13.5 20.5c1.5-5 4-6.5 7-6') + R(12.3, 19.3, 2.4, 2.4, 0.4) + R(19.8, 13.3, 2.4, 2.4, 0.4),
  eraseTone: P('M7 14.5L3.5 11 11 3.5l3.5 3.5z') + P('M7.25 7.25l3.5 3.5') + DOT(14.5, 15) + DOT(18, 15) + DOT(21, 15) + DOT(14.5, 18.5) + DOT(18, 18.5) + DOT(21, 18.5) + DOT(16.2, 21.5, 1) + DOT(19.5, 21.5, 1),
  // tone: brush laying dots that thin out behind it
  paintTone: P('M21 3l-7.5 7.5') + P('M12 9l3 3') + P('M12 9c-2.6.4-4.4 2-5 4.5l-.8 3.3 3.3-.8c2.5-.6 4.1-2.4 4.5-5') + DOT(4, 7, 1.4) + DOT(7.5, 4, 1.2) + DOT(3.5, 11.5, 1.1) + DOT(10.5, 3, 0.9) + DOT(3.2, 15.5, 0.8),
  // colour gradient: a swatch that darkens across (lines closing up)
  gradient: R(3.5, 5, 17, 14, 2) + P('M8 5v14M11.5 5v14M14 5v14M16 5v14M17.6 5v14M19 5v14'),
  clone: C(9, 9, 4.5) + C(15, 15, 4.5) + DOT(15, 15),
  vpen: P('M12 3l5 8-5 10-5-10z') + C(12, 11, 1.6) + P('M12 3v6.4'),
  vedit: P('M4 18C8 18 8 6 12 6s4 12 8 12') + R(10.3, 4.3, 3.4, 3.4, 0.5),
  nodes: P('M4 17L10 7l5 9 5-8') + R(8.5, 5.5, 3, 3, 0.5) + R(13.5, 14.5, 3, 3, 0.5),
  moveLine: P('M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5'),
  thicken: P('M4 12h16').replace('<path', '<path stroke-width="5"'),
  thin: P('M4 12h16').replace('<path', '<path stroke-width="1"'),
  comicLines: C(12, 12, 2.5) + P('M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8'),
  speedLines: P('M4 7h12M7 12h13M4 17h10'),
  fill: P('M5 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 13.8A2 2 0 0 1 5 11z') + P('M5 12.5h12.5') + P('M19.5 15s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z'),
  dragFill: P('M4 16c3-6 5-6 8-2s5 4 8-2') + P('M4 20h16'),
  enclose: P('M7 6c5-3 12 0 12 6s-6 8-10 7-6-4-5-7').replace('<path', '<path stroke-dasharray="3 2.5"') + DOT(12, 12, 2),
  leftovers: DOT(7, 8) + DOT(12, 6) + DOT(16, 10) + DOT(9, 14) + DOT(15, 16) + DOT(6, 18) + DOT(18, 19),
  flats: R(3.5, 3.5, 17, 17, 1.5) + P('M3.5 11h9v9.5M12.5 11V3.5'),
  // tone modes: a whole panel, a drawn selection, a bucket that finds the lines
  tonePanel: R(3.5, 4.5, 17, 15, 1.5) + DOT(8, 9.5) + DOT(12, 9.5) + DOT(16, 9.5) + DOT(8, 14.5) + DOT(12, 14.5) + DOT(16, 14.5),
  toneLasso: P('M12 4.5c4.7 0 8 2.2 8 5s-3.3 5-8 5c-.9 0-1.7-.1-2.5-.3') + P('M12 4.5c-4.7 0-8 2.2-8 5 0 1.8 1.3 3.3 3.4 4.2') + P('M9.5 14.2c-.8 1.8-.3 3.6 1.2 5.3') + DOT(14, 8.5, 1) + DOT(10, 8.5, 1) + DOT(12, 11.2, 1),
  toneBucket: P('M5 11l6.5-6.5 7 7-6.5 6.5z') + P('M8 8l7 7') + P('M19.5 14.5c-1.2 1.6-1.8 2.5-1.8 3.3a1.8 1.8 0 0 0 3.6 0c0-.8-.6-1.7-1.8-3.3z').replace('<path', '<path fill="currentColor"') + DOT(8.5, 19, 1) + DOT(12, 19.5, 1) + DOT(15.5, 19, 1),
  toneFill: P('M5 15l3.5-9h7L19 15c0 3-3 5-7 5s-7-2-7-5z') + P('M8 13c1.3 1 2.7 1 4 0s2.7-1 4 0'),
  toneClip: R(3.5, 3.5, 11, 11, 2) + P('M9.5 20.5h8a3 3 0 0 0 3-3v-8') + DOT(7, 7, 1) + DOT(11, 7, 1) + DOT(7, 11, 1) + DOT(11, 11, 1),
  toneFlat: R(3.5, 3.5, 17, 17, 2) + DOT(8, 8) + DOT(12, 8) + DOT(16, 8) + DOT(8, 12) + DOT(12, 12) + DOT(16, 12) + DOT(8, 16) + DOT(12, 16) + DOT(16, 16),
  toneGradient: R(3.5, 3.5, 17, 17, 2) + DOT(7, 7, 1.7) + DOT(12, 7, 1.3) + DOT(17, 7, 0.9) + DOT(7, 12, 1.4) + DOT(12, 12, 1) + DOT(17, 12, 0.6) + DOT(7, 17, 1) + DOT(12, 17, 0.7) + DOT(17, 17, 0.35),
  screentone: R(3.5, 3.5, 17, 17, 2) + DOT(8, 8) + DOT(12, 8) + DOT(16, 8) + DOT(8, 12) + DOT(12, 12) + DOT(16, 12) + DOT(8, 16) + DOT(12, 16) + DOT(16, 16),
  select: R(4, 4, 16, 16, 1).replace('<rect', '<rect stroke-dasharray="3 2.5"'),
  transform: R(5, 5, 14, 14, 0.5) + R(3, 3, 4, 4, 0.5) + R(17, 3, 4, 4, 0.5) + R(3, 17, 4, 4, 0.5) + R(17, 17, 4, 4, 0.5),
  image: R(3.5, 4.5, 17, 15, 2) + C(9, 10, 1.8) + P('M4 17l5.5-5 4 3.5 2.5-2 4.5 4'),
  adjust: P('M6 4v5M6 13v7M12 4v9M12 17v3M18 4v3M18 11v9') + C(6, 11, 2) + C(12, 15, 2) + C(18, 9, 2),
  // marquee shapes
  rectangle: R(4, 6, 16, 12, 1).replace('<rect', '<rect stroke-dasharray="3 2.5"'),
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="3 2.5"/>',
  freehand: P('M6 7c4-3 13-2 13 4s-7 9-11 7-5-7-2-11z').replace('<path', '<path stroke-dasharray="3 2.5"'),
  polygon: P('M5 9l7-5 7 5-3 10H8z').replace('<path', '<path stroke-dasharray="3 2.5"'),
  magnetic: P('M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z') + P('M6 8h4M14 8h4'),
  // layout
  knife: P('M4 20L17 7l3 3L7 20z') + P('M17 7l2.5-3.5L22 6l-2 4'),
  uncut: R(3.5, 4, 17, 16, 1) + P('M9 9l6 6M15 9l-6 6'),
  resizeGutters: P('M12 4v16M8 9l-3 3 3 3M16 9l3 3-3 3M5 12h4M15 12h4'),
  panelTransform: R(7, 7, 10, 10, 1).replace('<rect', '<rect transform="rotate(12 12 12)"') + P('M4 8a9 9 0 0 1 5-4M20 16a9 9 0 0 1-5 4'),
  curve: P('M4 18C4 9 9 5 20 5') + DOT(4, 18) + DOT(20, 5),
  templates: R(3.5, 3.5, 7.5, 7.5, 1) + R(13, 3.5, 7.5, 7.5, 1) + R(3.5, 13, 7.5, 7.5, 1) + R(13, 13, 7.5, 7.5, 1),
  evenOut: P('M4 5v14M20 5v14M12 5v14M7 12h2M15 12h2'),
  // caption
  pointer: P('M6 4l12 7-5.5 1.5L10 18z'),
  speech: P('M12 4.5c4.7 0 8.5 2.9 8.5 6.5s-3.8 6.5-8.5 6.5c-.9 0-1.8-.1-2.6-.3L5 19.5l1.4-3.6C4.6 14.6 3.5 12.9 3.5 11c0-3.6 3.8-6.5 8.5-6.5z'),
  thought: P('M8 15c-2.5 0-4.5-1.6-4.5-3.8 0-1.8 1.5-3.3 3.5-3.7.6-2 2.7-3.5 5-3.5 2.2 0 4.1 1.3 4.8 3.2 2.1.3 3.7 1.9 3.7 3.8 0 2.2-2 4-4.5 4z') + C(7, 18.5, 1.3) + C(4.8, 20.8, 0.8),
  shout: P('M12 3l2 4.5 4.5-2-1.5 4.5 4.5 1.5-4 2.5 2 4.5-4.5-1-1.5 4.5-2-4-3 3.5-.5-4.5-4.5.5 3-3.5-3.5-3 4.5-.5-1-4.5 4 2z'),
  whisper: P('M12 4.5c4.7 0 8.5 2.9 8.5 6.5s-3.8 6.5-8.5 6.5c-.9 0-1.8-.1-2.6-.3L5 19.5l1.4-3.6C4.6 14.6 3.5 12.9 3.5 11c0-3.6 3.8-6.5 8.5-6.5z').replace('<path', '<path stroke-dasharray="2.5 2.2"'),
  captionBox: R(3.5, 6.5, 17, 11, 0.5) + P('M7 10.5h10M7 13.5h7'),
  sfx: P('M5 17l3-10 2.5 6 2-4 2 5L18 5') + P('M4 20h16'),
  drawBalloon: P('M12 4.5c4.7 0 8.5 2.9 8.5 6.5s-3.8 6.5-8.5 6.5L5 19.5l1.4-3.6C4.6 14.6 3.5 12.9 3.5 11').replace('<path', '<path stroke-dasharray="3 2.5"') + P('M15.5 3.5l2 2'),
  dialogue: P('M4 6.5h11v8H9l-3.5 3v-3H4z') + P('M15 9.5h5v7h-1.5v2.5l-3-2.5H11v-2'),
  styleSheet: P('M4 19l5-14h1l5 14M6 14h7') + P('M16.5 13.5c0-1.4 1.1-2.5 2.5-2.5h1v8h-1a2.5 2.5 0 0 1-2.5-2.5z'),
  review: P('M5 4.5h10l4 4V19.5H5z') + P('M8.5 13l2.5 2.5L16 10.5'),
  place: P('M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z') + C(12, 10, 2.3),
  checks: P('M4 7l2 2 3.5-3.5M4 15l2 2 3.5-3.5M12 8h8M12 16h8'),
  mark: P('M4 17c2-1 3-5 5-5s1 4 3 4 2-6 4-6 2 3 4 3') + P('M4 20h16'),
  typeFrame: R(4, 4, 16, 16, 1) + P('M8 8h8M12 8v9M10 17h4'),
  manual: P('M4 5.5c2.5-1 5.5-1 8 .5 2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z') + P('M12 6v13.5'),
} as const;

export type IconName = keyof typeof ICONS;

/** An inline icon element; decorative, so screen readers skip it. */
export function icon(name: IconName, size = 18): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

/**
 * The icon for a control's label, so tool, variant and action definitions stay as they are.
 * Labels are the visible names used across the desks.
 */
export const ICON_BY_LABEL: Record<string, IconName> = {
  // chrome
  'Back to book': 'back', 'Back to library': 'back', 'Previous page': 'prev', 'Next page': 'next',
  Undo: 'undo', Redo: 'redo', 'Spread preview': 'spread', Spread: 'spread', 'Display settings': 'theme',
  'Focus layout': 'focus', 'Studio layout': 'inspector', 'Simple / Studio': 'simple', 'Simple / Focus': 'simple',
  'Mark done': 'done', 'Done ✓': 'done', 'Mark page done': 'done', Export: 'export', 'Export ▾': 'export',
  'Export files…': 'export', 'Export for drawing': 'exportDrawing', 'Export for drawing…': 'exportDrawing',
  'More document actions': 'more', 'Pin interface': 'pin', 'Customize tools': 'customize', 'Fit page': 'fit',
  Inspector: 'inspector', 'Show inspector': 'inspector', 'Hide inspector': 'inspector',
  Actions: 'actions', 'Actions ▾': 'actions', Layers: 'layers', Assets: 'assets', Eyedropper: 'eyedropper',
  'Pressure ▾': 'pressure', 'G-pen pressure': 'pressure', 'Stroke ▾': 'stroke', 'Rulers ▾': 'rulers',
  Adjustments: 'adjust', 'Place image': 'image', 'Edit brush': 'brush',
  // desks
  Script: 'script', Layout: 'layout', Draw: 'draw', Caption: 'caption', Print: 'print',
  // draw tools and variants
  Liquify: 'liquify', Push: 'liquifyPush', Twirl: 'liquifyTwirl', Pinch: 'liquifyPinch', Bloat: 'liquifyBloat',
  Brush: 'brush', Smudge: 'smudge', Eraser: 'eraser', 'Erase ink': 'eraseInk', 'Erase pencil': 'erasePencil',
  'Erase vector lines': 'eraseVector', 'Erase painted tone': 'eraseTone', 'Paint tone': 'paintTone', Gradient: 'gradient', Pencil: 'pencil', Clone: 'clone', 'Vector pen': 'vpen', 'Edit lines': 'vedit',
  'Pull and select': 'vedit', 'Edit points': 'nodes', 'Move line': 'moveLine', Thicken: 'thicken', Thin: 'thin',
  'Comic lines': 'comicLines', 'Focus lines': 'comicLines', 'Speed lines': 'speedLines', Colour: 'fill',
  Bucket: 'fill', 'Drag fill': 'dragFill', 'Enclose and fill': 'enclose', 'Fill leftovers': 'leftovers',
  'Auto flats': 'flats', Screentone: 'screentone', 'Select lines': 'select', Transform: 'transform',
  'Position image': 'image', Rectangle: 'rectangle', Ellipse: 'ellipse', Freehand: 'freehand', Polygon: 'polygon',
  Magnetic: 'magnetic', 'Touched part': 'eraseTouched', 'To crossings': 'eraseCrossings', 'Whole line': 'eraseWhole',
  'Whole layer': 'layers', Snapping: 'snap', Pivot: 'pivot', 'Flip horizontal': 'flip', 'Flip vertical': 'flipV', 'Rotate 45°': 'rotate',
  'Fit to page': 'fit', Arrange: 'moveLine', 'Keep original': 'copy', Duplicate: 'copy',
  // layout
  'Smooth cuts': 'cutSmooth', Knife: 'knife', 'Across page': 'cutAcross', 'One panel': 'cutPanel', 'All panels': 'templates', 'Reading order': 'readingOrder', Uncut: 'uncut', 'Resize gutters': 'resizeGutters',
  'Straight line': 'cutStraight', Arc: 'cutArc', 'Zig-zag': 'cutZigzag', 'Smooth curve': 'cutSmooth',
  'Layout as code': 'layoutCode', 'Edit layout code': 'layoutCode',
  'Transform panel': 'panelTransform', 'Curve edges': 'curve', 'Page templates': 'templates', 'Even out': 'evenOut',
  // caption
  Select: 'pointer', Letter: 'speech', 'Speech balloon': 'speech', Thought: 'thought', Shout: 'shout',
  Whisper: 'whisper', 'Caption box': 'captionBox', 'Sound effect': 'sfx', 'Draw balloon': 'drawBalloon',
  'Script dialogue': 'dialogue', 'Dialogue & panels': 'dialogue', 'Style sheet': 'styleSheet', 'Style sheet…': 'styleSheet',
  'Review script changes': 'review', 'Place from script': 'place', 'Page checks': 'checks',
  'Linear': 'gradient', Radial: 'radial', Parallel: 'rulerParallel', Perspective: 'rulerPerspective', Straight: 'rulers',
  Drag: 'dragFill', Enclose: 'enclose', Leftovers: 'leftovers', Flats: 'flats', Lasso: 'freehand', Selection: 'select',
  'Inside lines': 'fill', 'Same colour': 'eyedropper',
  Delete: 'trash', 'Delete page': 'trash', Save: 'save', 'New page': 'newPage', 'Move page': 'movePage', Merge: 'merge',
  Backup: 'backup', 'Export files': 'export', 'Actual size': 'actualSize', 'Edit book details': 'customize',
  'Add book assets': 'assets', 'Place as reference': 'image', 'Share & read': 'export', 'Print it': 'print', 'Reset all': 'resetBox',
  // canvas menu
  'Pick colour here': 'eyedropper', 'Reset rotation': 'rotate', 'Show pencil': 'pencil', 'Delete balloon': 'trash',
  'Add tail': 'speech', 'Joined balloon': 'speech', 'Export…': 'export', Manual: 'manual', 'Open the manual': 'manual', Type: 'typeFrame', 'Type frame here': 'typeFrame', 'Artist mark': 'mark', 'Place Artist mark here': 'mark', 'Place Artist mark': 'mark',
  Copy: 'copy', 'Paste here': 'copy',
};

/** The icon for a label, ignoring a trailing menu caret or ellipsis. */
export function iconFor(label: string | null | undefined): IconName | null {
  if (!label) return null;
  const clean = label.replace(/\s*[▾…]$/, '').replace(/:.*$/, '').replace(/ here$/, '').trim();
  return ICON_BY_LABEL[label] ?? ICON_BY_LABEL[clean] ?? null;
}

/** Icon if one exists for the label, else the old text glyph. */
export function glyphEl(label: string, glyph: string, size = 18): Element {
  const name = iconFor(label);
  if (name) return icon(name, size);
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = glyph;
  return span;
}
