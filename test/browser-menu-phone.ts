// スマホの大きさで、コースと車の画面を撮る。先に `npx vite preview --port 4173` を起動しておく。
// 実行: npx tsx test/browser-menu-phone.ts <出力先>
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
await page.goto('http://localhost:4173/');
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.tap('[data-go]');
await page.waitForTimeout(800);
await page.tap('[data-tab="street"]');
await page.tap('[data-course="monaco"]');
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/p-course.png` });
await page.tap('[data-next]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/p-car.png` });
await browser.close();
