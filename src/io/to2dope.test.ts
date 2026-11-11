import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTION_SCHEMA, DEFAULT_MOTION, frameSize, motionProject, pageTiming, twoDopeCaption, type MotionPage } from './to2dope';

/** 2Dope's own validator, from the sibling checkout (the test is skipped without it). */
const TWO_DOPE_SCHEMA = resolve(__dirname, '../../../../2Dope/beta/src/io/schema.ts');
const hasTwoDope = existsSync(TWO_DOPE_SCHEMA);

const W = 994;
const H = 1528;
// asset names as the browser export writes them (content hash keys)
const art = (n: number) => ({ line: `assets/27p034p0iah122g6d81yo${n}-y8b.png`, fill: `assets/1n5a87jfo2n11i7kz8hjcr${n}-uix.png` });

function pages(): MotionPage[] {
  return [
    {
      title: 'Page 1',
      paper: { line: null, fill: 'assets/paper.png' },
      panels: [
        { index: 0, bbox: { x0: 0, y0: 0, x1: W, y1: H / 2 }, art: art(1), beat: { desc: 'Rooftop, night.', lines: ['MAYA: Too late.'] } },
        { index: 1, bbox: { x0: 0, y0: H / 2, x1: W / 2, y1: H }, art: art(2) },
        { index: 2, bbox: { x0: W / 2, y0: H / 2, x1: W, y1: H }, art: art(3) },
      ],
      balloons: [
        { name: 'Maya: Too late.', panelIndex: 0, art: { line: 'assets/b1.png', fill: null }, text: 'Too late.' },
        { name: 'CAPTION: Midnight, Harbor Distric…', panelIndex: 0, art: { line: 'assets/b3.png', fill: null }, text: 'Midnight, Harbor District.' },
      ],
    },
    { title: 'Page 2 (splash)', paper: { line: null, fill: 'assets/paper.png' }, panels: [{ index: 0, bbox: { x0: 0, y0: 0, x1: W, y1: H }, art: art(4) }], balloons: [] },
    {
      title: 'Page 3',
      paper: { line: null, fill: 'assets/paper.png' },
      panels: [
        { index: 0, bbox: { x0: 0, y0: 0, x1: W, y1: H / 2 }, art: art(5) },
        { index: 1, bbox: { x0: 0, y0: H / 2, x1: W, y1: H }, art: art(6) },
      ],
      balloons: [{ name: 'SFX', panelIndex: 1, art: { line: 'assets/b2.png', fill: null }, text: 'KRAK' }],
    },
  ];
}

describe('motion comic → 2Dope', () => {
  const project = motionProject('Night Shift', pages(), { width: W, height: H });

  it('has one comp per page and a main comp that plays them in order', () => {
    expect(Object.keys(project.comps).sort()).toEqual(['main', 'page1', 'page2', 'page3']);
    const main = project.comps.main!;
    const pageLayers = main.layers.filter((l) => l.kind === 'comp');
    expect(pageLayers.map((l) => l.comp).sort()).toEqual(['page1', 'page2', 'page3']);
    // back to back, no gaps
    const byStart = [...pageLayers].sort((a, b) => a.start - b.start);
    for (let i = 1; i < byStart.length; i++) expect(byStart[i]!.start).toBe(byStart[i - 1]!.out);
    expect(main.duration).toBe(byStart[byStart.length - 1]!.out);
  });

  it('a page comp has one layer per panel and balloon, plus paper at the bottom', () => {
    const p1 = project.comps.page1!;
    expect(p1.layers.map((l) => l.name)).toEqual(['Maya: Too late.', 'CAPTION: Midnight, Harbor Distric…', 'Panel 1', 'Panel 2', 'Panel 3', 'Paper']);
    expect(p1.layers.at(-1)!.locked).toBe(true);
    // the script travels as storyboard captions
    expect(p1.layers[2]!.exposures![0]!.action).toBe('Rooftop, night.');
  });

  it('a balloon appears when the camera reaches its panel', () => {
    const t = pageTiming(3, DEFAULT_MOTION, 0);
    const p3 = project.comps.page3!;
    const sfx = p3.layers[0]!;
    expect(sfx.in).toBe(pageTiming(2, DEFAULT_MOTION, 0).arrive.get(1));
    expect(t.arrive.get(0)).toBeGreaterThan(0);
  });

  it('the camera keys move strictly forward and frame each panel', () => {
    const cam = project.comps.main!.layers.find((l) => l.kind === 'camera')!;
    const keys = cam.transform.position.keys!;
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.f).toBeGreaterThan(keys[i - 1]!.f);
    expect(cam.zoom!.keys!.length).toBe(keys.length);
    // the first page starts whole, then zooms into its top-half panel above the centre
    const view = frameSize({ width: W, height: H }, 'wide');
    expect(project.comps.main!.width / project.comps.main!.height).toBeCloseTo(16 / 9, 2);
    expect(keys[0]!.v).toEqual([view.width / 2, view.height / 2]);
    const zooms = cam.zoom!.keys!;
    const firstPanel = zooms.findIndex((z) => z.v > 100);
    expect(firstPanel).toBeGreaterThan(0);
    expect(keys[firstPanel]!.v[1]).toBeLessThan(view.height / 2);
  });

  it('page-shaped output keeps the page size', () => {
    const tall = motionProject('Tall', pages(), { width: W, height: H }, { ...DEFAULT_MOTION, frame: 'page' });
    expect(tall.comps.main!.width).toBe(W);
    expect(tall.comps.main!.height).toBe(H);
  });

  it.skipIf(!hasTwoDope)('passes 2Dope’s own project validator', async () => {
    const { validateProjectFile } = (await import(/* @vite-ignore */ TWO_DOPE_SCHEMA)) as { validateProjectFile: (v: unknown) => { comps: Record<string, unknown>; main: string } };
    const parsed = validateProjectFile(JSON.parse(JSON.stringify(project)));
    expect(parsed.main).toBe('main');
    expect(Object.keys(parsed.comps)).toHaveLength(4);
  });
});

describe('live captions for 2Dope', () => {
  it('picks the 2Dope size step nearest the real size, with a scale', () => {
    const cap = { size: 'body', text: 'x' };
    expect(twoDopeCaption(cap, 0.034 * 1000, 1000)).toMatchObject({ size: 'body' });
    expect(twoDopeCaption(cap, 0.026 * 1000 * 0.8, 1000)).toMatchObject({ size: 'small', scale: 0.8 });
    expect(twoDopeCaption(cap, 1, 1000)).toMatchObject({ size: 'small', scale: 0.5 }); // floor
  });

  it.skipIf(!hasTwoDope)('a project with live captions is format 10 and passes 2Dope’s validator', async () => {
    const { defaultCaption } = await import('../engine/lettering/spec');
    const p = pages();
    const cap = { ...defaultCaption(300, 200, 'speech'), text: 'Too late.' } as unknown as Record<string, unknown> & { size: string };
    p[0]!.balloons[0]!.caption = twoDopeCaption(cap, 20, H);
    p[0]!.balloons[0]!.art = { line: null, fill: null };
    const project = motionProject('Live', p, { width: W, height: H });
    expect(project.schema).toBe(CAPTION_SCHEMA);
    const { validateProjectFile } = (await import(/* @vite-ignore */ TWO_DOPE_SCHEMA)) as { validateProjectFile: (v: unknown) => { comps: Record<string, { layers: { caption?: unknown }[] }> } };
    const parsed = validateProjectFile(JSON.parse(JSON.stringify(project)));
    expect(parsed.comps.page1!.layers.some((l) => l.caption)).toBe(true);
  });
});
