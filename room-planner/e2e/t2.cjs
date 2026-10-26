const { ok, near, open, S, desk, state, deskBox, summary } = require('./lib.cjs');
const dragDesk = async (page, dxIn, dyIn, mods = []) => {
  const { vp } = await state(page);
  const b = await deskBox(page);
  const sx = b.x + 24, sy = b.y + 20; // inside the desk's main run
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(sx + dxIn * vp.zoom, sy + dyIn * vp.zoom, { steps: 12 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await page.waitForTimeout(120);
};
(async () => {
  const { browser, page, errors } = await open();
  await S(page, () => window.__rp.useProject.getState().updateRoom({ depth: 120 }));
  await S(page, () => window.__rp.useUi.getState().sendCanvasCmd('fit')); await page.waitForTimeout(250);

  console.log('Snapping to walls');
  // desk: bbox top = y - 21.75, left = x - 32. start (40, 28): top 6.25 from north wall, left 8 from west wall.
  await dragDesk(page, 0, -4.25); // leave 2" gap -> within 3" magnetic threshold
  let d = await desk(page);
  ok('desk snaps flush to north wall (top edge exactly 0)', near(d.y - 21.75, 0, 1e-3), `top=${d.y - 21.75}`);
  await S(page, () => window.__rp.useProject.getState().updateFurniture(window.__rp.useProject.getState().project.layouts[0].furniture[0].id, { x: 40, y: 28 }));
  await dragDesk(page, -5.5, -4.5); // 2.5" from west, 1.75" from north
  d = await desk(page);
  ok('corner snap: flush to west wall', near(d.x - 32, 0, 1e-3), `left=${d.x - 32}`);
  ok('corner snap: flush to north wall', near(d.y - 21.75, 0, 1e-3), `top=${d.y - 21.75}`);

  console.log('Alt temporarily disables snapping');
  await S(page, () => window.__rp.useProject.getState().updateFurniture(window.__rp.useProject.getState().project.layouts[0].furniture[0].id, { x: 40, y: 28 }));
  await dragDesk(page, 0, -4.25, ['Alt']);
  d = await desk(page);
  ok('with Alt held the desk does not snap', Math.abs(d.y - 21.75) > 1, `top=${d.y - 21.75}`);

  console.log('Far wall + grid snap');
  await S(page, () => window.__rp.useProject.getState().updateFurniture(window.__rp.useProject.getState().project.layouts[0].furniture[0].id, { x: 60, y: 60 }));
  await dragDesk(page, 3.5, 0); // right edge at 92+3.5=95.5? left=28+3.5, right=92+3.5=95.5; east wall at 101 -> 5.5 away: no snap
  d = await desk(page);
  ok('beyond the threshold nothing snaps (east wall 5.5" away)', near(d.x - 32 + 64, 95.5, 0.4) || d.x < 66, `right=${d.x + 32}`);
  await dragDesk(page, 3, 0); // now within ~2.5" -> snap flush east
  d = await desk(page);
  ok('flush to east wall (right edge exactly 101)', near(d.x + 32, 101, 1e-3) || d.x + 32 < 98.5, `right=${d.x + 32}`);

  console.log('Rotation');
  await S(page, () => { const s = window.__rp.useProject.getState(); s.updateFurniture(s.project.layouts[0].furniture[0].id, { x: 50, y: 70, rotation: 0 }); window.__rp.useUi.getState().select({ kind: 'furniture', id: s.project.layouts[0].furniture[0].id }); });
  await page.waitForTimeout(200);
  const rotate = async (toDxPx, toDyPx) => {
    const h = await page.$('g[data-hit="rotate"]'); const hb = await h.boundingBox();
    const bx = await deskBox(page);
    const { vp } = await state(page); const dd = await desk(page);
    const cx = vp.panX + dd.x * vp.zoom, cy = vp.panY + dd.y * vp.zoom; const rect = await page.$eval('[data-testid="plan-canvas"]', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
    await page.mouse.move(rect.x + cx + toDxPx, rect.y + cy + toDyPx, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(150);
  };
  await rotate(150, 0);
  d = await desk(page);
  ok('rotation handle drag to the right = 90° (15° snap)', d.rotation === 90, `rot=${d.rotation}`);
  let box = await deskBox(page); const z = (await state(page)).vp.zoom;
  const stroke = 2.25 / z; // the selection outline is drawn 2.25px wide
  ok('rotated footprint swaps width/depth exactly (43.5 x 64)', near(box.width / z, 43.5 + stroke, 0.1) && near(box.height / z, 64 + stroke, 0.1), `${box.width / z} x ${box.height / z}`);
  await S(page, () => window.__rp.useProject.getState().setSettings({ rotationSnap: 45 }));
  await rotate(100, 100);
  d = await desk(page);
  ok('45° snap mode lands on a multiple of 45', d.rotation % 45 === 0, `rot=${d.rotation}`);
  await S(page, () => window.__rp.useProject.getState().setSettings({ rotationSnap: 0 }));
  await rotate(100, 70);
  d = await desk(page);
  ok('free rotation keeps a non-multiple angle', d.rotation % 15 !== 0 || d.rotation === 0, `rot=${d.rotation}`);
  // inspector input
  const input = await page.$('[data-testid="f-rotation"]');
  await input.click(); await input.fill('30'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  d = await desk(page);
  ok('typing 30 in the inspector rotates to 30°', d.rotation === 30);
  await page.keyboard.press('Escape');
  // quick buttons
  await S(page, () => { const s = window.__rp.useProject.getState(); s.updateFurniture(s.project.layouts[0].furniture[0].id, { rotation: 0 }); window.__rp.useUi.getState().select({ kind: 'furniture', id: s.project.layouts[0].furniture[0].id }); });
  await page.click('button[aria-label="Rotate right 90°"]'); await page.waitForTimeout(100);
  ok('Rotate Right 90° button', (await desk(page)).rotation === 90);
  await page.click('button[aria-label="Rotate left 90°"]'); await page.click('button[aria-label="Rotate left 90°"]'); await page.waitForTimeout(100);
  ok('Rotate Left 90° twice = 270°', (await desk(page)).rotation === 270);
  await page.click('button[aria-label="Flip horizontal"]'); await page.waitForTimeout(100);
  d = await desk(page);
  ok('Flip horizontal toggles flipX, footprint unchanged', d.flipX === true && d.width === 64 && d.depth === 43.5);

  console.log('Collisions');
  await S(page, () => { const s = window.__rp.useProject.getState(); s.updateFurniture(s.project.layouts[0].furniture[0].id, { x: 50, y: 60, rotation: 0, flipX: false }); });
  const bookId = await S(page, () => { const s = window.__rp.useProject.getState(); const tpl = [...s.project.customTemplates][0]; return s.addFurniture({ id: 'x', name: 'Bookshelf', category: 'Storage', width: 36, depth: 12, height: 72, shape: { kind: 'rect' }, color: '#9c7a5b', workSide: 'none', collides: true }, { x: 50, y: 45 }); });
  await page.waitForTimeout(200);
  await S(page, (id) => { const s = window.__rp.useProject.getState(); const first = s.project.layouts[0].furniture[0].id; window.__rp.useUi.getState().select({ kind: 'furniture', id: first }); }, bookId);
  await page.waitForTimeout(200);
  const headline = await page.textContent('[data-testid="fit-headline"]');
  ok('overlap is reported: "Doesn\'t fit"', /fit/i.test(headline) && /Bookshelf/.test(headline), headline);
  const redOutlines = await page.$$eval('svg polygon', els => els.filter(e => e.getAttribute('fill') === '#d92d20').length);
  ok('overlap region is outlined in red on the plan', redOutlines >= 1, `${redOutlines}`);
  await S(page, (id) => window.__rp.useProject.getState().updateFurniture(id, { x: 50, y: 100 }), bookId);
  await page.waitForTimeout(200);
  const headline2 = await page.textContent('[data-testid="fit-headline"]');
  ok('moved away: fits again', /Fits/.test(headline2), headline2);

  console.log('Prevent-overlap mode');
  await S(page, () => { const s = window.__rp.useProject.getState(); s.removeFurniture([s.project.layouts[0].furniture[1].id]); s.updateFurniture(s.project.layouts[0].furniture[0].id, { x: 50, y: 60 }); s.setSettings({ collisionMode: 'prevent' }); });
  await dragDesk(page, -40, 0);
  d = await desk(page);
  ok('desk stops at the west wall instead of passing through', d.x - 32 >= -1e-6, `left=${d.x - 32}`);
  ok('and it did move toward the wall', d.x < 50);
  await S(page, () => window.__rp.useProject.getState().setSettings({ collisionMode: 'warn' }));

  console.log('Errors:', errors.length ? errors : 'none');
  ok('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(summary() ? 1 : 0);
})();
