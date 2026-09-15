// Regression check on a real GPU (installed Chrome + ANGLE Metal): every world renders, the ship is
// visible, and bloom never produces invalid pixels. Usage: node tools/gpu-check.mjs <outDir> [baseUrl]
import { chromium } from 'playwright';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://127.0.0.1:5287/';
const roads = {};
for (let w = 1; w <= 10; w++) for (let r = 1; r <= 3; r++) roads[`w${w}r${r}`] = { best: 30, medal: 1, completions: 1, attempts: 1 };
const save = { v: 1, roads, settings: { music: 0, sfx: 0, jumpAssist: false, ghost: true, shake: true, bloom: true, quality: 'high', touchControls: 'off' }, endless: { best: 0 }, daily: {}, seenHelp: true };

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await ctx.addInitScript((s) => localStorage.setItem('neon-roads-save-v1', s), JSON.stringify(save));
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (/Bloom produced invalid|THREE\.|WebGL|GL_INVALID/i.test(m.text())) problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(base);
console.log('GPU:', await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

// Sample the centre of the final canvas where the ship sits; a black-out reads as near-zero.
const shipAreaBrightness = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
  const src = document.getElementById('game');
  const c = document.createElement('canvas');
  c.width = 64; c.height = 36;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, 64, 36);
  const d = g.getImageData(22, 18, 20, 14).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  resolve(sum / (d.length / 4) / 3);
})));

const shots = [[0, 0], [1, 0], [2, 2], [3, 1], [5, 1], [8, 1], [9, 2]];
let failed = 0;
for (const [w, r] of shots) {
  await page.goto(base);
  await page.waitForTimeout(600);
  await page.click('[data-action=campaign]');
  await page.click(`[data-action=road][data-world="${w}"][data-road="${r}"]`);
  await page.waitForTimeout(2500);
  const idle = await shipAreaBrightness();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  const moving = await shipAreaBrightness();
  await page.keyboard.up('ArrowUp');
  await page.screenshot({ path: `${out}/gpu-world${w + 1}.png` });
  const ok = idle > 12 && moving > 12;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✘'} world ${w + 1} road ${r + 1}: centre brightness idle=${idle.toFixed(1)} moving=${moving.toFixed(1)}`);
}
await browser.close();
if (problems.length) console.log('console problems:\n  ' + [...new Set(problems)].join('\n  '));
process.exit(failed || problems.length ? 1 : 0);
