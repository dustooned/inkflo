import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, openDesk, settle, startServer } from './harness.mjs';

describe('Liquify', () => {
  let server, browser;
  before(async () => { server = await startServer(); browser = await chromium.launch(); });
  after(async () => { await browser?.close(); server?.stop(); });

  it('saves a replayable stroke for each mode, and it reloads', async () => {
    const d = await openDesk(browser, server.url, 'draw');
    for (let i = 0; i < 4; i++) await d.drag([[450, 300 + i * 30], [600, 300 + i * 30]]);
    await d.page.keyboard.press('u');
    await d.page.waitForTimeout(250);
    for (const mode of ['Push', 'Twirl']) {
      assert.ok(await d.page.evaluate((m) => { const b = [...document.querySelectorAll('.seg button')].find((x) => x.getAttribute('aria-label') === m || x.textContent.trim() === m); b?.click(); return !!b; }, mode));
      await d.page.waitForTimeout(150);
      await d.drag([[500, 285], [540, 330], [580, 380]], 10);
    }
    const kinds = (await d.edits()).map((e) => `${e.kind}:${e.mode}`);
    assert.deepEqual(kinds, ['liquify:push', 'liquify:twirl']);
    await settle(d.page);
    await d.page.reload();
    await d.page.waitForTimeout(1500);
    assert.deepEqual((await d.edits()).map((e) => `${e.kind}:${e.mode}`), kinds, 'still there after a reload');
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });
});
