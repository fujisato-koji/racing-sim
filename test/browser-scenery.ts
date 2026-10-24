// 遠景の確認：コースを選んでレースを始め、スタート前の車をその場で 4 方向へ向けて撮る。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-scenery.ts <出力先> <コース id> <タブ>
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '.';
const courseId = process.argv[3] ?? 'fuji';
const tab = process.argv[4] ?? 'international';
const url = (process.env.URL ?? 'http://localhost:4173/') + '?debug';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.click('[data-go]');
await page.click(`[data-tab="${tab}"]`);
await page.click(`[data-course="${courseId}"]`);
await page.click('[data-next]');
await page.waitForTimeout(300);
await page.click('[data-go]');
await page.waitForSelector('.hud', { state: 'visible', timeout: 60000 });
await page.evaluate(`(() => { const a = window.__app; a.session.race.time = -3; a.session.paused = true; a.hud.visible = false; a.view.showMirror = false; a.hud.showMap = false; })()`);
for (const deg of [0, 90, 180, 270]) {
  await page.evaluate(`(() => {
    const a = window.__app, v = a.session.player.vehicle, p = v.pos;
    const yaw = Math.atan2(-v.fwd.x, -v.fwd.z) + ${deg} * Math.PI / 180;
    v.place(p.x, p.y - 0.3, p.z, yaw);
    a.view.chaseInit = false;
  })()`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/v-${courseId}-${deg}.png` });
}
console.log(errors.length ? errors.slice(0, 20).join('\n') : 'コンソールのエラーなし');
await browser.close();
