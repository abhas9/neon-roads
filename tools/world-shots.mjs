import { chromium, devices } from 'playwright';
const out = process.argv[2];
const base = 'http://127.0.0.1:5287/';
const roads = {};
for (let w = 1; w <= 10; w++) for (let r = 1; r <= 3; r++) roads[`w${w}r${r}`] = { best: 30, medal: (w + r) % 5, completions: 1, attempts: 3 };
const save = { v: 1, roads, settings: { music: 0, sfx: 0, jumpAssist: false, ghost: true, shake: true, bloom: true, quality: 'high', touchControls: 'auto' }, endless: { best: 1234 }, daily: {}, seenHelp: true };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript((s) => localStorage.setItem('neon-roads-save-v1', s), JSON.stringify(save));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const shots = [[1, 2, 2.2], [2, 0, 2.8], [3, 2, 1.2], [4, 1, 1.8], [5, 0, 2.2], [6, 1, 1.5], [7, 1, 2.4], [8, 2, 1.0], [9, 1, 2.0], [10, 2, 2.2]];
for (const [w, r, secs] of shots) {
  await page.goto(base);
  await page.waitForTimeout(800);
  await page.click('[data-action=campaign]');
  await page.click(`[data-action=road][data-world="${w - 1}"][data-road="${r}"]`);
  await page.waitForTimeout(1200);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(secs * 1000);
  await page.screenshot({ path: `${out}/world${w}.png` });
  await page.keyboard.up('ArrowUp');
}
// Worlds grid with progress, help, settings.
await page.goto(base);
await page.waitForTimeout(800);
await page.click('[data-action=campaign]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/worlds-progress.png` });
await page.goto(base);
await page.click('[data-action=help]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/help.png` });
// Mobile portrait with touch controls.
const m = await browser.newContext({ ...devices['iPhone 13'] });
await m.addInitScript((s) => localStorage.setItem('neon-roads-save-v1', s), JSON.stringify(save));
const mp = await m.newPage();
await mp.goto(base);
await mp.waitForTimeout(1200);
await mp.screenshot({ path: `${out}/mobile-title.png` });
await mp.tap('[data-action=campaign]');
await mp.waitForTimeout(500);
await mp.tap('[data-action=road][data-world="0"][data-road="0"]');
await mp.waitForTimeout(2500);
await mp.screenshot({ path: `${out}/mobile-play.png` });
await browser.close();
