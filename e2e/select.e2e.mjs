import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, openDesk, settle, startServer } from './harness.mjs';

describe('Select and selection recipes', () => {
  let server, browser;
  before(async () => { server = await startServer(); browser = await chromium.launch(); });
  after(async () => { await browser?.close(); server?.stop(); });

  const vectorLines = async () => {
    const d = await openDesk(browser, server.url, 'draw');
    await d.page.keyboard.press('v'); // vector pen
    await d.drag([[450, 300], [520, 340], [600, 300]]);
    await d.drag([[450, 480], [520, 520], [600, 480]]);
    await d.drag([[450, 650], [520, 690], [600, 650]]);
    await d.page.keyboard.press('q'); // Select
    await d.page.waitForTimeout(200);
    return d;
  };
  const strokes = async (d) => (await d.pageData()).groups.flatMap((g) => g.layers).filter((l) => l.vector).flatMap((l) => l.strokes);

  it('a tap picks a line and a drag moves only that line; Shift-tap adds another', async () => {
    const d = await vectorLines();
    const before = await strokes(d);
    assert.equal(before.length, 3);
    await d.click(520, 340);
    await d.drag([[525, 320], [585, 350]], 8);
    const moved = await strokes(d);
    assert.notDeepEqual(moved[0].pts, before[0].pts, 'the tapped line moved');
    assert.deepEqual(moved[1].pts, before[1].pts, 'the others stayed');
    await d.page.keyboard.down('Shift'); await d.click(520, 520); await d.page.keyboard.up('Shift');
    // the next drag now moves both
    const mid = await strokes(d);
    await d.drag([[555, 400], [555, 440]], 8);
    const both = await strokes(d);
    assert.notDeepEqual(both[0].pts, mid[0].pts);
    assert.notDeepEqual(both[1].pts, mid[1].pts);
    assert.deepEqual(both[2].pts, mid[2].pts, 'the third line was never selected');
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });

  it('a pinch scales and twists the selection in one undo step, and the view does not move', async () => {
    const d = await vectorLines();
    await d.click(520, 340);
    const before = (await strokes(d))[0].pts;
    const span = (p) => ({ len: Math.hypot(p.at(-1).x - p[0].x, p.at(-1).y - p[0].y), ang: Math.atan2(p.at(-1).y - p[0].y, p.at(-1).x - p[0].x) * 180 / Math.PI });
    const fire = (type, id, x, y) => d.page.evaluate(([t, i, px, py]) => document.querySelector('canvas').parentElement.dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: 'touch', isPrimary: i === 1, clientX: px, clientY: py, buttons: t === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, button: 0 })), [type, id, x, y]);
    const cx = d.OX + 586;
    await fire('pointerdown', 1, cx - 70, 600); await fire('pointerdown', 2, cx + 70, 600);
    for (let i = 1; i <= 10; i++) { const t = i / 10, a = t * 0.5, h = 70 + 70 * t; await fire('pointermove', 1, cx - h * Math.cos(a), 600 - h * Math.sin(a)); await fire('pointermove', 2, cx + h * Math.cos(a), 600 + h * Math.sin(a)); }
    await fire('pointerup', 2, cx + 140, 640); await fire('pointerup', 1, cx - 140, 560);
    await d.page.waitForTimeout(400);
    const after = (await strokes(d))[0].pts;
    assert.ok(Math.abs(span(after).len / span(before).len - 2) < 0.02, 'scaled ×2');
    assert.ok(Math.abs(span(after).ang - span(before).ang - 28.65) < 0.5, 'turned 0.5 rad');
    assert.equal(await d.zoomLabel(), '100% · 0°', 'the view stayed put');
    await d.page.keyboard.press('Control+z');
    await d.page.waitForTimeout(300);
    assert.deepEqual((await strokes(d))[0].pts, before, 'one undo reverts the whole gesture');
    await d.context.close();
  });

  it('paint: Add and Subtract build a saved selection recipe that reloads the same', async () => {
    const d = await openDesk(browser, server.url, 'draw', { width: 2000 });
    for (let i = 0; i < 3; i++) await d.drag([[450, 300 + i * 60], [600, 300 + i * 60]]);
    await d.page.keyboard.press('r');
    await d.page.waitForTimeout(250);
    const lasso = async (x0, y0, x1, y1) => { await d.mv(x0, y0); await d.page.mouse.down(); await d.mv(x1, y1, { steps: 10 }); await d.page.mouse.up(); await d.page.waitForTimeout(350); };
    const mode = async (name) => { await d.press('Selection ▾'); await d.page.waitForTimeout(150); await d.press(name, '.pop button'); await d.page.mouse.click(1900, 780); await d.page.waitForTimeout(150); };
    await lasso(430, 285, 620, 315); // line 1
    await mode('Add');
    await lasso(430, 405, 620, 435); // add line 3
    await mode('Subtract');
    await lasso(525, 395, 625, 445); // take the right half of line 3 out
    await mode('New');
    await d.drag([[500, 301], [500, 371]], 8); // move what is selected
    assert.ok(await d.press('Apply'));
    await d.page.waitForTimeout(700);
    const [edit] = await d.edits();
    assert.deepEqual(edit.selection.map((s) => s.op), ['replace', 'add', 'subtract'], 'the recipe was saved');
    await settle(d.page);
    await d.page.reload();
    await d.page.waitForTimeout(1500);
    const [again] = await d.edits();
    assert.deepEqual(again.selection, edit.selection, 'and it reloads unchanged');
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });

  it('Layout Select: a panel is picked by a tap and a gutter drag resizes the cut', async () => {
    const d = await openDesk(browser, server.url, 'layout');
    await d.drag([[586, 110], [586, 500], [586, 820]], 10); // a vertical cut
    await d.page.keyboard.press('q');
    await d.click(480, 300);
    await d.page.waitForTimeout(250);
    const x0 = (await d.pageData()).cuts[0].pts[0].x;
    await d.drag([[586, 600], [640, 600]], 8);
    await d.page.waitForTimeout(300);
    const x1 = (await d.pageData()).cuts[0].pts[0].x;
    assert.ok(x1 > x0 + 0.5, `the cut moved right (${x0.toFixed(2)} to ${x1.toFixed(2)} in)`);
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });

  it('lines: Add and Subtract change which lines are selected, and Invert takes the rest', async () => {
    const d = await openDesk(browser, server.url, 'draw', { width: 2000 });
    await d.page.keyboard.press('v');
    await d.drag([[450, 300], [520, 340], [600, 300]]);
    await d.drag([[450, 480], [520, 520], [600, 480]]);
    await d.drag([[450, 650], [520, 690], [600, 650]]);
    await d.page.keyboard.press('m'); // Select lines
    await d.page.waitForTimeout(250);
    const lines = async () => (await d.pageData()).groups.flatMap((g) => g.layers).filter((l) => l.vector).flatMap((l) => l.strokes).map((s) => s.pts[0].y);
    const lasso = async (y0, y1) => { await d.mv(385, y0); await d.page.mouse.down(); await d.mv(640, y1, { steps: 10 }); await d.page.mouse.up(); await d.page.waitForTimeout(300); };
    const mode = (name) => d.page.evaluate((n) => document.querySelector(`.seg button[aria-label="${n}"]`).click(), name);
    const start = await lines();
    await lasso(280, 360);                  // line 1
    await mode('Add');
    await lasso(460, 540);                  // add line 2
    await mode('Subtract');
    await lasso(280, 360);                  // take line 1 out again
    await mode('New');
    await d.drag([[525, 500], [525, 540]], 8); // moves only line 2
    const moved = await lines();
    assert.equal(moved[0], start[0], 'line 1 was subtracted, so it stayed');
    assert.notEqual(moved[1], start[1], 'line 2 was added, so it moved');
    assert.equal(moved[2], start[2]);
    // Invert: select line 3 and 1 by selecting line 2 and inverting
    await d.page.mouse.click(d.OX + 1900, 780);
    await lasso(500, 600);                  // line 2 (now moved down)
    assert.ok(await d.press('Invert'));
    await d.page.waitForTimeout(200);
    await d.drag([[525, 330], [525, 290]], 8);
    const after = await lines();
    assert.notEqual(after[0], moved[0], 'line 1 moved: it is part of the inverse');
    assert.equal(after[1], moved[1], 'line 2 stayed');
    assert.notEqual(after[2], moved[2], 'line 3 moved: it is part of the inverse');
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });

  it('paint: a selection can be saved by name, brought back after clearing and after a reload, and deleted', async () => {
    const d = await openDesk(browser, server.url, 'draw', { width: 2000 });
    for (let i = 0; i < 3; i++) await d.drag([[450, 300 + i * 60], [600, 300 + i * 60]]);
    await d.page.keyboard.press('r');
    await d.page.waitForTimeout(250);
    await d.mv(430, 285); await d.page.mouse.down(); await d.mv(620, 315, { steps: 10 }); await d.page.mouse.up(); await d.page.waitForTimeout(350);
    const menu = async (fn) => { await d.press('Selection ▾'); await d.page.waitForTimeout(200); const r = await fn(); await d.page.mouse.click(1900, 780); await d.page.waitForTimeout(150); return r; };
    await menu(async () => { await d.page.getByLabel('Selection name').fill('Line one'); await d.press('Save', '.pop button'); await d.page.waitForTimeout(200); });
    let saved = (await d.pageData()).savedSelections;
    assert.equal(saved?.length, 1);
    assert.equal(saved[0].name, 'Line one');
    assert.equal(saved[0].steps[0].op, 'replace');
    // clear the selection, then bring it back: its box returns
    await d.page.keyboard.press('Escape');
    await d.page.waitForTimeout(200);
    const handles = () => d.page.evaluate(() => 1);
    await menu(async () => { assert.ok(await d.press('Line one', '.pop button')); });
    await d.page.waitForTimeout(300);
    await d.drag([[525, 301], [525, 361]], 8);                       // drag the restored selection
    assert.ok(await d.press('Apply'));
    await d.page.waitForTimeout(600);
    const [edit] = await d.edits();
    assert.ok(edit && Math.abs(edit.matrix[5]) > 0.3, 'the restored selection moved line one');
    await settle(d.page);
    await d.page.reload();
    await d.page.waitForTimeout(1500);
    saved = (await d.pageData()).savedSelections;
    assert.equal(saved?.[0]?.name, 'Line one', 'the saved selection survives a reload');
    await d.page.keyboard.press('r');
    await d.page.waitForTimeout(250);
    await menu(async () => { await d.page.evaluate(() => document.querySelector('.pop [aria-label="Delete Line one"]').click()); await d.page.waitForTimeout(200); });
    assert.equal((await d.pageData()).savedSelections, undefined, 'and it can be deleted');
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });
});
