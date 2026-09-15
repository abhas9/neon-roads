// End-to-end on a real GPU: finish a road with a solver tape, check fireworks + results, Share on X
// (clipboard scorecard and post link), then retry and check the holographic ghost and its toggle.
// Usage: node tools/celebration-e2e.mjs <baseUrl> <tape.json> [screenshotDir]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5287/';
const tapeInfo = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const shots = process.argv[4];
const log = (...a) => console.log('[celebrate]', ...a);
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
await ctx.addInitScript((auto) => {
  window.__neonTest = { autoplay: { roadId: auto.roadId, tape: auto.tape } };
}, tapeInfo);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || /Bloom produced invalid/.test(m.text())) problems.push(m.text()); });

await page.goto(base);
await page.waitForTimeout(700);
await page.click('[data-action=campaign]');
await page.click(`[data-action=road][data-world="0"][data-road="0"]`);
log(`autoplaying ${tapeInfo.roadId} (solver time ${tapeInfo.time.toFixed(2)}s)`);

// Fireworks start at the finish gate, before the results screen appears.
await page.waitForFunction(() => window.__neonTest.fireworkLoad() > 0, null, { timeout: 45000 });
log('fireworks launched at the finish gate');
await page.waitForSelector('.results-screen', { timeout: 10000 });
const time = (await page.textContent('.result-time')).trim();
const medal = (await page.textContent('.result-medal-name')).trim();
log(`results: ${time} ${medal}`);
if (!time.startsWith(new Date(tapeInfo.time * 1000).toISOString().slice(14, 19))) fail(`unexpected finish time ${time}`);
await page.waitForTimeout(1800);
const loadAfter = await page.evaluate(() => window.__neonTest.fireworkLoad());
log(`fireworks still going behind results: load=${loadAfter}`);
if (loadAfter <= 0) fail('fireworks stopped behind the results screen');
if (shots) await page.screenshot({ path: `${shots}/celebration.jpg`, type: 'jpeg', quality: 86 });
const note = await page.textContent('.ghost-note');
if (!/Ghost saved/.test(note)) fail(`ghost note missing: ${note}`);

// Share on X.
const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-action=share]')]);
const intent = new URL(popup.url());
await popup.close();
const text = intent.searchParams.get('text') ?? '';
log(`post link: ${intent.origin}${intent.pathname}, url=${intent.searchParams.get('url')}`);
if (intent.hostname !== 'x.com' || !intent.pathname.startsWith('/intent/')) fail(`unexpected share URL ${intent}`);
for (const needle of [time, 'Fuel', 'O₂', 'First Light']) if (!text.includes(needle)) fail(`post text missing "${needle}"`);
if (!intent.searchParams.get('url')?.startsWith('http')) fail('post has no game URL');
const clip = await page.evaluate(() => navigator.clipboard.readText());
if (!clip.includes('N E O N   R O A D S') || !clip.includes(time) || !clip.includes('FUEL') || !clip.includes('Race me: http')) fail('clipboard scorecard incomplete');
log('clipboard scorecard:\n' + clip);

// Ghost saved with the run, including the assist flag used for replay.
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('neon-roads-save-v1')).roads.w1r1);
if (!saved?.ghost || saved.ghostAssist !== false) fail('ghost tape not saved with assist flag');

// Retry with live keyboard input: the hologram of the solver run should pull ahead.
await page.keyboard.press('KeyR');
await page.waitForSelector('.hud:not(.hidden)');
await page.waitForFunction(() => document.querySelector('.hud-timer')?.textContent !== '00:00.00', null, { timeout: 10000 });
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(1300);
const chip = (await page.textContent('.ghost-chip')).trim();
log(`HUD ghost chip: ${chip}`);
if (!chip.startsWith('GHOST 00:')) fail(`ghost chip not showing best time: ${chip}`);
if (shots) await page.screenshot({ path: `${shots}/ghost.jpg`, type: 'jpeg', quality: 86 });
await page.keyboard.press('KeyG');
await page.waitForTimeout(150);
const off = (await page.textContent('.ghost-chip')).trim();
await page.keyboard.press('KeyG');
await page.waitForTimeout(150);
const on = (await page.textContent('.ghost-chip')).trim();
await page.keyboard.up('ArrowUp');
log(`toggle: ${off} -> ${on}`);
if (!off.includes('OFF') || !on.startsWith('GHOST 00:')) fail('G did not toggle the ghost');

await browser.close();
if (problems.length) fail(`console/page errors:\n  ${[...new Set(problems)].join('\n  ')}`);
if (!process.exitCode) log('PASS');
