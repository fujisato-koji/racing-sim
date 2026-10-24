// 車の柄の確認：6 車種をショールームで横と斜め後ろから撮る。先に `npx vite preview --port 4173` を起動しておく。
// 実行: npx tsx test/browser-livery.ts <出力先>
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4173/?debug');
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.click('[data-go]');
await page.waitForTimeout(500);
await page.click('[data-next]');
await page.waitForTimeout(800);
// パネルを隠して車だけを見る
await page.evaluate(`document.getElementById('overlay').style.visibility = 'hidden'`);
for (let i = 0; i < 6; i++) {
  await page.evaluate(`(() => { const b = document.querySelectorAll('[data-car]')[${i}]; b.click(); })()`);
  for (const [k, ang] of [['side', Math.PI / 2 - 0.6], ['rear', 2.55]] as const) {
    await page.evaluate(`(() => { const v = window.__app.view; v.garageAngle = ${ang}; })()`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/l${i}-${k}.png` });
  }
}
console.log(errors.length ? errors.join('\n') : 'エラーなし');
await browser.close();
