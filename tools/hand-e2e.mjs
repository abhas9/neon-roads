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
/** Both hands gripped closed and level: the resting posture. */
const GRIP = { right: { x: -0.22, y: 0, curl: 1 }, left: { x: 0.22, y: 0, curl: 1 } };
/** Turning the wheel clockwise drops the right hand and raises the left. */
const turn = (t) => ({ right: { y: -t }, left: { y: t } });
const raise = (h) => ({ right: { y: h }, left: { y: h } });

async function until(predicate, label, timeout = 8000) {
  try {
    await page.waitForFunction(predicate, null, { timeout, polling: 50 });
    return true;
  } catch {
    log(`  (timed out waiting for ${label}: ${JSON.stringify(await hand())})`);
    return false;
  }
}

await setHands(GRIP);

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
check(Math.abs(neutral.steer) < 0.05, 'level hands are neutral steering', neutral.steer.toFixed(3));
check(neutral.jump === false, 'gripped hands do not jump');

await setHands(turn(0.18));
check(await until(() => window.__neonTest.hand().steer > 0.5, 'steer right'), 'turning the wheel clockwise steers right', (await hand()).steer.toFixed(2));
const steeringThrottle = (await hand()).throttle;
check(Math.abs(steeringThrottle) < 0.15, 'steering does not disturb the throttle', steeringThrottle.toFixed(2));

await setHands(turn(-0.18));
check(await until(() => window.__neonTest.hand().steer < -0.5, 'steer left'), 'turning it anticlockwise steers left', (await hand()).steer.toFixed(2));

await setHands(GRIP);
await until(() => Math.abs(window.__neonTest.hand().steer) < 0.15, 'steer neutral');

await setHands(raise(0.18));
check(await until(() => window.__neonTest.hand().throttle > 0.5, 'throttle up'), 'raising both hands accelerates', (await hand()).throttle.toFixed(2));
const throttleSteer = (await hand()).steer;
check(Math.abs(throttleSteer) < 0.1, 'throttling does not disturb the steering', throttleSteer.toFixed(2));

await setHands(raise(-0.18));
check(await until(() => window.__neonTest.hand().throttle < -0.5, 'throttle down'), 'lowering both hands brakes', (await hand()).throttle.toFixed(2));

await setHands(GRIP);
await until(() => Math.abs(window.__neonTest.hand().throttle) < 0.2, 'throttle neutral');

// The whole point of measuring between the hands: shifting in your seat is not a turn.
await setHands({ right: { x: -0.10, y: 0.06 }, left: { x: 0.34, y: 0.06 } });
await page.waitForTimeout(700);
const shifted = await hand();
check(Math.abs(shifted.steer) < 0.15, 'shifting both hands together does not steer', shifted.steer.toFixed(2));
await setHands(GRIP);
await page.waitForTimeout(400);

// --- Opening a hand to jump -------------------------------------------------
await page.evaluate(() => {
  window.__jumps = 0;
  let was = false;
  window.__jumpWatch = setInterval(() => {
    const now = window.__neonTest.hand().jump;
    if (now && !was) window.__jumps++;
    was = now;
  }, 8);
});
await setHands({ left: { curl: 0 } });
check(await until(() => window.__jumps > 0, 'jump', 4000), 'opening a hand fires a jump');

// A held-open hand must stay one jump: the simulation edge-triggers, so a flicker would be two.
await page.waitForTimeout(900);
const held = await page.evaluate(() => window.__jumps);
check(held === 1, 'holding the hand open is exactly one jump', `${held} jump(s)`);

await setHands({ left: { curl: 1 } });
check(await until(() => window.__neonTest.hand().jump === false, 'jump release', 3000), 'closing the hand again releases the jump');

// The other hand must work identically.
await setHands({ right: { curl: 0 } });
check(await until(() => window.__jumps === 2, 'second jump', 4000), 'the other hand jumps too', `${await page.evaluate(() => window.__jumps)} total`);
await setHands(GRIP);
await page.waitForTimeout(400);
await page.evaluate(() => clearInterval(window.__jumpWatch));

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

await setHands(raise(0.18));
check(await until(() => window.__neonTest.ship().vz > 2, 'forward speed', 10000), 'raising both hands accelerates the ship', `vz ${(await ship()).vz.toFixed(1)}`);

const before = await ship();
await setHands({ right: { y: 0.18 - 0.2 }, left: { y: 0.18 + 0.2 } });
check(await until((x) => window.__neonTest.ship().x > x + 0.3, 'ship right', 6000), 'turning the wheel moves the ship right', `${before.x.toFixed(2)} -> ${(await ship()).x.toFixed(2)}`);
if (shots) await page.screenshot({ path: `${shots}/hand-driving.png` });

const mid = await ship();
await setHands({ right: { y: 0.18 + 0.2 }, left: { y: 0.18 - 0.2 } });
check(await until(() => window.__neonTest.ship().x < 0, 'ship left', 6000), 'turning it back moves the ship left', `${mid.x.toFixed(2)} -> ${(await ship()).x.toFixed(2)}`);
await setHands(raise(0.18));

// --- Losing the hands pauses instead of crashing ----------------------------
await setHands({ right: null, left: null });
check(await until(() => window.__neonTest.screen() === 'paused', 'auto-pause', 6000), 'losing both hands auto-pauses the run', await screen());
const lost = await hand();
check(lost.status === 'lost', 'tracking reports the loss', lost.status);
check(Math.abs(lost.steer) < 0.001, 'controls fade to neutral when the hands vanish', lost.steer.toFixed(4));

await setHands(GRIP);
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
