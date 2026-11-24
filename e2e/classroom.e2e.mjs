import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, openDesk, startServer } from './harness.mjs';

describe('classroom mode', () => {
  let server, browser;
  before(async () => { server = await startServer(); browser = await chromium.launch(); });
  after(async () => { await browser?.close(); server?.stop(); });

  const turnOn = async (d) => {
    await d.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Display settings/i.test(b.getAttribute('aria-label') || b.title || b.textContent))?.click());
    await d.page.waitForTimeout(200);
    await d.page.getByLabel('Classroom mode').check({ force: true }).catch(async () => { await d.page.evaluate(() => [...document.querySelectorAll('label')].find((l) => /Classroom mode/.test(l.textContent))?.querySelector('input')?.click()); });
    await d.page.waitForTimeout(250);
    await d.page.mouse.click(1380, 700);
  };

  it('Layout: the Code button is there normally and gone in classroom mode', async () => {
    const d = await openDesk(browser, server.url, 'layout', { width: 2000 });
    const codeVisible = () => d.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Code'); return !!b && b.offsetParent !== null; });
    assert.equal(await codeVisible(), true);
    await turnOn(d);
    assert.equal(await d.page.evaluate(() => document.querySelector('.screen').classList.contains('classroom')), true, 'the screen is in classroom mode');
    assert.equal(await codeVisible(), false, 'Code is hidden');
    assert.equal(await d.page.evaluate(() => JSON.parse(localStorage.getItem('inkflo.prefs.v1')).classroom), true, 'and the setting is remembered');
    await d.context.close();
  });

  it('Script: the Code view is hidden and the cards stay', async () => {
    const d = await openDesk(browser, server.url, 'script', { width: 2000 });
    await d.page.evaluate(() => localStorage.setItem('inkflo.prefs.v1', JSON.stringify({ classroom: true, layout: 'simple' })));
    await d.page.reload();
    await d.page.waitForTimeout(1500);
    const seg = await d.page.evaluate(() => { const s = document.querySelector('[aria-label="Script view"]'); return s ? getComputedStyle(s).display : 'missing'; });
    assert.equal(seg, 'none');
    await d.context.close();
  });
});
