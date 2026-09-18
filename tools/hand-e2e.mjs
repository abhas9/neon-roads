// End-to-end check for the hand controller.
//
// getUserMedia is stubbed with a canvas.captureStream, and the landmark model is stubbed with a
// synthetic detector (see tools/fake-hands.mjs). Everything downstream of the model runs for
// real: hand assignment, geometry, filtering, the mapper, Input, the simulation and the UI.
import { chromium } from 'playwright';
import { fakeCamera } from './fake-camera.mjs';
import { fakeHands } from './fake-hands.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5287/';
// Skip post-processing: tracking runs on requestVideoFrameCallback, which is tied to the page's
// render cadence, and the software GL renderer would otherwise hold the pipeline at ~10fps.
const url = base + (base.includes('?') ? '&' : '?') + 'nopost';
const shots = process.argv[3];
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const log = (...a) => console.log('[hand]', ...a);
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
await page.addInitScript(fakeHands);
await page.goto(url);
// The fake camera draws the wand marker by default; this controller does not want it in frame.
await page.evaluate(() => window.__wand.set({ visible: false }));

const hand = () => page.evaluate(() => window.__neonTest.hand());
const ship = () => page.evaluate(() => window.__neonTest.ship());
const screen = () => page.evaluate(() => window.__neonTest.screen());
const setHands = (p) => page.evaluate((v) => window.__hands.set(v), p);

async function until(predicate, label, timeout = 8000) {
  try {
    await page.waitForFunction(predicate, null, { timeout, polling: 50 });
    return true;
  } catch {
    log(`  (timed out waiting for ${label}: ${JSON.stringify(await hand())})`);
    return false;
  }
}

// --- Camera and model -------------------------------------------------------
await page.click('[data-action=hand]');
await page.waitForSelector('.hand-screen');
await page.click('[data-action=hand-enable]');
await page.waitForSelector('[data-action=hand-recentre]', { timeout: 20000 });
check(await until(() => window.__neonTest.hand().ready, 'model ready'), 'camera and hand tracking start');
await until(() => window.__neonTest.hand().status === 'tracking', 'tracking');
const live = await hand();
check(live.hands === 2, 'both hands are detected', `${live.hands} hand(s)`);
// This is the stubbed detector, so it measures assignment + geometry + mapping only. The real
// model's cost is measured separately by tools/hand-perf.mjs on an actual GPU.
check(live.cost < 2, 'mapping overhead under 2ms (model stubbed)', `${live.cost.toFixed(2)}ms`);
log(`synthetic camera ${live.fps.toFixed(0)}fps, mapping overhead ${live.cost.toFixed(2)}ms`);
if (shots) await page.screenshot({ path: `${shots}/hand-live.png` });

// --- Axes -------------------------------------------------------------------
await page.click('[data-action=hand-recentre]');
await page.waitForTimeout(300);
const neutral = await hand();
check(Math.abs(neutral.steer) < 0.05, 'open hands held still are neutral', neutral.steer.toFixed(3));
check(neutral.jump === false, 'open hands do not jump');

// Moving right in the mirror means moving left in the raw camera image.
await setHands({ right: { x: -0.42 } });
check(await until(() => window.__neonTest.hand().steer > 0.5, 'steer right'), 'moving the flying hand right steers right', (await hand()).steer.toFixed(2));

await setHands({ right: { x: -0.02 } });
check(await until(() => window.__neonTest.hand().steer < -0.5, 'steer left'), 'moving it left steers left', (await hand()).steer.toFixed(2));

await setHands({ right: { x: -0.22, y: 0.2 } });
check(await until(() => window.__neonTest.hand().throttle > 0.5, 'throttle up'), 'raising it accelerates', (await hand()).throttle.toFixed(2));

await setHands({ right: { y: -0.2 } });
check(await until(() => window.__neonTest.hand().throttle < -0.5, 'throttle down'), 'lowering it brakes', (await hand()).throttle.toFixed(2));

await setHands({ right: { y: 0 } });
await until(() => Math.abs(window.__neonTest.hand().throttle) < 0.2, 'throttle neutral');

// --- Fist to jump -----------------------------------------------------------
await page.evaluate(() => {
  window.__jumps = 0;
  let was = false;
  window.__jumpWatch = setInterval(() => {
    const now = window.__neonTest.hand().jump;
    if (now && !was) window.__jumps++;
    was = now;
  }, 8);
});
await setHands({ left: { curl: 1 } });
check(await until(() => window.__jumps > 0, 'jump', 4000), 'a fist fires a jump');

// A held fist must stay one jump: the simulation edge-triggers, so a flicker would be two.
await page.waitForTimeout(900);
const held = await page.evaluate(() => window.__jumps);
check(held === 1, 'holding the fist is exactly one jump', `${held} jump(s)`);
check((await hand()).jump === true, 'jump stays asserted while the fist is held');

await setHands({ left: { curl: 0 } });
check(await until(() => window.__neonTest.hand().jump === false, 'jump release', 3000), 'opening the hand releases the jump');
await page.evaluate(() => clearInterval(window.__jumpWatch));

// --- Cross-talk -------------------------------------------------------------
// Held off neutral, so a steering value that collapses to zero would be caught. Comparing two
// zeroes would have passed even with steering completely broken.
await setHands({ right: { x: -0.30 } });
await until(() => Math.abs(window.__neonTest.hand().steer - 0.5) < 0.35, 'partial steer');
const beforeCurl = (await hand()).steer;
await setHands({ right: { curl: 1 } });
await page.waitForTimeout(700);
const afterCurl = (await hand()).steer;
check(Math.abs(beforeCurl) > 0.15, 'the cross-talk check is held off neutral', beforeCurl.toFixed(2));
check(Math.abs(afterCurl - beforeCurl) < 0.15, 'closing the flying hand does not move the steering', `${beforeCurl.toFixed(2)} -> ${afterCurl.toFixed(2)}`);
await setHands({ right: { x: -0.22, curl: 0 } });

// --- Driving the actual ship ------------------------------------------------
await page.click('[data-action=hand-done]');
await page.waitForSelector('.title-screen, .worlds-screen', { timeout: 8000 });
if (await page.isVisible('[data-action=campaign]')) await page.click('[data-action=campaign]');
await page.waitForSelector('.worlds-screen');
await page.click('[data-action=road]');
await page.waitForFunction(() => document.querySelector('.hud-timer')?.textContent !== '00:00.00', null, { timeout: 15000 });
check((await screen()) === 'playing', 'road started');
const chip = await page.textContent('.chip.cam-chip').catch(() => '');
check((chip ?? '').includes('HANDS'), 'HUD shows the hands chip', chip ?? '(missing)');

await setHands({ right: { y: 0.2 } });
check(await until(() => window.__neonTest.ship().vz > 2, 'forward speed', 10000), 'raising the hand accelerates the ship', `vz ${(await ship()).vz.toFixed(1)}`);

const before = await ship();
await setHands({ right: { x: -0.45 } });
check(await until((x) => window.__neonTest.ship().x > x + 0.3, 'ship right', 6000), 'moving the hand right moves the ship right', `${before.x.toFixed(2)} -> ${(await ship()).x.toFixed(2)}`);
if (shots) await page.screenshot({ path: `${shots}/hand-driving.png` });

const mid = await ship();
await setHands({ right: { x: 0.0 } });
check(await until(() => window.__neonTest.ship().x < 0, 'ship left', 6000), 'moving it left moves the ship back', `${mid.x.toFixed(2)} -> ${(await ship()).x.toFixed(2)}`);
await setHands({ right: { x: -0.22 } });

// --- Losing the hands pauses instead of crashing ----------------------------
await setHands({ right: null, left: null });
check(await until(() => window.__neonTest.screen() === 'paused', 'auto-pause', 6000), 'losing both hands auto-pauses the run', await screen());
const lost = await hand();
check(lost.status === 'lost', 'tracking reports the loss', lost.status);
check(Math.abs(lost.steer) < 0.001, 'controls fade to neutral when the hands vanish', lost.steer.toFixed(4));

await setHands({ right: { x: -0.22, y: 0, curl: 0 }, left: { x: 0.22, y: 0, curl: 0 } });
check(await until(() => window.__neonTest.hand().status === 'tracking', 'recovery', 8000), 'tracking recovers when the hands come back');

// --- One camera at a time ---------------------------------------------------
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.goto(url);
await page.evaluate(() => window.__wand.set({ visible: true }));
await page.click('[data-action=hand]');
await page.click('[data-action=hand-enable]');
const handsWereOn = await until(() => window.__neonTest.hand().ready, 'hands ready', 20000);
check(handsWereOn, 'hand tracking is running before the wand is switched on');
await page.click('[data-action=back]');
await page.click('[data-action=wand]');
await page.click('[data-action=wand-enable]');
await page.waitForSelector('[data-action=wand-calibrate], [data-action=wand-recentre]', { timeout: 20000 });
const handOff = await hand();
check(handOff.state === 'off', 'turning on the wand releases the camera from hand tracking', handOff.state);

await browser.close();
log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
