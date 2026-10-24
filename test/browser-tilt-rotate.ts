// スマホの傾きの確認：傾きのセンサーの値を送り、切っている途中に OS が画面を回したとき（横 → 縦）にハンドルが跳ばないこと、
// 縦の画面に横向きで描くとき、持ち方（右の縁が上、左の縁が上）に合わせて向きを変えることを確かめる。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-tilt-rotate.ts
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
// 画面の向きの角度を差し替えられるようにする（横向き 90 → 縦向き 0）
await page.addInitScript(`(() => {
  window.__angle = 90;
  Object.defineProperty(ScreenOrientation.prototype, 'angle', { get() { return window.__angle; }, configurable: true });
})()`);
await page.goto('http://localhost:4173/?debug');
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.tap('[data-go]');
await page.waitForTimeout(600);
await page.tap('[data-next]');
await page.waitForTimeout(800);
await page.tap('[data-go]');
await page.waitForSelector('.hud', { state: 'visible', timeout: 90000 });
await page.waitForTimeout(1500);

/** 端末を α 度だけ時計回りに回した姿勢の値を、間をあけて n 回送る（side 1 は右の縁が上、−1 は左の縁が上） */
const hold = async (alpha: number, side: 1 | -1, n = 16) => {
  for (let i = 0; i < n; i++) {
    await page.evaluate(`window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: ${alpha * side}, gamma: ${-90 * side} }))`);
    await page.waitForTimeout(40);
  }
};
const steer = async () => (await page.evaluate(`window.__app.touch.update(0.004, 15).steer`)) as number;
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'OK  ' : 'NG  '} ${msg}`); if (!ok) fail++; };

await hold(0, 1);
await page.evaluate('window.__app.touch.calibrate()');
await hold(0, 1);
const s0 = await steer();
await hold(12, 1);
const s1 = await steer();
// OS が画面を縦に回した（向きの角度 0、画面が縦長）。端末の持ち方は同じ
await page.evaluate('window.__angle = 0');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await hold(12, 1);
const s2 = await steer();
console.log(`ハンドル 中央 ${s0.toFixed(2)}、12° 切る ${s1.toFixed(2)}、画面が回った後 ${s2.toFixed(2)}`);
check(Math.abs(s0) < 0.05, '中央に合わせるとハンドルは 0');
check(s1 > 0.05, '時計回りに回すと右に切れる');
check(Math.abs(s2 - s1) < 0.08, '切っている途中に画面が回っても、ハンドルは跳ばない');
const cls = async () => (await page.evaluate(`document.body.className`)) as string;
check((await cls()).includes('forced-landscape') && !(await cls()).includes('forced-ccw'), '縦の画面では、右の縁を上にして横向きに描く');

// 一時停止して、左の縁が上になるように持ち替える（走っている間は向きを変えない）
await page.evaluate('window.__app.togglePause()');
for (let k = 0; k < 10 && !(await cls()).includes('forced-ccw'); k++) await hold(0, -1, 10);
check((await cls()).includes('forced-ccw'), '一時停止中に反対に持つと、左の縁を上にして描く');
await page.screenshot({ path: process.argv[2] ? `${process.argv[2]}/tilt-ccw.png` : 'tilt-ccw.png' });
// 回した画面でもボタンを押せる
await page.tap('[data-resume]');
await page.waitForTimeout(500);
check(!(await page.evaluate('window.__app.session.paused')), '反対向きの画面で Resume を押せる');
console.log(errors.length ? errors.join('\n') : 'エラーなし');
console.log(fail === 0 ? 'すべて通過' : `${fail} 件の失敗`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
