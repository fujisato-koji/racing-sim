// タイトル画面の確認：出てくる途中と、落ち着いたところを撮る。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-title.ts <出力先> [幅] [高さ] [touch]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const W = Number(process.argv[3] ?? 1280), H = Number(process.argv[4] ?? 720), touch = process.argv[5] === 'touch';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4173/');
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/t1-intro.png` });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/t2-title.png` });
console.log(errors.length ? errors.join('\n') : 'エラーなし');
await browser.close();
