import type { Studio } from '../app/studio';
import { PT, sheetOf, type Book, type Letter, type Page, type Pt } from '../doc/model';
import { writeZip, type ZipFile } from '../engine/io/zip';
import { derivePanels, panelAt, type Panel } from '../geom/carve';
import { describeTransform } from '../geom/layoutcode';
import { parseLine } from '../geom/lettering';
import { letterBox } from '../render/caption';
import { lettersReady } from '../render/fonts';
import { loadMarks, markKeys } from '../render/marks';
import { renderPage } from '../render/page';
import { encodePng, makeCanvas } from './canvasops';
import type { Progress } from './exports';
import { pagesIn, type PageRange } from './printexport';

/**
 * Game engine package: a ZIP an engine can load without inkflo.
 *
 *   manifest.json            everything below, in pixels, with a format version
 *   pages/001/art.png        the page without lettering (draw your own dialogue UI over it)
 *   pages/001/lettering.png  balloons, captions and type alone, on transparent
 *   pages/001/page.png       the finished page, as printed
 *   pages/001/panel-01.png   each panel cut to its shape, transparent outside
 *   dialogue.yarn / .ink     the script for Yarn Spinner or Ink
 *   README.md                how to load it in Unity and Godot
 *
 * Coordinates: pixels, origin at the page's top-left, y down. `norm` repeats shapes as 0–1
 * fractions of the page, for any texture size.
 */

export const GAME_FORMAT = 'inkflo-game';
export const GAME_VERSION = 1;

export type DialogueFormat = 'yarn' | 'ink' | 'both';
export interface GameOptions { range: PageRange; width: number; dialogue: DialogueFormat }

export interface GameBalloon {
  id: string;
  order: number;
  panel: number | null;
  kind: string;
  speaker: string | null;
  text: string;
  box: { x: number; y: number; width: number; height: number };
  centre: Pt;
  tails: Pt[];
  /** Joined to an earlier balloon (read as one speech). */
  after: string | null;
}

export interface GamePanel {
  number: number;
  polygon: Pt[];
  norm: Pt[];
  box: { x: number; y: number; width: number; height: number };
  centre: Pt;
  moved: { move: Pt; turn: number; scale: number } | null;
  image: string;
  description: string;
  lines: { speaker: string | null; kind: string; text: string }[];
}

export interface GamePage {
  number: number;
  size: { width: number; height: number };
  images: { art: string; lettering: string; page: string };
  panels: GamePanel[];
  balloons: GameBalloon[];
}

export interface GameManifest {
  format: typeof GAME_FORMAT;
  version: number;
  title: string;
  author: string;
  unit: 'px';
  pixelsPerInch: number;
  readingDirection: 'ltr' | 'rtl';
  dialogue: string[];
  pages: GamePage[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const dir = (n: number) => 'pages/' + String(n).padStart(3, '0');

/** Balloon bounds in points (the renderer's measurer in the app; a stand-in in tests). */
export type LetterBoxOf = (l: Letter, page: Page) => { x0: number; y0: number; x1: number; y1: number };

/** Build the manifest. Pure apart from `boxOf`, so tests can run it in Node. */
export function buildManifest(book: Book, pages: Page[], width: number, boxOf: LetterBoxOf, dialogue: string[], rtl = false): GameManifest {
  return {
    format: GAME_FORMAT, version: GAME_VERSION,
    title: book.title, author: book.author, unit: 'px',
    pixelsPerInch: r4(width / (pages[0]?.widthIn ?? 1)),
    readingDirection: rtl ? 'rtl' : 'ltr',
    dialogue,
    pages: pages.map((page) => {
      const n = book.pages.indexOf(page) + 1;
      const k = width / page.widthIn; // px per inch on this page
      const px = (p: Pt) => ({ x: r1(p.x * k), y: r1(p.y * k) });
      const panels = derivePanels(page);
      const d = dir(n);
      return {
        number: n,
        size: { width: Math.round(width), height: Math.round(page.heightIn * k) },
        images: { art: d + '/art.png', lettering: d + '/lettering.png', page: d + '/page.png' },
        panels: panels.map((p): GamePanel => {
          const beat = page.beats[p.index];
          const t = p.transform && p.source ? describeTransform(p.transform, p.source.centroid) : null;
          return {
            number: p.index + 1,
            polygon: p.pts.map(px),
            norm: p.pts.map((q) => ({ x: r4(q.x / page.widthIn), y: r4(q.y / page.heightIn) })),
            box: { x: r1(p.bbox.x0 * k), y: r1(p.bbox.y0 * k), width: r1((p.bbox.x1 - p.bbox.x0) * k), height: r1((p.bbox.y1 - p.bbox.y0) * k) },
            centre: px(p.centroid),
            moved: t ? { move: { x: r1(t.move.x * k), y: r1(t.move.y * k) }, turn: r1(t.turn), scale: r4(t.scale) } : null,
            image: `${d}/panel-${String(p.index + 1).padStart(2, '0')}.png`,
            description: beat?.desc ?? '',
            lines: (beat?.lines ?? []).map((line) => { const l = parseLine(line); return { speaker: l.speaker, kind: l.style, text: l.text }; }),
          };
        }),
        balloons: page.balloons.map((l, order): GameBalloon => {
          const b = boxOf(l, page);
          const s = k / PT; // points → px
          const at = { x: l.cap.x / PT, y: l.cap.y / PT };
          const panel = panelAt(panels, at);
          return {
            id: l.id, order: order + 1, panel: panel ? panel.index + 1 : null,
            kind: l.cap.style, speaker: l.speaker ?? null, text: l.cap.text,
            box: { x: r1(b.x0 * s), y: r1(b.y0 * s), width: r1((b.x1 - b.x0) * s), height: r1((b.y1 - b.y0) * s) },
            centre: { x: r1(l.cap.x * s), y: r1(l.cap.y * s) },
            tails: l.cap.tails.map((t) => ({ x: r1(t.x * s), y: r1(t.y * s) })),
            after: l.continuation?.after ?? null,
          };
        }),
      };
    }),
  };
}

/** Lines to speak, per page and panel: the script, or the lettering when a panel has no script. */
function spoken(page: GamePage): { panel: number; speaker: string | null; kind: string; text: string }[] {
  return page.panels.flatMap((p) => p.lines.length
    ? p.lines.map((l) => ({ panel: p.number, ...l }))
    : page.balloons.filter((b) => b.panel === p.number).map((b) => ({ panel: p.number, speaker: b.speaker, kind: b.kind, text: b.text })));
}

const yarnSafe = (s: string) => s.replace(/[{}<>#\[\]]/g, '').replace(/\n/g, ' ').trim();
const KIND_TAG: Record<string, string> = { box: 'caption', sfx: 'sfx', whisper: 'whisper', shout: 'shout', thought: 'thought' };

/** Yarn Spinner: one node per page; panels as commands, kinds as hashtags. */
export function yarnScript(m: GameManifest): string {
  return m.pages.map((page, i) => {
    let panel = 0;
    const body = spoken(page).flatMap((l) => {
      const out: string[] = [];
      if (l.panel !== panel) { panel = l.panel; out.push(`<<panel ${l.panel}>>`); }
      const who = l.kind === 'box' ? 'Narrator' : l.kind === 'sfx' ? 'SFX' : l.speaker ?? 'Narrator';
      const tag = KIND_TAG[l.kind] ? ` #${KIND_TAG[l.kind]}` : '';
      out.push(`${yarnSafe(who)}: ${yarnSafe(l.text)}${tag} #page${page.number}_panel${l.panel}`);
      return out;
    });
    const next = m.pages[i + 1];
    return [`title: Page${page.number}`, '---', ...body, next ? `<<jump Page${next.number}>>` : '', '==='].filter((x, j, a) => x !== '' || j === a.length - 1).join('\n');
  }).join('\n\n') + '\n';
}

const inkSafe = (s: string) => s.replace(/[{}\[\]|~#*-]/g, (c) => '\\' + c).replace(/\n/g, ' ').trim();

/** Ink: one knot per page; panels and kinds as tags. */
export function inkScript(m: GameManifest): string {
  const first = m.pages[0];
  return [first ? `-> page_${first.number}` : '-> END', '', ...m.pages.map((page, i) => {
    const lines = spoken(page).map((l) => {
      const who = l.kind === 'box' ? '' : l.kind === 'sfx' ? 'SFX: ' : l.speaker ? `${l.speaker}: ` : '';
      const tags = [`panel:${l.panel}`, ...(KIND_TAG[l.kind] ? [KIND_TAG[l.kind]] : [])].map((t) => ` #${t}`).join('');
      return `${inkSafe(who + l.text)}${tags}`;
    });
    const next = m.pages[i + 1];
    return [`=== page_${page.number} ===`, ...lines, next ? `-> page_${next.number}` : '-> END', ''].join('\n');
  })].join('\n');
}

export function gameReadme(m: GameManifest): string {
  return `# ${m.title} — game package

Made with inkflo. Format \`${m.format}\` version ${m.version}.

## Files

- \`manifest.json\`: pages, panels and balloons in **pixels** (origin top-left, y down).
  \`norm\` gives the same shapes as 0–1 fractions of the page.
- \`pages/NNN/art.png\`: the page without lettering. Show dialogue in your own UI over it.
- \`pages/NNN/lettering.png\`: balloons and captions alone, on transparent.
- \`pages/NNN/page.png\`: the finished page.
- \`pages/NNN/panel-NN.png\`: each panel cut to its shape (transparent outside), sized to the panel's \`box\`.
${m.dialogue.map((f) => `- \`${f}\`: the script for ${f.endsWith('.yarn') ? 'Yarn Spinner' : 'Ink'}; tags give the panel and the kind of line.`).join('\n')}

Panels are listed in reading order (${m.readingDirection === 'rtl' ? 'right to left' : 'left to right'}). Use \`panels[i].box\`
or \`centre\` to frame a camera, \`lines\` for the script of each panel, and \`balloons\` to place your
own speech bubbles (\`box\`, \`tails\` point at the speaker).

## Unity (C#)

\`\`\`csharp
// Install com.unity.nuget.newtonsoft-json, put the package in StreamingAssets/comic
var json = File.ReadAllText(Path.Combine(Application.streamingAssetsPath, "comic/manifest.json"));
var comic = JObject.Parse(json);
foreach (var page in comic["pages"])
  foreach (var panel in page["panels"]) {
    var box = panel["box"];            // x, y, width, height in pixels
    var file = (string)panel["image"]; // pages/001/panel-01.png
    // Load the PNG as a Texture2D, make a Sprite, and move a Camera to frame box
  }
\`\`\`

## Godot 4 (GDScript)

\`\`\`gdscript
var comic = JSON.parse_string(FileAccess.get_file_as_string("res://comic/manifest.json"))
for page in comic.pages:
    for panel in page.panels:
        var tex = load("res://comic/" + panel.image)
        var box = panel.box  # x, y, width, height in pixels
        # Show tex in a Sprite2D at Vector2(box.x, box.y), or tween a Camera2D to the panel centre
        for line in panel.lines:
            print(line.speaker, ": ", line.text)
\`\`\`

## Unreal

Import \`manifest.json\` with the JSON Blueprint Utilities plugin (or a DataTable from a
struct matching \`panels\`), load the panel PNGs as textures, and drive a Level Sequence camera
through \`box\` in order.
`;
}

/** Render and package the pages. */
export async function exportGamePackage(studio: Studio, o: GameOptions, progress: Progress): Promise<Blob> {
  const book = studio.book!;
  const pages = pagesIn(book, o.range);
  if (!pages.length) throw new Error('Choose at least one page.');
  const width = Math.round(Math.max(256, Math.min(8192, o.width)));
  const sheet = sheetOf(book);
  await loadMarks(markKeys(book), (k) => studio.store.getAsset(k));
  const files: ZipFile[] = [];
  for (const [i, page] of pages.entries()) {
    const n = book.pages.indexOf(page) + 1;
    progress(`Page ${n} · ${i + 1} of ${pages.length}`);
    await new Promise((r) => setTimeout(r, 0));
    await lettersReady(page.balloons.map((l) => l.cap));
    const k = width / page.widthIn;
    const h = Math.round(page.heightIn * k);
    if (width * h > 40_000_000) throw new Error(`Page ${n} would be ${width} × ${h} px, too large for the browser. Choose a smaller width.`);
    const art = studio.ensureArt(page);
    const d = dir(n);
    const canvas = makeCanvas(width, h);
    const g = canvas.getContext('2d')!;
    try {
      await studio.residency.pin(art);
      const panels = derivePanels(page);
      // finished page
      renderPage(g, page, art, { scale: k, printOnly: true, sheet, panels });
      files.push({ name: d + '/page.png', data: await encodePng(canvas) });
      // art without lettering
      g.clearRect(0, 0, width, h);
      renderPage(g, page, art, { scale: k, printOnly: true, sheet, panels, balloons: false });
      files.push({ name: d + '/art.png', data: await encodePng(canvas) });
      // each panel cut out of the art
      for (const p of panels) files.push({ name: `${d}/panel-${String(p.index + 1).padStart(2, '0')}.png`, data: await encodePng(cropPanel(canvas, p, k)) });
      // lettering alone
      g.clearRect(0, 0, width, h);
      renderPage(g, page, art, { scale: k, sheet, panels, frame: false, types: { pencil: false, ink: false, colour: false, tone: false, reference: false } });
      files.push({ name: d + '/lettering.png', data: await encodePng(canvas) });
    } finally {
      studio.residency.unpin(art);
      canvas.width = canvas.height = 0;
    }
  }
  const dialogue = o.dialogue === 'both' ? ['dialogue.yarn', 'dialogue.ink'] : [`dialogue.${o.dialogue}`];
  const manifest = buildManifest(book, pages, width, (l, page) => letterBox(l, sheet, page.widthIn, page.heightIn), dialogue, book.print?.rtl ?? false);
  const text = new TextEncoder();
  files.push({ name: 'manifest.json', data: text.encode(JSON.stringify(manifest, null, 2)) });
  if (o.dialogue !== 'ink') files.push({ name: 'dialogue.yarn', data: text.encode(yarnScript(manifest)) });
  if (o.dialogue !== 'yarn') files.push({ name: 'dialogue.ink', data: text.encode(inkScript(manifest)) });
  files.push({ name: 'README.md', data: text.encode(gameReadme(manifest)) });
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}

/** The panel's box from the art, transparent outside its shape. */
function cropPanel(art: HTMLCanvasElement, p: Panel, k: number): HTMLCanvasElement {
  const x0 = Math.floor(p.bbox.x0 * k), y0 = Math.floor(p.bbox.y0 * k);
  const w = Math.max(1, Math.ceil(p.bbox.x1 * k) - x0), h = Math.max(1, Math.ceil(p.bbox.y1 * k) - y0);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  g.beginPath();
  p.pts.forEach((q, i) => (i ? g.lineTo(q.x * k - x0, q.y * k - y0) : g.moveTo(q.x * k - x0, q.y * k - y0)));
  g.closePath();
  g.clip();
  g.drawImage(art, -x0, -y0);
  return c;
}
