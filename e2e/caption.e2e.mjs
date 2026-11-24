import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, openDesk, startServer } from './harness.mjs';

describe('Caption: type frames and balloons', () => {
  let server, browser;
  before(async () => { server = await startServer(); browser = await chromium.launch(); });
  after(async () => { await browser?.close(); server?.stop(); });

  const frameOf = async (d) => (await d.pageData()).texts?.[0];

  it('a type frame turns with the knob, stretches along its own edge, and nudges with arrow keys', async () => {
    const d = await openDesk(browser, server.url, 'caption');
    await d.page.keyboard.press('x');                         // Type tool
    await d.drag([[420, 300], [560, 380]], 8);                // draw a frame
    await d.page.waitForTimeout(300);
    const f0 = await frameOf(d);
    assert.ok(f0, 'a frame was made');
    // the rotate knob stands 23 px above the top edge, centred on the frame
    const cx = (420 + 560) / 2, topY = 300;
    await d.drag([[cx, topY - 23], [cx + 60, topY - 5]], 10);
    const f1 = await frameOf(d);
    assert.ok(Math.abs(f1.rotation ?? 0) > 5, `the frame turned (${f1.rotation ?? 0}°)`);
    // arrow keys move it by 0.01 in (0.1 with Shift)
    await d.page.keyboard.press('ArrowRight');
    await d.page.keyboard.press('Shift+ArrowDown');
    const f2 = await frameOf(d);
    assert.ok(Math.abs(f2.x - f1.x - 0.01) < 1e-9 && Math.abs(f2.y - f1.y - 0.1) < 1e-9, 'moved 0.01 in right and 0.1 in down');
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });

  it('a balloon takes arrow nudges (one point; ten with Shift)', async () => {
    const d = await openDesk(browser, server.url, 'caption');
    await d.click(586, 300);
    await d.page.waitForTimeout(500);
    await d.page.keyboard.press('Escape');
    await d.page.keyboard.press('v');
    await d.page.waitForTimeout(250);
    await d.click(586, 300);
    await d.page.waitForTimeout(400);
    const pos = async () => { const b = (await d.pageData()).balloons[0]; return [b.cap.x, b.cap.y]; };
    const [x0, y0] = await pos();
    await d.page.keyboard.press('ArrowRight');
    await d.page.keyboard.press('Shift+ArrowDown');
    const [x1, y1] = await pos();
    assert.deepEqual([x1 - x0, y1 - y0].map((n) => Math.round(n * 1000) / 1000), [1, 10]);
    await d.context.close();
  });
});
