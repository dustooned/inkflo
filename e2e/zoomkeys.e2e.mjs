import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, openDesk, startServer } from './harness.mjs';

describe('zoom keys', () => {
  let server, browser;
  before(async () => { server = await startServer(); browser = await chromium.launch(); });
  after(async () => { await browser?.close(); server?.stop(); });

  it('Ctrl+ and Ctrl- zoom the canvas, and the browser is told not to zoom', async () => {
    const d = await openDesk(browser, server.url, 'draw');
    await d.page.evaluate(() => { window.__prevented = []; document.addEventListener('keydown', (e) => window.__prevented.push([e.key, e.defaultPrevented]), false); });
    assert.equal(await d.zoomLabel(), '100% · 0°');
    await d.page.keyboard.press('Control+Equal');
    await d.page.waitForTimeout(100);
    assert.equal(await d.zoomLabel(), '120% · 0°');
    await d.page.keyboard.press('Control+Minus');
    await d.page.waitForTimeout(100);
    assert.equal(await d.zoomLabel(), '100% · 0°');
    await d.page.keyboard.press('Control+Equal'); await d.page.keyboard.press('Control+0');
    await d.page.waitForTimeout(100);
    assert.equal(await d.zoomLabel(), '100% · 0°', 'Ctrl+0 fits the page again');
    const prevented = await d.page.evaluate(() => window.__prevented.filter(([k]) => ['=', '-', '0'].includes(k)));
    assert.ok(prevented.length >= 4 && prevented.every(([, p]) => p), 'every zoom key was cancelled');
    await d.context.close();
  });

  it('leaves the browser zoom alone away from a canvas desk (library, script)', async () => {
    const d = await openDesk(browser, server.url, 'script');
    const defaultPrevented = await d.page.evaluate(() => { const e = new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, cancelable: true, bubbles: true }); document.dispatchEvent(e); return e.defaultPrevented; });
    assert.equal(defaultPrevented, false);
    await d.context.close();
  });
});
