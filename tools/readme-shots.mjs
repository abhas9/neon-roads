// Captures README screenshots on the real GPU (installed Chrome).
// Usage: node tools/readme-shots.mjs <baseUrl> [w1r1-tape.json from tools/solve-tape.ts]
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { fakeCamera } from './fake-camera.mjs';
import { fakeHands } from './fake-hands.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5287/';
const tapeInfo = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : null;
const out = 'docs/screenshots';
const roads = {};
const medals = [4, 3, 3, 2, 4, 3, 1, 2, 3, 0, 2, 3, 1, 0, 0];
for (let w = 1; w <= 10; w++) for (let r = 1; r <= 3; r++) {
  const i = (w - 1) * 3 + (r - 1);
  if (i < medals.length && medals[i] > 0) roads[`w${w}r${r}`] = { best: 14 + i * 1.37, medal: medals[i], completions: 1, attempts: 4 };
}
const save = { v: 1, roads, settings: { music: 0, sfx: 0, jumpAssist: false, ghost: true, shake: true, bloom: true, quality: 'high', touchControls: 'off' }, endless: { best: 2480 }, daily: {}, seenHelp: true };
const unlocked = { ...save, roads: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`w${Math.floor(i / 3) + 1}r${(i % 3) + 1}`, { best: 20, medal: 0, completions: 1, attempts: 1 }])) };

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const jpeg = { type: 'jpeg', quality: 86 };

async function desktop(saveData) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((s) => localStorage.setItem('neon-roads-save-v1', s), JSON.stringify(saveData));
  const page = await ctx.newPage();
  return { ctx, page };
}

async function drive(page, world, road, { seconds = 2.5, jumpAt = null, steer = null } = {}) {
  await page.goto(base);
  await page.waitForTimeout(700);
  await page.click('[data-action=campaign]');
  await page.click(`[data-action=road][data-world="${world}"][data-road="${road}"]`);
  await page.waitForTimeout(1250);
  await page.keyboard.down('ArrowUp');
  const t0 = Date.now();
  let jumped = false;
  let steered = false;
  while (Date.now() - t0 < seconds * 1000) {
    const t = (Date.now() - t0) / 1000;
    if (jumpAt !== null && !jumped && t >= jumpAt) {
      await page.keyboard.press('Space');
      jumped = true;
    }
    if (steer && !steered && t >= steer.at) {
      await page.keyboard.down(steer.key);
      steered = true;
    }
    await page.waitForTimeout(16);
  }
}

// Title, campaign and gameplay.
{
  const { ctx, page } = await desktop(save);
  await page.goto(base);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/title.jpg`, ...jpeg });
  await page.click('[data-action=campaign]');
  await page.waitForTimeout(900);
  await page.mouse.move(640, 700);
  await page.screenshot({ path: `${out}/campaign.jpg`, ...jpeg });
  await ctx.close();
}
{
  const { ctx, page } = await desktop(unlocked);
  await drive(page, 0, 0, { seconds: 2.3, jumpAt: 2.05 });
  await page.screenshot({ path: `${out}/gameplay.jpg`, ...jpeg });
  await drive(page, 1, 0, { seconds: 3.1 });
  await page.screenshot({ path: `${out}/solar-forge.jpg`, ...jpeg });
  await drive(page, 3, 1, { seconds: 1.3 });
  await page.screenshot({ path: `${out}/ion-drift.jpg`, ...jpeg });
  await drive(page, 8, 1, { seconds: 1.6, jumpAt: 1.2 });
  await page.screenshot({ path: `${out}/event-horizon.jpg`, ...jpeg });
  await drive(page, 2, 1, { seconds: 2.6, jumpAt: 2.3 });
  await page.screenshot({ path: `${out}/glass-moon.jpg`, ...jpeg });
  await drive(page, 9, 2, { seconds: 2.0 });
  await page.screenshot({ path: `${out}/neon-core.jpg`, ...jpeg });
  // Open Graph image (1200x630).
  await drive(page, 0, 0, { seconds: 2.3, jumpAt: 2.05 });
  await page.screenshot({ path: 'public/og-image.jpg', ...jpeg, clip: { x: 40, y: 45, width: 1200, height: 630 } });
  await ctx.close();
}

// Victory fireworks, results with Share on X, and the holographic ghost (needs a winning tape).
if (tapeInfo) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((auto) => {
    window.__neonTest = { autoplay: { roadId: auto.roadId, tape: auto.tape } };
    localStorage.setItem('neon-roads-save-v1', JSON.stringify({ v: 1, roads: {}, settings: { music: 0, sfx: 0, jumpAssist: false, ghost: true, shake: true, bloom: true, quality: 'high', touchControls: 'off' }, endless: { best: 0 }, daily: {}, seenHelp: true }));
  }, tapeInfo);
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForTimeout(700);
  await page.click('[data-action=campaign]');
  await page.click('[data-action=road][data-world="0"][data-road="0"]');
  await page.waitForFunction(() => window.__neonTest.fireworkLoad() > 0, null, { timeout: 45000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}/fireworks.jpg`, ...jpeg });
  await page.waitForSelector('.results-screen');
  await page.waitForTimeout(1600);
  await page.focus('[data-action=share]');
  await page.screenshot({ path: `${out}/results-share.jpg`, ...jpeg });
  // Race the saved ghost: ease off the throttle so the hologram pulls ahead.
  await page.keyboard.press('KeyR');
  // Throttle is held through the intro so both ships launch together; a short lift lets the ghost edge ahead.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1100 + 900);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(110);
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(170);
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/ghost.jpg`, ...jpeg });
  await page.keyboard.up('ArrowUp');
  await ctx.close();
}

// Phone controller: pairing screen on desktop, pad on a phone, over real WebRTC.
{
  const { ctx, page: host } = await desktop(save);
  await host.goto(base);
  await host.waitForTimeout(900);
  await host.click('[data-action=phone]');
  await host.waitForSelector('.pair-status.ready', { timeout: 30000 });
  await host.waitForTimeout(600);
  await host.screenshot({ path: `${out}/phone-pairing.jpg`, ...jpeg });
  const code = (await host.textContent('.pair-code')).trim();
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const phone = await phoneCtx.newPage();
  await phone.goto(`${base}controller.html#${code}`);
  await phone.waitForSelector('.screen-pad', { timeout: 30000 });
  await phone.dispatchEvent('[data-btn=back]', 'pointerdown');
  await phone.dispatchEvent('[data-btn=confirm]', 'pointerdown');
  await host.waitForSelector('.worlds-screen');
  await phone.dispatchEvent('[data-btn=confirm]', 'pointerdown');
  await phone.waitForSelector('.mode-game', { timeout: 8000 });
  await phone.waitForTimeout(1600);
  await phone.evaluate(() => {
    const el = document.querySelector('.stick');
    el.setPointerCapture = () => {};
    const r = el.getBoundingClientRect();
    const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 3, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    ev('pointerdown', r.left + r.width * 0.45, r.top + r.height * 0.6);
    ev('pointermove', r.left + r.width * 0.45 + 30, r.top + r.height * 0.6 - 55);
  });
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: `${out}/phone-pad.jpg`, ...jpeg });
  await host.screenshot({ path: `${out}/phone-driving.jpg`, ...jpeg });
  await phoneCtx.close();
  await ctx.close();
}

// Wand controller: the setup screen with a synthetic camera standing in for a webcam.
{
  const { ctx, page } = await desktop(unlocked);
  await ctx.addInitScript(fakeCamera);
  await page.goto(base);
  await page.waitForTimeout(900);
  await page.click('[data-action=wand]');
  await page.waitForSelector('.wand-screen');
  await page.click('[data-action=wand-enable]');
  await page.waitForSelector('[data-action=wand-calibrate]', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/wand-calibrate.jpg`, ...jpeg });
  await page.click('[data-action=wand-calibrate]');
  await page.waitForSelector('[data-action=wand-recentre]', { timeout: 20000 });
  await page.evaluate(() => window.__wand.set({ angle: 0.45, half: 0.168 }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/wand-tuning.jpg`, ...jpeg });
  await ctx.close();
}

// Hand controller, with a synthetic detector so the shot needs no model download.
{
  const { ctx, page } = await desktop(unlocked);
  await ctx.addInitScript(fakeCamera);
  await ctx.addInitScript(fakeHands);
  await page.goto(base);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__wand.set({ visible: false }));
  await page.click('[data-action=hand]');
  await page.waitForSelector('.hand-screen');
  await page.click('[data-action=hand-enable]');
  await page.waitForSelector('[data-action=hand-recentre]', { timeout: 20000 });
  await page.evaluate(() => window.__hands.set({ right: { x: -0.33, y: 0.09 }, left: { curl: 1 } }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/hand-tuning.jpg`, ...jpeg });
  await ctx.close();
}

// The printable marker sheet.
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 660 } });
  const page = await ctx.newPage();
  await page.goto(`${base}marker.html`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/wand-marker.jpg`, ...jpeg });
  await ctx.close();
}

// Mobile portrait with touch controls.
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript((s) => localStorage.setItem('neon-roads-save-v1', s), JSON.stringify({ ...unlocked, settings: { ...unlocked.settings, touchControls: 'on' } }));
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForTimeout(1000);
  await page.tap('[data-action=campaign]');
  await page.waitForTimeout(400);
  await page.tap('[data-action=road][data-world="3"][data-road="1"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/mobile.jpg`, ...jpeg });
  await ctx.close();
}
await browser.close();
console.log('done');
