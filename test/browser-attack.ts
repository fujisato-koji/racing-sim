// タイムアタックの画面の確認：走り方を選び、作った最速の周（経路に沿って走るゴースト）を入れて、ゴースト、差、一時停止のテレメトリ、結果を撮る。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-attack.ts <出力先>
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '.';
const url = (process.env.URL ?? 'http://localhost:4173/') + '?debug';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.click('[data-go]');
await page.click('[data-tab="original"]');
await page.click('[data-course="circuit"]');
await page.selectOption('[data-mode]', 'attack');
await page.screenshot({ path: `${out}/a1-course.png` });
await page.click('[data-next]');
await page.waitForTimeout(400);
await page.click('[data-go]');
await page.waitForSelector('.hud', { state: 'visible', timeout: 60000 });
// 経路に沿って 20 m/s で走る最速の周と、そのテレメトリを入れる（差が出るように）
await page.evaluate(`(() => {
  const s = window.__app.session, a = s.attack, path = s.course.path, L = s.course.length, n = path.length;
  s.race.time = -0.05;
  const v = 20, T = L / v, frames = [];
  for (let k = 0; k <= T * 20; k++) {
    const d = (k / 20) * v, i = Math.floor((d / L) * n) % n, p = path[i];
    const yaw = Math.atan2(-p.tx, -p.tz);
    frames.push(p.x + p.lx * 2, p.y + 0.6, p.z + p.lz * 2, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  }
  a.best = { course: 'circuit', car: 'x', carName: 'x', color: '#fff', time: T, frames: new Float32Array(frames) };
  const bins = Math.ceil(L / 5), f = (g) => Float32Array.from({ length: bins }, (_, i) => g(i));
  a.bestTrace = { lapTime: T, bins, speed: f(() => 72), throttle: f((i) => (i % 40 < 30 ? 1 : 0)), brake: f((i) => (i % 40 >= 34 ? 0.8 : 0)), steer: f(() => 0), latG: f(() => 0), gear: new Int8Array(bins).fill(3), time: f((i) => (i * 5) / v) };
  a.lastTrace = { ...a.bestTrace, speed: f((i) => 60 + 20 * Math.sin(i / 15)), time: f((i) => (i * 5) / v * 1.04) };
})()`);
await page.waitForTimeout(4500);
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(12000);
await page.screenshot({ path: `${out}/a2-chase.png` });
await page.keyboard.up('ArrowUp');
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/a3-pause.png` });
await page.click('[data-finish]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/a4-results.png` });
console.log(errors.length ? errors.slice(0, 20).join('\n') : 'コンソールのエラーなし');
await browser.close();
