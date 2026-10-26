const fs = require('fs');
const { ok, near, open, S, state, summary } = require('./lib.cjs');
const shot = (page, n) => page.screenshot({ path: `${process.env.SHOTS || '/tmp/claude-0/shots'}/${n}.png` });
(async () => {
  fs.mkdirSync(process.env.SHOTS || '/tmp/claude-0/shots', { recursive: true });
  const { browser, page, errors } = await open();
  const P = () => page.evaluate(() => window.__rp.useProject.getState().project);
  const U = (fn, arg) => page.evaluate(fn, arg);

  console.log('Non-rectangular room');
  await U(() => { const s = window.__rp.useProject.getState(); s.updateRoom({ depth: 96 }); window.__rp.useUi.getState().setMode('room'); });
  await page.waitForTimeout(200);
  // add a door on the south wall first, to check it survives conversion
  await U(() => { const s = window.__rp.useProject.getState(); const d = s.project.room.items.find(i => i.type === 'door'); s.updateArch(d.id, { wallId: 'south', offset: 10, width: 30 }); });
  await U(() => window.__rp.useUi.getState().select(null));
  await page.waitForTimeout(150);
  await page.click('button:has-text("Edit as custom shape")');
  await page.waitForTimeout(200);
  let p = await P();
  ok('outline created with 4 corners', p.room.outline && p.room.outline.length === 4);
  ok('door followed its wall (south → e2) and kept position', (() => { const d = p.room.items.find(i => i.type === 'door'); return d.wallId === 'e2' && d.offset === 101 - 10 - 30; })(), JSON.stringify(p.room.items.find(i => i.type === 'door')));
  await U(() => window.__rp.useUi.getState().sendCanvasCmd('fit')); await page.waitForTimeout(250);
  ok('4 corner handles + 4 add-corner handles shown', (await page.$$eval('[data-hit="corner"]', e => e.length)) === 4 && (await page.$$eval('[data-hit="edgeadd"]', e => e.length)) === 4);

  // cut a 36 x 30 notch from the north-east corner via the form
  const sel = await page.$('select:near(:text("Cut out a corner"))');
  await U(() => {}); 
  const err = await U(() => window.__rp.useProject.getState().cutCorner(1, 36, 30));
  ok('cut-corner succeeds', err === null, String(err));
  p = await P();
  ok('now 6 corners and overall size unchanged', p.room.outline.length === 6 && p.room.width === 101 && p.room.depth === 96);
  await page.waitForTimeout(200);
  const floorPts = await page.$$eval('svg polygon', (els) => els.map(e => e.getAttribute('points')).filter(s => s && s.split(' ').length === 6).length);
  ok('floor is drawn as a 6-sided polygon', floorPts >= 1);
  ok('door still placed', await U(() => window.__rp.useProject.getState().project.room.items.some(i => i.type === 'door' && i.wallId !== null)));
  await shot(page, 'outline-L');

  console.log('Furniture respects the notch');
  await U(() => { const s = window.__rp.useProject.getState(); const f = s.project.layouts[0].furniture[0]; s.updateFurniture(f.id, { x: 101 - 20, y: 14 }); });
  await page.waitForTimeout(250);
  const colliding = await U(() => document.body.textContent.includes('Collision') || document.body.textContent.includes('overlap') || document.querySelectorAll('[data-collision]').length);
  const analysis = await U(() => { const f = window.__rp.useProject.getState().project.layouts[0].furniture[0]; return f.x; });
  ok('desk moved into the cut-out region', analysis === 81);
  await U(() => { const u = window.__rp.useUi.getState(); u.setMode('furniture'); u.select({ kind: 'furniture', id: window.__rp.useProject.getState().project.layouts[0].furniture[0].id }); });
  await page.waitForTimeout(250);
  const verdict = await page.textContent('[data-testid="inspector"]').catch(() => '');
  ok('inspector reports a collision / outside-room problem', /collision|outside|overlap|Collision/i.test(verdict) || colliding, verdict.slice(0, 160));
  await U(() => { const s = window.__rp.useProject.getState(); const f = s.project.layouts[0].furniture[0]; s.updateFurniture(f.id, { x: 40, y: 50 }); });

  console.log('Dragging a corner is one undo step and re-anchors the origin');
  await U(() => window.__rp.useUi.getState().setMode('room')); await page.waitForTimeout(200);
  const before = await P();
  const pastBefore = await U(() => window.__rp.useProject.getState().past.length);
  const h = await page.$('[data-hit="corner"][data-id="0"]');
  const bb = await h.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 - 40, bb.y + bb.height / 2 - 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  p = await P();
  const pastAfter = await U(() => window.__rp.useProject.getState().past.length);
  ok('corner drag = exactly one history entry', pastAfter === pastBefore + 1, `${pastBefore}→${pastAfter}`);
  ok('outline re-anchored to 0,0 and room grew', Math.min(...p.room.outline.map(c => c.x)) === 0 && Math.min(...p.room.outline.map(c => c.y)) === 0 && p.room.width > before.room.width - 1);
  ok('furniture shifted with the origin (stayed in place in the room)', p.layouts[0].furniture[0].x > before.layouts[0].furniture[0].x);
  await U(() => window.__rp.useProject.getState().undo());
  p = await P();
  ok('undo restores the original outline exactly', JSON.stringify(p.room.outline) === JSON.stringify(before.room.outline));

  console.log('Add a corner by clicking an edge handle; remove a corner');
  await page.click('[data-hit="edgeadd"][data-id="0"]');
  await page.waitForTimeout(150);
  p = await P();
  ok('corner added (7)', p.room.outline.length === 7);
  await page.click('button[aria-label="Remove corner 2"]');
  p = await P();
  ok('corner removed (6)', p.room.outline.length === 6);

  console.log('Wall inspector for an outline wall');
  await U(() => window.__rp.useUi.getState().select({ kind: 'wall', id: 'e0' }));
  await page.waitForTimeout(200);
  ok('wall inspector shows length input', !!(await page.$('[data-testid="wall-length"]')));
  const body = await page.textContent('[data-testid="inspector"]');
  ok('wall inspector names corners', /corner 1 to corner 2/.test(body), body.slice(0, 100));
  await U(() => window.__rp.useUi.getState().select(null));

  console.log('Back to rectangle is refused silently? (non-rect detaches items, rect restores)');
  await U(() => { const s = window.__rp.useProject.getState(); s.revertToRectangle(); });
  p = await P();
  ok('outline cleared, width/depth kept as bounding box', !p.room.outline && p.room.width > 0 && p.room.depth > 0);

  console.log('Custom furniture shape editor');
  await U(() => window.__rp.useUi.getState().setMode('furniture'));
  await page.click('[data-testid^="tpl-"] >> nth=0').catch(() => {});
  await page.click('button:has-text("Draw a custom shape")');
  await page.waitForSelector('[data-testid="shape-editor"]');
  ok('editor opens with a 4-corner rectangle', (await page.$$('[data-testid="shape-corners"] > div')).length === 4);
  await page.click('[data-testid="shape-editor"] button:has-text("L-shape")');
  await page.waitForTimeout(100);
  ok('L-shape preset has 6 corners', (await page.$$('[data-testid="shape-corners"] > div')).length === 6);
  // click on the canvas edge to add a corner
  const svg = await page.$('[data-testid="shape-svg"]');
  const sb = await svg.boundingBox();
  await shot(page, 'shape-editor');
  const hv = await page.$('[data-testid="shape-svg"] [data-v="1"]');
  const hb = await hv.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2, { steps: 4 }); await page.mouse.up();
  await page.fill('input[placeholder="Name"]', 'Corner sofa'); await page.keyboard.press('Enter');
  await page.click('[data-testid="shape-editor"] button:has-text("Add to library")');
  await page.waitForTimeout(250);
  p = await P();
  const tpl = p.customTemplates.find(t => t.name === 'Corner sofa');
  ok('template saved as a polygon', tpl && tpl.shape.kind === 'polygon' && tpl.shape.vertices.length === 6, JSON.stringify(tpl && tpl.shape).slice(0, 80));
  const placed = p.layouts[0].furniture.find(f => f.name === 'Corner sofa');
  ok('and placed on the plan with matching bbox size', placed && near(placed.width, tpl.width) && near(placed.depth, tpl.depth));
  ok('editor closed', !(await page.$('[data-testid="shape-editor"]')));
  ok('width reflects the dragged corner (wider than the 48" preset)', tpl.width > 48.5, String(tpl.width));
  await shot(page, 'polygon-on-plan');

  console.log('Edit footprint of a placed item');
  await U((id) => window.__rp.useUi.getState().select({ kind: 'furniture', id }), placed.id);
  await page.waitForTimeout(200);
  await page.click('button:has-text("Edit footprint")');
  await page.waitForSelector('[data-testid="shape-editor"]');
  await page.click('[data-testid="shape-editor"] button:has-text("U-shape")');
  await page.click('[data-testid="shape-editor"] button:has-text("Apply")');
  await page.waitForTimeout(200);
  p = await P();
  const edited = p.layouts[0].furniture.find(f => f.id === placed.id);
  ok('item reshaped to the 8-corner U', edited.shape.vertices.length === 8 && near(edited.width, 60) && near(edited.depth, 36));
  await U(() => window.__rp.useProject.getState().undo());
  p = await P();
  ok('reshape is undoable', p.layouts[0].furniture.find(f => f.id === placed.id).shape.vertices.length === 6);

  console.log('Self-crossing shape cannot be saved');
  await page.click('button:has-text("Edit footprint")');
  await page.waitForSelector('[data-testid="shape-editor"]');
  const inputs = await page.$$('[data-testid="shape-corners"] input');
  await inputs[0].fill('100'); await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const dis = await page.$eval('[data-testid="shape-editor"] button:has-text("Apply")', (b) => b.disabled);
  ok('Apply disabled while edges cross', dis === true || (await page.$('[role="alert"]')) !== null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  ok('Escape closes the editor', !(await page.$('[data-testid="shape-editor"]')));

  console.log('Reference photo');
  await U(() => window.__rp.useUi.getState().setMode('room'));
  await page.waitForTimeout(150);
  // 200 x 100 px PNG with a 100px-wide black square
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#9ec5e8'; g.fillRect(0, 0, 200, 100); g.fillStyle = '#000'; g.fillRect(50, 25, 100, 50); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('[data-testid="ref-file"]', { name: 'office.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => window.__rp.useProject.getState().project.reference);
  p = await P();
  ok('photo stored, not calibrated', p.reference && p.reference.calibrated === false && p.reference.naturalWidth === 200);
  ok('badge says Not to scale', /Not to scale/.test(await page.textContent('body')));
  await U(() => window.__rp.useUi.getState().sendCanvasCmd('fit')); await page.waitForTimeout(250);
  ok('image drawn under the plan', (await page.$$('svg image')).length === 1);
  await shot(page, 'reference-uncalibrated');

  // calibrate: the black square's width (100px) is really 48"
  await page.click('button:has-text("Calibrate scale")');
  const ipp0 = p.reference.inchesPerPixel;
  const world = (wx, wy) => page.evaluate(([x, y]) => { const u = window.__rp.useUi.getState().viewport; const r = document.querySelector('[data-testid="plan-canvas"]').getBoundingClientRect(); return { x: r.left + u.panX + x * u.zoom, y: r.top + u.panY + y * u.zoom }; }, [wx, wy]);
  const ax = p.reference.x + 50 * ipp0, ay = p.reference.y + 50 * ipp0;
  const bx = p.reference.x + 150 * ipp0;
  let s1 = await world(ax, ay), s2 = await world(bx, ay);
  await page.mouse.click(s1.x, s1.y); await page.mouse.click(s2.x, s2.y);
  await page.waitForTimeout(150);
  const inp = await page.$('[data-testid="ref-real"]');
  await inp.click(); await inp.fill('48'); await page.keyboard.press('Enter');
  await page.click('button:has-text("Apply")');
  await page.waitForTimeout(150);
  p = await P();
  ok('calibrated to 0.48 in/px (48" / 100px)', p.reference.calibrated && near(p.reference.inchesPerPixel, 0.48, 0.005), String(p.reference.inchesPerPixel));
  ok('point A stayed put while scaling', near(p.reference.x + 50 * p.reference.inchesPerPixel, ax, 0.05), `${p.reference.x + 50 * p.reference.inchesPerPixel} vs ${ax}`);
  ok('badge now Calibrated', /Calibrated/.test(await page.textContent('body')));
  const histBefore = await U(() => window.__rp.useProject.getState().past.length);
  await page.click('button:has-text("Move photo")');
  const b0 = p.reference.x;
  const imgBox = await (await page.$('svg image')).boundingBox();
  await page.mouse.move(imgBox.x + 30, imgBox.y + 30);
  await page.mouse.down(); await page.mouse.move(imgBox.x + 90, imgBox.y + 60, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(150);
  p = await P();
  ok('dragging moves the photo (one undo step)', p.reference.x > b0 && (await U(() => window.__rp.useProject.getState().past.length)) === histBefore + 1);
  await page.click('button:has-text("Done moving")');
  // persists through JSON export/import
  const json = await U(() => { const s = window.__rp.useProject.getState(); return JSON.stringify({ format: 'room-planner-project', version: 1, project: s.project }); });
  const imp = await U((j) => { const r = JSON.parse(j).project.reference; const cur = window.__rp.useProject.getState().project.reference; return !!r && r.dataUrl === cur.dataUrl && r.calibrated === true && r.inchesPerPixel === cur.inchesPerPixel; }, json);
  ok('reference round-trips through the project JSON', imp === true);

  console.log('PDF export');
  await U(() => window.__rp.useUi.getState().setMode('furniture'));
  await page.click('button[aria-label="Project menu"]');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('text=Export PDF (to scale)')]);
  const path = '/tmp/claude-0/shots/plan.pdf';
  await dl.saveAs(path);
  const buf = fs.readFileSync(path);
  ok('PDF downloaded with %PDF header', buf.slice(0, 5).toString() === '%PDF-', String(buf.length));
  ok('PDF has a scale note and schedule page', /Scale 1:\d+/.test(buf.toString('latin1')) && /Furniture schedule/.test(buf.toString('latin1')));

  console.log('Console clean');
  ok('no page or console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(summary() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
