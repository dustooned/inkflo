import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, openDesk, startServer } from './harness.mjs';

// Real multi-touch, injected through the DevTools protocol (so the app sees genuine touch pointers).
describe('touch', () => {
  let server, browser;
  before(async () => { server = await startServer(); browser = await chromium.launch(); });
  after(async () => { await browser?.close(); server?.stop(); });

  it('a finger taps to pick and drags to move; two fingers pinch and twist; one undo reverts', async () => {
    const d = await openDesk(browser, server.url, 'draw', { touch: true });
    const cdp = await d.context.newCDPSession(d.page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x: x + d.OX, y, id, radiusX: 4, radiusY: 4, force: 0.5 })) });
    await d.page.keyboard.press('v'); // vector pen (mouse drawing, as a stylus would)
    await d.drag([[450, 300], [520, 340], [600, 300]]);
    await d.drag([[450, 600], [520, 640], [600, 600]]);
    await d.page.keyboard.press('q');
    await d.page.waitForTimeout(200);
    const spans = async () => (await d.pageData()).groups.flatMap((g) => g.layers).filter((l) => l.vector).flatMap((l) => l.strokes)
      .map((s) => { const p = s.pts, a = p[0], z = p.at(-1); return { len: Math.hypot(z.x - a.x, z.y - a.y), ang: Math.atan2(z.y - a.y, z.x - a.x) * 180 / Math.PI, cx: (a.x + z.x) / 2, cy: (a.y + z.y) / 2 }; });
    const start = await spans();

    // tap the first line, then drag from inside its box (not on a handle)
    await touch('touchStart', [[520, 340]]); await touch('touchEnd', []); await d.page.waitForTimeout(250);
    await touch('touchStart', [[525, 320]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[525 + i * 8, 320 + i * 4]]);
    await touch('touchEnd', []); await d.page.waitForTimeout(400);
    const moved = await spans();
    assert.ok(Math.abs(moved[0].cx - start[0].cx - 0.98) < 0.1 && Math.abs(moved[0].cy - start[0].cy - 0.49) < 0.1, 'the line followed the finger');
    assert.deepEqual([moved[1].cx, moved[1].cy], [start[1].cx, start[1].cy], 'the other line stayed');

    // two fingers: spread ×2 and turn 30°
    const mid = [570, 700];
    await touch('touchStart', [[mid[0] - 70, mid[1]], [mid[0] + 70, mid[1]]]);
    for (let i = 1; i <= 12; i++) { const t = i / 12, a = t * Math.PI / 6, h = 70 + 70 * t; await touch('touchMove', [[mid[0] - h * Math.cos(a), mid[1] - h * Math.sin(a)], [mid[0] + h * Math.cos(a), mid[1] + h * Math.sin(a)]]); }
    await touch('touchEnd', []); await d.page.waitForTimeout(500);
    const after = await spans();
    assert.ok(Math.abs(after[0].len / moved[0].len - 2) < 0.02, 'pinch scaled ×2');
    assert.ok(Math.abs(after[0].ang - moved[0].ang - 30) < 0.5, 'twist turned 30°');
    assert.equal(await d.zoomLabel(), '100% · 0°', 'the view did not move');
    await d.page.keyboard.press('Control+z');
    await d.page.waitForTimeout(300);
    assert.ok(Math.abs((await spans())[0].len - moved[0].len) < 1e-6, 'one undo reverts the pinch');
    assert.deepEqual(d.errors, []);
    await d.context.close();
  });
});
