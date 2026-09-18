// Loads the REAL MediaPipe hand landmarker on an actual GPU and measures what it costs.
//
// The end-to-end check stubs the model, which is right for testing gesture logic but leaves the
// whole real path — dynamic import, FilesetResolver, wasm and model fetch, createFromOptions,
// detectForVideo — unexercised. This closes that gap and answers the only question the stub
// cannot: whether hand tracking fits in the frame budget next to the renderer.
//
// Usage: node tools/hand-perf.mjs [baseUrl]
import { chromium } from 'playwright';
import { fakeCamera } from './fake-camera.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5287/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const log = (...a) => console.log('[hand-perf]', ...a);
let failures = 0;
const check = (ok, label, detail = '') => {
  log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('page error', e.message));
await page.addInitScript(() => {
  window.__neonTest = {};
});
// Real camera frames, but no stubbed detector: the genuine model runs against them.
await page.addInitScript(fakeCamera);
await page.goto(base);

const hand = () => page.evaluate(() => window.__neonTest.hand());

const t0 = Date.now();
await page.click('[data-action=hand]');
await page.waitForSelector('.hand-screen');
await page.click('[data-action=hand-enable]');
const loaded = await page
  .waitForFunction(() => window.__neonTest.hand().model === 'ready', null, { timeout: 90000, polling: 200 })
  .then(() => true)
  .catch(() => false);
check(loaded, 'the real hand landmarker loads', loaded ? `${((Date.now() - t0) / 1000).toFixed(1)}s` : JSON.stringify(await hand()));
if (!loaded) {
  await browser.close();
  process.exit(1);
}

// Let it run against live frames long enough for the cost average to settle.
await page.waitForTimeout(6000);
const s = await hand();
log(`camera ${s.fps.toFixed(0)}fps, inference + mapping ${s.cost.toFixed(1)}ms/frame`);
check(s.cost > 0, 'the model is actually running each frame', `${s.cost.toFixed(2)}ms`);
// The renderer owns the rest of a 16ms frame; anything past this and hand tracking is the
// bottleneck rather than a passenger.
check(s.cost < 12, 'inference fits in the frame budget', `${s.cost.toFixed(1)}ms`);
check(s.fps > 20, 'the page still runs at a usable frame rate with the model live', `${s.fps.toFixed(0)}fps`);

// The room has no hands in it, so the detector must report none rather than inventing some.
check(s.hands === 0, 'no hands are reported in an empty room', `${s.hands}`);
check(s.status !== 'tracking', 'the mapper does not claim tracking without hands', s.status);

/** Samples real animation-frame cadence for a while: what the player actually feels. */
async function renderFps(ms = 4000) {
  await page.evaluate((d) => {
    window.__fps = { frames: 0, done: false };
    const t0 = performance.now();
    const step = () => {
      window.__fps.frames++;
      if (performance.now() - t0 >= d) {
        window.__fps.done = true;
        window.__fps.elapsed = performance.now() - t0;
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, ms);
  await page.waitForFunction(() => window.__fps.done, null, { timeout: ms + 8000 });
  const r = await page.evaluate(() => window.__fps);
  return (r.frames / r.elapsed) * 1000;
}

// --- What it costs during actual play --------------------------------------
await page.click('[data-action=hand-done]');
await page.waitForSelector('.title-screen, .worlds-screen', { timeout: 8000 });
if (await page.isVisible('[data-action=campaign]')) await page.click('[data-action=campaign]');
await page.waitForSelector('.worlds-screen');
await page.click('[data-action=road]');
await page.waitForFunction(() => document.querySelector('.hud-timer')?.textContent !== '00:00.00', null, { timeout: 15000 });
await page.waitForTimeout(1500);
const withModel = await renderFps();
log(`in-game render rate with hand tracking live: ${withModel.toFixed(0)}fps`);

// Same road, tracking switched off, as the baseline to compare against.
await page.evaluate(() => window.__neonTest.stopHand?.());
await page.waitForTimeout(1500);
const without = await renderFps();
log(`in-game render rate with hand tracking off:  ${without.toFixed(0)}fps`);
check(withModel > 45, 'the game still renders smoothly while hand tracking runs', `${withModel.toFixed(0)}fps`);
check(withModel > without * 0.7, 'hand tracking costs less than a third of the frame rate', `${withModel.toFixed(0)} vs ${without.toFixed(0)}fps`);

await browser.close();
log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
