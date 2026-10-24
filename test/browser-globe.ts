// コースを選ぶ画面の地球儀の確認：開いたところ、一覧から選んで回り込んだところ、柱を押したところを撮る。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-globe.ts <出力先> [幅] [高さ] [touch]
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '.';
const W = Number(process.argv[3] ?? 1280), H = Number(process.argv[4] ?? 720);
const touch = process.argv[5] === 'touch';
const url = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.click('[data-go]');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/g1-open.png` });
await page.click('[data-tab="international"]');
await page.click('[data-course="spa"]');
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/g2-spa.png` });
await page.click('[data-tab="street"]');
await page.click('[data-course="monaco"]');
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/g3-monaco.png` });
await page.click('[data-tab="oval"]');
await page.click('[data-course="daytona"]');
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/g4-daytona.png` });
console.log(errors.length ? errors.slice(0, 20).join('\n') : 'コンソールのエラーなし');
await browser.close();
