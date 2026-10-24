// 車選択の画面で各車の見た目を撮る（確認用）
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.env.URL ?? 'http://localhost:4173/');
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.click('[data-go]');
await page.click('[data-next]');
for (let i = 0; i < 6; i++) {
  await page.click(`[data-car="${i}"]`);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/car${i}.png`, clip: { x: 520, y: 140, width: 760, height: 480 } });
}
console.log(errors.length ? errors.join('\n') : 'エラーなし');
await browser.close();
