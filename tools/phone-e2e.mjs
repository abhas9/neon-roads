// End-to-end check: a game page and a phone page pair over WebRTC (PeerJS) and the phone drives the ship.
import { chromium, devices } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5287/';
const shots = process.argv[3];
// Use an installed, signed browser (PW_CHANNEL=chrome): some OS firewalls block P2P UDP for Playwright's bundled Chromium.
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const log = (...a) => console.log('[e2e]', ...a);

const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
host.on('pageerror', (e) => log('host error', e.message));
await host.goto(base);
await host.click('[data-action=phone]');
await host.waitForSelector('.pair-status.ready', { timeout: 30000 });
const code = (await host.textContent('.pair-code')).trim();
const qrUrl = await host.evaluate(() => document.querySelector('.pair-steps code')?.textContent);
log('host ready, code', code, 'controller url', qrUrl);
if (shots) await host.screenshot({ path: `${shots}/phone-pair.png` });

const phoneCtx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => log('phone error', e.message));
const t0 = Date.now();
await phone.goto(`${base}controller.html#${code}`);
await phone.waitForSelector('.screen-pad', { timeout: 30000 });
await host.waitForSelector('.pair-status.connected', { timeout: 15000 });
log('paired in', Date.now() - t0, 'ms');
if (shots) await phone.screenshot({ path: `${shots}/phone-menu.png` });

// Back to title using the phone's B button, then open campaign with D-pad + A.
await phone.dispatchEvent('[data-btn=back]', 'pointerdown');
await host.waitForSelector('.title-screen', { timeout: 5000 });
log('phone B -> title screen OK');
await phone.dispatchEvent('[data-btn=confirm]', 'pointerdown');
await host.waitForSelector('.worlds-screen', { timeout: 5000 });
log('phone A -> campaign OK');
await phone.dispatchEvent('[data-btn=confirm]', 'pointerdown');
await phone.waitForSelector('.mode-game', { timeout: 8000 });
log('road started, phone switched to game layout');
await host.waitForTimeout(1500);

// Hold the stick up-right and press jump on the phone.
const stick = await phone.$('.stick');
const box = await stick.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await phone.touchscreen.tap(cx, cy).catch(() => {});
await phone.evaluate(({ cx, cy }) => {
  const el = document.querySelector('.stick');
  const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
  el.setPointerCapture = () => {};
  ev('pointerdown', cx, cy);
  ev('pointermove', cx + 10, cy - 70);
}, { cx, cy });
await host.waitForTimeout(1800);
const speed = Number(await host.textContent('.speed-val span'));
log('host speed after phone throttle:', speed);
if (shots) {
  await host.screenshot({ path: `${shots}/phone-driving-host.png` });
  await phone.screenshot({ path: `${shots}/phone-game.png` });
}
const rtt = await phone.textContent('.bar-rtt');
log('phone RTT readout:', rtt);
await browser.close();
if (!(speed > 50)) {
  console.error('FAIL: ship did not accelerate from phone input');
  process.exit(1);
}
log('PASS');
