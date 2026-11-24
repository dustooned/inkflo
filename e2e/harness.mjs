// Shared helpers for the browser tests: a dev server, a fresh book on a desk, and mouse helpers.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// `playwright` comes from the project's devDependencies, or from a global install (NODE_PATH) on a dev machine.
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export async function startServer() {
  const port = 5300 + Math.floor(Math.random() * 600);
  const proc = spawn('npx', ['vite', '--port', String(port), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { url, stop: () => proc.kill('SIGTERM') };
}

/**
 * A fresh book opened on `stage`. Returns the page plus helpers whose coordinates are relative to a 1400 px wide
 * window (the page's centre sits at x = 586), so tests read the same at any viewport.
 */
export async function openDesk(browser, base, stage, { width = 1400, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.__inkflo);
  const ids = await page.evaluate(async () => { const b = await window.__inkflo.createBook('T', 'a'); return [b.id, b.pages[0].id]; });
  await page.goto(`${base}#/desk/${ids[0]}/${ids[1]}/${stage}`);
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1000);
  // the page canvas is the widest one (a desk can hold smaller canvases, such as previews)
  const OX = await page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]; const r = c.getBoundingClientRect(); return Math.round(r.x + r.width / 2 - 586); });
  const mv = (x, y, o) => page.mouse.move(x + OX, y, o);
  const drag = async (pts, steps = 8) => {
    await mv(pts[0][0], pts[0][1]); await page.mouse.down();
    for (const q of pts) await mv(q[0], q[1], { steps });
    await page.mouse.up(); await page.waitForTimeout(120);
  };
  const click = (x, y) => page.mouse.click(x + OX, y);
  /** Click a button in the bar or an open menu by its exact text. */
  const press = (text, within = 'button') => page.evaluate(([w, t]) => { const el = [...document.querySelectorAll(w)].find((b) => b.textContent.trim() === t); el?.click(); return !!el; }, [within, text]);
  /** The current page, as the app holds it (edits are in memory as soon as they are made). */
  const pageData = () => page.evaluate((id) => { const b = window.__inkflo.book; return JSON.parse(JSON.stringify(b.pages.find((p) => p.id === id))); }, ids[1]);
  const edits = async () => (await pageData()).groups.flatMap((g) => g.layers).flatMap((l) => l.pixelTransforms ?? []);
  const zoomLabel = () => page.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).find((t) => /%\s*·/.test(t)));
  return { page, context, ids, errors, OX, mv, drag, click, press, pageData, edits, zoomLabel };
}

/** Wait for the app to write its edits to the library, so a reload sees them. */
export const settle = (page) => page.waitForTimeout(1600);
