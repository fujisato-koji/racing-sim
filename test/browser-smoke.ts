// 手元の Edge で画面を開き、メニューを通ってレースを始め、スクリーンショットを撮る（確認用）。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-smoke.ts <出力先> [コース id]
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '.';
const courseId = process.argv[3] ?? 'circuit';
const url = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.screenshot({ path: `${out}/s1-title.png` });
await page.click('[data-go]');
await page.click(`[data-course="${courseId}"]`);
await page.screenshot({ path: `${out}/s2-course.png` });
await page.click('[data-next]');
await page.waitForTimeout(500);
await page.click('[data-detail]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/s3-settings.png` });
await page.click('[data-go]');
await page.waitForSelector('.hud', { state: 'visible', timeout: 60000 });
await page.waitForTimeout(4500);
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/s4-chase.png` });
await page.keyboard.press('KeyC');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/s5-cockpit.png` });
await page.keyboard.up('ArrowUp');
const fps: number = await page.evaluate(`new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(f);
})`);
console.log(`fps（ソフトウェア描画） ${fps.toFixed(1)}`);
console.log(errors.length ? errors.slice(0, 20).join('\n') : 'コンソールのエラーなし');
await browser.close();
