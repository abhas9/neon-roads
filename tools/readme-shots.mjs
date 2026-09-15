// Captures README screenshots on the real GPU (installed Chrome). Usage: node tools/readme-shots.mjs <baseUrl>
import { chromium, devices } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5287/';
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
