const { chromium } = require('playwright');
let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; failures.push(name + ' ' + extra); console.log('  FAIL', name, extra); } };
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
async function open(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, hasTouch: !!opts.touch, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto((process.env.APP_URL || 'http://127.0.0.1:5199/') + '?e2e=1');
  await page.waitForFunction(() => window.__rp && document.querySelector('[data-testid="plan-svg"]'));
  await page.evaluate(() => window.__rp.useProject.getState().resetToSeed());
  await page.waitForTimeout(400);
  return { browser, ctx, page, errors };
}
const S = (page, fn, arg) => page.evaluate(fn, arg);
const desk = (page) => page.evaluate(() => { const s = window.__rp.useProject.getState(); const l = s.project.layouts.find(l => l.id === s.project.activeLayoutId); return l.furniture[0]; });
const state = (page) => page.evaluate(() => { const s = window.__rp.useProject.getState(); const u = window.__rp.useUi.getState(); return { p: s.project, vp: u.viewport, sel: u.selection, past: s.past.length, future: s.future.length }; });
const deskBox = async (page) => { const h = await page.$('g[data-hit="furniture"]'); return h.boundingBox(); };
module.exports = { ok, near, open, S, desk, state, deskBox, summary: () => { console.log(`\n${pass} passed, ${fail} failed`); if (fail) console.log(failures.join('\n')); return fail; } };
