// 試験場でジャンプ台に向かって走り、何枚か撮る（確認用）
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const car = process.argv[3] ?? '';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4173/?debug');
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.click('[data-go]');
await page.click('[data-course="testfield"]');
await page.click('[data-next]');
if (car) await page.click(`[data-car="${car}"]`);
await page.click('[data-detail]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/j0-settings.png` });
await page.click('[data-go]');
await page.waitForSelector('.hud', { state: 'visible', timeout: 60000 });
await page.waitForTimeout(800);
await page.keyboard.down('ArrowUp');
const log: string[] = [];
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(500);
  const st = await page.evaluate(`(() => { const v = window.__app.session.player.vehicle; return [v.pos.x.toFixed(1), v.pos.y.toFixed(2), v.pos.z.toFixed(1), (v.speed*3.6).toFixed(0), v.airborne, v.gear].join(' '); })()`);
  log.push(`${((i + 1) * 0.5).toFixed(1)}s ${st}`);
  if (i >= 5) await page.screenshot({ path: `${out}/j${i}.png` });
}
console.log(log.join('\n'));
console.log(errors.length ? errors.join('\n') : 'エラーなし');
await browser.close();
