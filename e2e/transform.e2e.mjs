import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, openDesk, settle, startServer } from './harness.mjs';

describe('transform box, Distort and Warp', () => {
  let server, browser;
  before(async () => { server = await startServer(); browser = await chromium.launch(); });
  after(async () => { await browser?.close(); server?.stop(); });

  const painted = async () => {
    const d = await openDesk(browser, server.url, 'draw', { width: 2000 });
    for (let i = 0; i < 4; i++) await d.drag([[450, 300 + i * 40], [520, 320 + i * 40], [600, 300 + i * 40]]);
    await d.page.keyboard.press('r');
    await d.page.waitForTimeout(250);
    assert.ok(await d.press('Whole layer'));
    await d.page.waitForTimeout(300);
    return d;
  };

  it('rotates with the knob, and applying saves a turned matrix', async () => {
    const d = await painted();
    // the knob stands above the top edge, centred on the art
    await d.drag([[525, 277], [600, 290]], 10);
    assert.ok(await d.press('Apply'));
    await d.page.waitForTimeout(500);
    const [edit] = await d.edits();
    assert.ok(edit, 'a transform was saved');
    const [a, b] = edit.matrix;
    assert.ok(Math.abs(Math.atan2(b, a)) > 0.1, 'the saved matrix turns the art');
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });

  it('Distort and Warp save a mesh that is still there after a reload', async () => {
    for (const mode of ['Distort', 'Warp']) {
      const d = await painted();
      assert.ok(await d.page.evaluate((m) => { const b = document.querySelector(`.seg button[aria-label="${m}"]`); b?.click(); return !!b; }, mode));
      // pull a corner (Distort) or the middle of the grid (Warp)
      const from = mode === 'Distort' ? [600, 301] : [525, 321];
      await d.drag([from, [from[0] + 50, from[1] - 30]], 8);
      assert.ok(await d.press('Apply'));
      await d.page.waitForTimeout(600);
      const [edit] = await d.edits();
      assert.ok(edit?.mesh, `${mode} saved a mesh`);
      assert.equal(edit.mesh.pts.length, (edit.mesh.cols + 1) * (edit.mesh.rows + 1) * 2);
      await settle(d.page);
      await d.page.reload();
      await d.page.waitForTimeout(1500);
      const [again] = await d.edits();
      assert.deepEqual(again?.mesh, edit.mesh, `${mode} mesh survives a reload`);
      assert.deepEqual(d.errors, []);
      await d.context.close();
    }
  });

  it('exact numbers: typing a width in Arrange resizes the selection', async () => {
    const d = await painted();
    assert.ok(await d.press('Arrange ▾'));
    await d.page.waitForTimeout(200);
    const w = d.page.getByLabel('W', { exact: true });
    const before = Number(await w.inputValue());
    await w.fill(String(Math.round(before / 2)));
    await w.press('Enter');
    await d.page.waitForTimeout(200);
    assert.equal(Number(await d.page.getByLabel('W', { exact: true }).inputValue()), Math.round(before / 2));
    await d.context.close();
  });

  it('arrow keys nudge: one pixel, ten with Shift', async () => {
    const d = await painted();
    const x = async () => { await d.press('Arrange ▾'); await d.page.waitForTimeout(150); const v = Number(await d.page.getByLabel('X', { exact: true }).inputValue()); await d.page.mouse.click(d.OX + 1900, 780); return v; };
    const x0 = await x();
    await d.page.keyboard.press('ArrowRight');
    await d.page.keyboard.press('Shift+ArrowRight');
    assert.ok(Math.abs((await x()) - x0 - 11) < 0.01, 'moved 1 + 10 px');
    await d.context.close();
  });
});
