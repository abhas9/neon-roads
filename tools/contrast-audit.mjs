// WCAG contrast audit of every visible UI text on every screen, measured against what is actually
// rendered behind it (including the live WebGL scene). Runs in installed Chrome on the real GPU.
// Usage: node tools/contrast-audit.mjs [baseUrl] [tape.json]   (tape enables the results screen)
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5287/';
const tapeInfo = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : null;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

const progress = {};
['w1r1', 'w1r2', 'w1r3', 'w2r1', 'w2r2', 'w3r1'].forEach((id, i) => (progress[id] = { best: 18 + i, medal: (i % 4) + 1, completions: 1, attempts: 3 }));
const allRoads = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`w${Math.floor(i / 3) + 1}r${(i % 3) + 1}`, { best: 20 + i, medal: (i % 4) + 1, completions: 1, attempts: 2 }]));
const saveWith = (roads, settings = {}) =>
  JSON.stringify({ v: 1, roads, settings: { music: 0, sfx: 0, jumpAssist: true, ghost: true, shake: true, bloom: true, quality: 'high', touchControls: 'auto', ...settings }, endless: { best: 812 }, daily: {}, seenHelp: true });

/** Collects text boxes, hides all text to capture the true background, then scores each box. */
async function audit(page, label) {
  await page.waitForTimeout(250);
  // Measure the settled UI: let fade/scale-in animations finish (infinite ones like blinking are left running).
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 1500)),
    ]),
  );
  const items = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || el.closest('.hidden,script,style,noscript,#boot')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width < 3 || r.height < 3 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
        let opacity = 1;
        for (let e = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
        let filterDim = 1;
        for (let e = el; e; e = e.parentElement) {
          const m = /brightness\(([\d.]+)\)/.exec(getComputedStyle(e).filter);
          if (m) filterDim *= parseFloat(m[1]);
        }
        if (opacity < 0.05) continue;
        const clip = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text';
        const cls = (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
        out.push({ text: text.slice(0, 32), sel: `${el.tagName.toLowerCase()}${cls}`, color: cs.color, opacity, filterDim, clip, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10), rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }
    }
    return out;
  });
  const shot = async () => (await page.screenshot({ type: 'png' })).toString('base64');
  await page.addStyleTag({ content: '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important}' }).then((h) => h.evaluate((n) => n.setAttribute('data-audit', '1')));
  await page.waitForTimeout(60);
  const bg = await shot();
  await page.evaluate(() => document.querySelectorAll('style[data-audit]').forEach((s) => s.remove()));
  const results = await page.evaluate(async ({ bg, items }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${bg}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const scale = img.width / innerWidth;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    return items.map((it) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(it.color);
      if (!m || it.clip) return null;
      const alpha = (m[4] === undefined ? 1 : parseFloat(m[4])) * it.opacity;
      const { x, y, w, h } = it.rect;
      const d = g.getImageData(Math.max(0, Math.floor(x * scale)), Math.max(0, Math.floor(y * scale)), Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale))).data;
      const px = [];
      const step = Math.max(1, Math.floor(d.length / 4 / 600)) * 4;
      for (let i = 0; i < d.length; i += step) px.push([d[i], d[i + 1], d[i + 2]]);
      if (!px.length) return null;
      px.sort((a, b) => lum(...a) - lum(...b));
      const med = px[Math.floor(px.length / 2)];
      const hi = px[Math.floor(px.length * 0.85)];
      const lo = px[Math.floor(px.length * 0.15)];
      const tr = +m[1] * it.filterDim, tg = +m[2] * it.filterDim, tb = +m[3] * it.filterDim;
      const blend = (t, b) => alpha * t + (1 - alpha) * b;
      const text = [blend(tr, med[0]), blend(tg, med[1]), blend(tb, med[2])];
      const lt = lum(...text);
      const lighter = lt >= lum(...med);
      const ref = lighter ? hi : lo;
      const lb = lum(...ref);
      const ratio = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
      const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
      return { ...it, ratio, need: large ? 3 : 4.5 };
    }).filter(Boolean);
  }, { bg, items });
  const fails = results.filter((r) => r.ratio < r.need);
  report.push({ label, total: results.length, fails });
  const worst = [...fails].sort((a, b) => a.ratio - b.ratio);
  console.log(`\n${fails.length ? '✘' : '✔'} ${label}: ${results.length} text boxes, ${fails.length} below AA`);
  const seen = new Set();
  for (const f of worst) {
    const key = `${f.sel}|${f.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`   ${f.ratio.toFixed(2)} < ${f.need}  ${f.sel.padEnd(34)} "${f.text}" (${f.size}px)`);
  }
}

const report = [];
const desktop = async (roads = progress, extraInit = null, settings = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(({ s, e }) => { if (!localStorage.getItem('neon-roads-audit')) { localStorage.setItem('neon-roads-save-v1', s); localStorage.setItem('neon-roads-audit', '1'); } if (e) window.__neonTest = e; }, { s: saveWith(roads, settings), e: extraInit });
  return { ctx, page: await ctx.newPage() };
};

{
  const { ctx, page } = await desktop();
  await page.goto(base);
  await page.waitForTimeout(1500);
  await audit(page, 'Title (Launch Ring backdrop)');
  await page.click('[data-action=campaign]');
  await audit(page, 'Campaign (Launch Ring backdrop)');
  await page.hover('.world-card[data-world="2"]');
  await audit(page, 'Campaign (Glass Moon backdrop)');
  await page.click('[data-action=back]');
  await audit(page, 'Title (Glass Moon backdrop)');
  await page.click('[data-action=campaign]');
  await page.hover('.world-card[data-world="1"]');
  await page.click('[data-action=back]');
  await audit(page, 'Title (Solar Forge backdrop)');
  await page.click('[data-action=settings]');
  await audit(page, 'Settings');
  await page.click('[data-action=back]');
  await page.click('[data-action=help]');
  await audit(page, 'How to play');
  await page.click('[data-action=back]');
  await page.click('[data-action=phone]');
  await page.waitForSelector('.pair-status.ready', { timeout: 30000 }).catch(() => {});
  await audit(page, 'Phone pairing');
  await ctx.close();
}
{
  const { ctx, page } = await desktop(allRoads);
  for (const [w, r, name] of [[0, 0, 'Launch Ring'], [1, 0, 'Solar Forge'], [2, 1, 'Glass Moon'], [3, 1, 'Ion Drift'], [5, 0, 'Orbital Yard'], [9, 2, 'Neon Core']]) {
    await page.goto(base);
    await page.waitForTimeout(500);
    await page.click('[data-action=campaign]');
    await page.click(`[data-action=road][data-world="${w}"][data-road="${r}"]`);
    await page.waitForSelector('.hud:not(.hidden)');
    await page.waitForTimeout(400);
    await audit(page, `HUD intro title (${name})`);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1600);
    await audit(page, `HUD driving (${name})`);
    await page.keyboard.up('ArrowUp');
    if (w === 0) {
      await page.keyboard.press('Escape');
      await audit(page, 'Pause');
      await page.keyboard.press('Escape');
    }
  }
  // Death message over the crash explosion: Scaffold opens with a half-block wall at row 24.
  await page.goto(base);
  await page.waitForTimeout(500);
  await page.click('[data-action=campaign]');
  await page.click('[data-action=road][data-world="5"][data-road="0"]');
  await page.waitForSelector('.hud:not(.hidden)');
  await page.keyboard.down('ArrowUp');
  await page.waitForSelector('.hud-msg.bad', { timeout: 15000 });
  await page.keyboard.up('ArrowUp');
  await audit(page, 'Crash message over explosion (Orbital Yard)');
  // Endless results after driving off the road.
  await page.goto(base);
  await page.waitForTimeout(500);
  await page.click('[data-action=endless]');
  await page.waitForTimeout(1300);
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowLeft');
  await page.waitForSelector('.results-screen', { timeout: 15000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('ArrowLeft');
  await audit(page, 'Endless results');
  await ctx.close();
}

if (tapeInfo) {
  // The tape was recorded without jump assist, so replay it without assist.
  const { ctx, page } = await desktop({}, { autoplay: { roadId: tapeInfo.roadId, tape: tapeInfo.tape } }, { jumpAssist: false });
  await page.goto(base);
  await page.waitForTimeout(600);
  await page.click('[data-action=campaign]');
  await page.click('[data-action=road][data-world="0"][data-road="0"]');
  await page.waitForSelector('.results-screen', { timeout: 45000 });
  await page.waitForTimeout(1200);
  await audit(page, 'Results with fireworks');
  await ctx.close();
}

// Mobile portrait: title and touch HUD.
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript((s) => localStorage.setItem('neon-roads-save-v1', s), saveWith(progress));
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForTimeout(1200);
  await audit(page, 'Mobile title');
  await page.tap('[data-action=campaign]');
  await page.tap('[data-action=road][data-world="2"][data-road="0"]');
  await page.waitForTimeout(2500);
  await audit(page, 'Mobile HUD + touch controls (Glass Moon)');
  await ctx.close();
}

// Phone controller page: connect screen, menu pad and game pad.
{
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const phone = await ctx.newPage();
  await phone.goto(`${base}controller.html`);
  await audit(phone, 'Controller: connect');
  const { ctx: hctx, page: host } = await desktop();
  await host.goto(base);
  await host.click('[data-action=phone]');
  await host.waitForSelector('.pair-status.ready', { timeout: 30000 });
  const code = (await host.textContent('.pair-code')).trim();
  await phone.goto(`${base}controller.html#${code}`);
  await phone.waitForSelector('.screen-pad', { timeout: 30000 });
  await audit(phone, 'Controller: menu pad');
  await phone.dispatchEvent('[data-btn=back]', 'pointerdown');
  await phone.dispatchEvent('[data-btn=confirm]', 'pointerdown');
  await host.waitForSelector('.worlds-screen');
  await phone.dispatchEvent('[data-btn=confirm]', 'pointerdown');
  await phone.waitForSelector('.mode-game', { timeout: 8000 });
  await audit(phone, 'Controller: game pad');
  await phone.click('[data-act=settings]');
  await audit(phone, 'Controller: settings');
  await hctx.close();
  await ctx.close();
}

await browser.close();
const failing = report.filter((r) => r.fails.length);
console.log(`\n${failing.length ? '✘' : '✔'} ${report.length} screens audited, ${report.reduce((n, r) => n + r.total, 0)} text boxes, ${report.reduce((n, r) => n + r.fails.length, 0)} below WCAG AA`);
process.exit(failing.length ? 1 : 0);
