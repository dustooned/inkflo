// Touch check: injects real multi-touch through the DevTools protocol and asserts on the saved result.
// Run with the dev server up (npm run dev -- --port 5199) and Playwright installed: node docs/qa/touch-check.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true, isMobile: false });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 0.5 })) });
  const sleep = (ms) => page.waitForTimeout(ms);
  await page.goto('http://127.0.0.1:5199/'); await page.waitForFunction(() => window.__inkflo);
  const ids = await page.evaluate(async () => { const k = await window.__inkflo.createBook('T','a'); return [k.id, k.pages[0].id]; });
  await page.goto(`http://127.0.0.1:5199/#/desk/${ids[0]}/${ids[1]}/draw`); await sleep(1200);
  // two vector strokes (mouse), then Select
  await page.keyboard.press('v'); await sleep(200);
  const drag = async (pts) => { await page.mouse.move(...pts[0]); await page.mouse.down(); for (const q of pts) await page.mouse.move(...q, { steps: 8 }); await page.mouse.up(); };
  await drag([[450, 300], [520, 340], [600, 300]]); await drag([[450, 600], [520, 640], [600, 600]]);
  await page.keyboard.press('q'); await sleep(200);
  const strokes = () => page.evaluate(async (id) => { const bk = await window.__inkflo.openBook(id); const ls = bk.pages[0].groups.flatMap((g) => g.layers).filter((l) => l.vector); return ls.flatMap((l) => l.strokes.map((s) => s.pts.map((p) => [p.x, p.y]))); }, ids[0]);
  const span = (pts) => { const a = pts[0], z = pts.at(-1); return { len: Math.hypot(z[0] - a[0], z[1] - a[1]), ang: Math.atan2(z[1] - a[1], z[0] - a[0]) * 180 / Math.PI, cx: (a[0] + z[0]) / 2, cy: (a[1] + z[1]) / 2 }; };
  const before = (await strokes()).map(span);
  console.log('strokes', before.length);
  // 1. a touch tap picks the first stroke; a touch drag moves it
  await touch('touchStart', [[520, 340]]); await touch('touchEnd', []); await sleep(300);
  await touch('touchStart', [[525, 320]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[525 + i * 8, 320 + i * 4]]);
  await touch('touchEnd', []); await sleep(500);
  const moved = (await strokes()).map(span);
  console.log('touch drag moved stroke 1 by', (moved[0].cx - before[0].cx).toFixed(3), 'x', (moved[0].cy - before[0].cy).toFixed(3), 'in (expect about 0.97 x 0.48)');
  console.log('stroke 2 untouched:', Math.abs(moved[1].cx - before[1].cx) < 1e-6 && Math.abs(moved[1].cy - before[1].cy) < 1e-6);
  // 2. two-finger pinch + twist on the selection
  const mid = [570, 700], s0 = moved[0];
  await touch('touchStart', [[mid[0] - 70, mid[1]], [mid[0] + 70, mid[1]]]);
  for (let i = 1; i <= 12; i++) { const t = i / 12, ang = t * (30 * Math.PI / 180), half = 70 + 70 * t; await touch('touchMove', [[mid[0] - half * Math.cos(ang), mid[1] - half * Math.sin(ang)], [mid[0] + half * Math.cos(ang), mid[1] + half * Math.sin(ang)]]); }
  await touch('touchEnd', []); await sleep(600);
  const after = (await strokes()).map(span);
  console.log('pinch scale', (after[0].len / s0.len).toFixed(2), '(fingers spread ×2.00)');
  console.log('twist', (after[0].ang - s0.ang).toFixed(1), '° (fingers turned 30.0°)');
  console.log('view zoom label', await page.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).find((t) => /%\s*·/.test(t))));
  // 3. one undo reverts the pinch only
  await page.keyboard.press('Control+z'); await sleep(300);
  const undone = (await strokes()).map(span);
  console.log('one undo restores size:', Math.abs(undone[0].len - s0.len) < 1e-6);
  await b.close();
})();
