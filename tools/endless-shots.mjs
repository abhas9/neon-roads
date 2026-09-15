import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
for (const mode of ['endless', 'daily']) {
  await page.goto('http://127.0.0.1:5287/');
  await page.waitForTimeout(800);
  await page.click(`[data-action=${mode}]`);
  await page.waitForTimeout(1300);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${mode}.png` });
  // Drive off the edge to reach the results screen.
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(4000);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
  await page.waitForSelector('.results-screen', { timeout: 10000 });
  await page.screenshot({ path: `${out}/${mode}-results.png` });
}
await browser.close();
