// 木の形の確認：開発サーバーの /dev/trees.html を撮る。先に `npx vite --port 5173` を起動しておく
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/dev/trees.html');
await page.waitForFunction('window.done === true', null, { timeout: 60000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/trees.png` });
console.log(errors.length ? errors.join('\n') : 'エラーなし');
await browser.close();
