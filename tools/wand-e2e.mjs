// End-to-end check for the camera wand controller.
//
// getUserMedia is stubbed with a canvas.captureStream, so the whole pipeline runs for real —
// video element, requestVideoFrameCallback, pixel readback, tracking, mapping, the simulation —
// against a marker whose pose the test controls exactly. No camera, no video fixtures, no ffmpeg.
//
// Frames are pumped manually (captureStream(0) + requestFrame) on a fixed interval rather than
// from rAF, so the synthetic camera keeps a steady rate even while the software GL renderer is
// busy, and assertions poll for convergence instead of sleeping for a guessed duration.
import { chromium } from 'playwright';
import { fakeCamera } from './fake-camera.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5287/';
// Skip post-processing: tracking runs on requestVideoFrameCallback, which is tied to the page's
// render cadence, and the software GL renderer would otherwise hold the whole pipeline at ~10fps.
const url = base + (base.includes('?') ? '&' : '?') + 'nopost';
const shots = process.argv[3];
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const log = (...a) => console.log('[wand]', ...a);
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
await page.addInitScript(fakeCamera);
await page.goto(url);

const wand = () => page.evaluate(() => window.__neonTest.wand());
const ship = () => page.evaluate(() => window.__neonTest.ship());
const screen = () => page.evaluate(() => window.__neonTest.screen());
const setPose = (p) => page.evaluate((v) => window.__wand.set(v), p);

/** Polls the live wand state until `predicate` holds, so timing never depends on frame rate. */
async function until(predicate, label, timeout = 8000) {
  try {
    await page.waitForFunction(predicate, null, { timeout, polling: 50 });
    return true;
  } catch {
    log(`  (timed out waiting for ${label}: ${JSON.stringify(await wand())})`);
    return false;
  }
}

// --- Camera and calibration -------------------------------------------------
await page.click('[data-action=wand]');
await page.waitForSelector('.wand-screen');
await page.click('[data-action=wand-enable]');
await page.waitForSelector('[data-action=wand-calibrate]', { timeout: 15000 });
log('camera started');
const sawColour = await until(
  () => Number(document.querySelector(".v-left")?.textContent) > 50 && Number(document.querySelector(".v-right")?.textContent) > 50,
  'live colour counts',
);
const counts = await page.evaluate(() => ({
  a: Number(document.querySelector('.v-left')?.textContent),
  b: Number(document.querySelector('.v-right')?.textContent),
}));
check(sawColour, 'both marker colours show in the live calibration readout', JSON.stringify(counts));
if (shots) await page.screenshot({ path: `${shots}/wand-calibrate.png` });

await page.click('[data-action=wand-calibrate]');
await page.waitForSelector('[data-action=wand-recentre]', { timeout: 15000 });
await until(() => window.__neonTest.wand().status === 'tracking', 'tracking');
const live = await wand();
check(live.calibrated, 'calibration produced a colour model');
check(live.status === 'tracking', 'wand is tracked after calibration', live.status);
check(live.cost < 3, 'per-frame tracking cost under 3ms', `${live.cost.toFixed(2)}ms`);
log(`synthetic camera ${live.fps.toFixed(0)}fps, tracking cost ${live.cost.toFixed(2)}ms`);
if (shots) await page.screenshot({ path: `${shots}/wand-live.png` });

// --- Axes -------------------------------------------------------------------
check(Math.abs(live.steer) < 0.05, 'level wand is neutral steering', live.steer.toFixed(3));

// A clockwise tilt in the player's mirrored view is a positive angle for this fake camera.
await setPose({ angle: 0.7 });
check(await until(() => window.__neonTest.wand().steer > 0.5, 'steer right'), 'tilting right steers right', (await wand()).steer.toFixed(2));

await setPose({ angle: -0.7 });
check(await until(() => window.__neonTest.wand().steer < -0.5, 'steer left'), 'tilting left steers left', (await wand()).steer.toFixed(2));

await setPose({ angle: 0, half: 0.185 });
check(await until(() => window.__neonTest.wand().throttle > 0.5, 'throttle up'), 'pushing towards the camera accelerates', (await wand()).throttle.toFixed(2));

await setPose({ half: 0.105 });
check(await until(() => window.__neonTest.wand().throttle < -0.5, 'throttle down'), 'pulling back brakes', (await wand()).throttle.toFixed(2));

await setPose({ half: 0.14 });
await until(() => Math.abs(window.__neonTest.wand().throttle) < 0.2, 'throttle neutral');

// --- Flick to jump ----------------------------------------------------------
// The jump flag is only held for ~100ms, which a poll can step over on a slow camera. Watch it
// from inside the page instead, so the check sees every edge rather than sampling for one.
await page.evaluate(() => {
  window.__jumps = 0;
  let was = false;
  window.__jumpWatch = setInterval(() => {
    const now = window.__neonTest.wand().jump;
    if (now && !was) window.__jumps++;
    was = now;
  }, 8);
});
await page.evaluate(() => window.__wand.flick());
const jumped = await until(() => window.__jumps > 0, 'jump', 4000);
check(jumped, 'an upward flick fires a jump', `${await page.evaluate(() => window.__jumps)} jump(s)`);

// Lowering the wand again must not read as a second jump.
await page.evaluate(() => window.__wand.drop());
await page.waitForTimeout(700);
const spurious = await page.evaluate(() => window.__jumps);
check(spurious === 1, 'lowering the wand does not fire a second jump', `${spurious} total`);
await page.evaluate(() => clearInterval(window.__jumpWatch));

// --- Driving the actual ship ------------------------------------------------
await page.click('[data-action=wand-done]');
await page.waitForSelector('.title-screen, .worlds-screen', { timeout: 8000 });
if (await page.isVisible('[data-action=campaign]')) await page.click('[data-action=campaign]');
await page.waitForSelector('.worlds-screen');
await page.click('[data-action=road]');
await page.waitForFunction(() => document.querySelector('.hud-timer')?.textContent !== '00:00.00', null, { timeout: 15000 });
check((await screen()) === 'playing', 'road started');
check(await page.isVisible('.chip.wand-chip'), 'HUD shows the wand chip');

// Push forward: this game only accelerates under throttle, so a level wand stays parked.
await setPose({ half: 0.185 });
const movedOff = await until(() => window.__neonTest.ship().vz > 2, 'forward speed', 10000);
check(movedOff, 'pushing the wand forward accelerates the ship', `vz ${(await ship()).vz.toFixed(1)}`);

const before = await ship();
await setPose({ angle: 0.75 });
const wentRight = await until((x) => window.__neonTest.ship().x > x + 0.3, 'ship right', 6000);
check(wentRight, 'tilting the wand moves the ship right', `${before.x.toFixed(2)} -> ${(await ship()).x.toFixed(2)}`);
if (shots) await page.screenshot({ path: `${shots}/wand-driving.png` });

const mid = await ship();
await setPose({ angle: -0.75 });
const wentLeft = await until(() => window.__neonTest.ship().x < 0, 'ship left', 6000);
check(wentLeft, 'tilting the other way moves it back left', `${mid.x.toFixed(2)} -> ${(await ship()).x.toFixed(2)}`);
await setPose({ angle: 0 });

// --- Losing the marker pauses instead of crashing ---------------------------
await setPose({ visible: false });
const paused = await until(() => window.__neonTest.screen() === 'paused', 'auto-pause', 6000);
check(paused, 'losing the wand auto-pauses the run', await screen());
const lost = await wand();
check(lost.status === 'lost', 'tracking reports the loss', lost.status);
check(Math.abs(lost.steer) < 0.001, 'controls fade to neutral when the wand vanishes', lost.steer.toFixed(4));

await setPose({ visible: true });
check(await until(() => window.__neonTest.wand().status === 'tracking', 'recovery', 8000), 'tracking recovers when the wand comes back');

// --- Calibration survives a reload -----------------------------------------
await page.reload();
await page.waitForSelector('.title-screen', { timeout: 15000 });
await page.click('[data-action=wand]');
await page.waitForSelector('.wand-screen');
const intro = await page.textContent('.wand-side');
check(/Enable camera/.test(intro ?? ''), 'camera is not reopened without asking after a reload');
await page.click('[data-action=wand-enable]');
const restored = await page.waitForSelector('[data-action=wand-recentre]', { timeout: 15000 }).then(() => true).catch(() => false);
check(restored, 'saved calibration skips straight back to live tracking');

await browser.close();
log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
