const { ok, near, open, S, desk, state, summary } = require('./lib.cjs');
const type = async (page, testId, text) => { const el = await page.$(`[data-testid="${testId}"]`); await el.click(); await el.fill(text); await page.keyboard.press('Enter'); await page.waitForTimeout(120); };
(async () => {
  const { browser, page, errors } = await open();
  console.log('Unresolved items are listed, not guessed');
  await page.click('button:has-text("6 items need measurements")');
  await page.waitForTimeout(200);
  let st = await state(page);
  ok('clicking the badge switches to Room mode', await page.evaluate(() => window.__rp.useUi.getState().mode) === 'room');
  const unresolvedText = await page.textContent('[data-testid="unresolved-list"]').catch(() => '');
  ok('checklist names the window, doorway, pillar, built-ins and TV', /Window/.test(unresolvedText) && /Doorway/.test(unresolvedText) && /pillar/i.test(unresolvedText) && /bookcases/i.test(unresolvedText) && /TV/.test(unresolvedText), unresolvedText.slice(0, 120));
  const unplaced = await page.$$eval('svg [data-hit="arch"]', e => e.length);
  ok('nothing architectural is drawn until measured', unplaced === 0, `${unplaced}`);

  console.log('Enter the room depth');
  await S(page, () => window.__rp.useUi.getState().select(null));
  await page.waitForTimeout(150);
  await type(page, 'room-depth', `9' 4"`);
  st = await state(page);
  ok(`depth 9' 4" parsed to 112"`, st.p.room.depth === 112, `${st.p.room.depth}`);
  ok('room width untouched at 101"', st.p.room.width === 101);
  await S(page, () => window.__rp.useUi.getState().sendCanvasCmd('fit')); await page.waitForTimeout(250);
  const walls = await page.evaluate(() => [...document.querySelectorAll('svg polygon[data-hit="wall"]')].map(e => e.dataset.id).sort());
  ok('all four walls now exist', walls.join() === 'east,north,south,west', walls.join());
  ok('"depth not measured" flag is gone', !(await page.textContent('body')).includes('Depth not measured'));

  console.log('Add the window (north wall) with fractional inches');
  const winId = await S(page, () => window.__rp.useProject.getState().project.room.items.find(i => i.type === 'window').id);
  await S(page, (id) => window.__rp.useUi.getState().select({ kind: 'arch', id }), winId);
  await page.waitForTimeout(200);
  ok('inspector says what is still needed', /Needs measurements/.test(await page.textContent('[data-testid="needs-measurements"]')));
  await page.selectOption('select >> nth=0', 'north');
  await type(page, 'a-offset', '20 1/2');
  await type(page, 'a-width', '36');
  st = await state(page);
  let w = st.p.room.items.find(i => i.type === 'window');
  ok('window stored in inches: wall north, offset 20.5, width 36', w.wallId === 'north' && w.offset === 20.5 && w.width === 36, JSON.stringify(w));
  ok('window now appears on the plan', (await page.$$eval('svg [data-hit="arch"]', e => e.length)) >= 1);

  console.log('Conflicting measurements are reported, never silently fixed');
  await type(page, 'a-offset', '80');
  st = await state(page);
  w = st.p.room.items.find(i => i.type === 'window');
  ok('the stored offset stays exactly as typed (80)', w.offset === 80 && w.width === 36);
  const body = await page.textContent('body');
  ok('conflict message names the wall length and sum (116" vs 101")', /does not fit/.test(body) && /116/.test(body) && /101/.test(body));
  ok('conflicting measurements listed as chips', /Window position/.test(body) && /North wall length/.test(body));
  await type(page, 'a-offset', '10');

  console.log('Doorway + door with swing');
  const doorId = await S(page, () => window.__rp.useProject.getState().project.room.items.find(i => i.type === 'door').id);
  await S(page, (id) => { window.__rp.useProject.getState().updateArch(id, { style: 'door', wallId: 'west', offset: 20, width: 32, hinge: 'start', swing: 'in' }); window.__rp.useUi.getState().select({ kind: 'arch', id }); }, doorId);
  await page.waitForTimeout(250);
  const swingPolys = await page.$$eval('svg polygon', els => els.filter(e => e.getAttribute('stroke-dasharray') && e.getAttribute('fill') && e.getAttribute('fill').startsWith('rgba(0,113,227')).length);
  ok('door swing arc region is drawn', swingPolys >= 1, `${swingPolys}`);
  // furniture in the swing path -> collision
  await S(page, () => { const s = window.__rp.useProject.getState(); const id = s.project.layouts[0].furniture[0].id; s.updateFurniture(id, { x: 70, y: 40 }); });
  await S(page, () => { const s = window.__rp.useProject.getState(); const id = s.project.layouts[0].furniture[0].id; s.updateFurniture(id, { x: 32 + 6, y: 40 }); window.__rp.useUi.getState().select({ kind: 'furniture', id }); });
  await page.waitForTimeout(250);
  const hl = await page.textContent('[data-testid="fit-headline"]');
  ok('desk inside the swing arc: "overlaps ... swing"', /swing/i.test(hl), hl);
  await S(page, () => { const s = window.__rp.useProject.getState(); const id = s.project.layouts[0].furniture[0].id; s.updateFurniture(id, { x: 66, y: 50 }); });
  await page.waitForTimeout(200);
  { const h = await page.textContent('[data-testid="fit-headline"]').catch(e => 'ERR ' + e.message); const sel = await page.evaluate(() => JSON.stringify(window.__rp.useUi.getState().selection)); const dd = await desk(page); ok('moved clear of the swing: fits', /Fits/.test(h), `headline=[${h}] sel=${sel} desk=(${dd.x},${dd.y})`); }

  console.log('Pillar + built-in; solids block furniture');
  const pId = await S(page, () => window.__rp.useProject.getState().project.room.items.find(i => i.type === 'pillar').id);
  await S(page, (id) => { window.__rp.useProject.getState().updateArch(id, { x: 60, y: 50, width: 16, depth: 16 }); window.__rp.useUi.getState().select({ kind: 'arch', id }); }, pId);
  await page.waitForTimeout(200);
  ok('pillar placed', (await state(page)).p.room.items.find(i => i.type === 'pillar').x === 60);
  await S(page, () => { const s = window.__rp.useProject.getState(); const id = s.project.layouts[0].furniture[0].id; s.updateFurniture(id, { x: 66, y: 58 }); window.__rp.useUi.getState().select({ kind: 'furniture', id }); });
  await page.waitForTimeout(250);
  ok('desk over the pillar: "overlaps Wood pillar"', /pillar/i.test(await page.textContent('[data-testid="fit-headline"]')));

  console.log('Wall tool');
  await S(page, () => { window.__rp.useUi.getState().setMode('room'); window.__rp.useUi.getState().setWallTool(true); });
  const cv = await page.$eval('[data-testid="plan-canvas"]', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const { vp } = await state(page);
  const at = (xin, yin) => ({ x: cv.x + vp.panX + xin * vp.zoom, y: cv.y + vp.panY + yin * vp.zoom });
  let a = at(10, 100), b = at(50.3, 100.4);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(200);
  st = await state(page);
  ok('wall tool created an interior wall', st.p.room.interiorWalls.length === 1);
  const iw = st.p.room.interiorWalls[0];
  ok('endpoints are exact inches and snapped orthogonal (same y)', iw.a.y === iw.b.y && Math.abs(iw.b.x - iw.a.x) > 30, JSON.stringify(iw));
  await S(page, () => window.__rp.useUi.getState().setWallTool(false));

  console.log('Measure tool');
  await S(page, () => window.__rp.useUi.getState().setMode('measure'));
  a = at(0, 0); b = at(101, 0);
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y); await page.waitForTimeout(150);
  st = await state(page);
  ok('measurement stored', st.p.measurements.length === 1);
  const m = st.p.measurements[0];
  ok('wall corner to wall corner = 101"', near(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y), 101, 0.05), JSON.stringify(m));
  ok('label shows 101"', (await page.textContent('body')).includes('101"'));

  console.log('Errors:', errors.length ? errors : 'none');
  ok('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(summary() ? 1 : 0);
})();
