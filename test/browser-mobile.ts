// スマホを模した画面で、横向きの表示、傾きのハンドル、ペダル、音を確かめる（確認用）
// 実行: npx tsx test/browser-mobile.ts <出力先> [portrait|landscape]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const portrait = (process.argv[3] ?? 'portrait') === 'portrait';
const url = process.env.URL ?? 'http://localhost:4173/?debug';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: portrait ? { width: 390, height: 844 } : { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.screenshot({ path: `${out}/p1-title.png` });
await page.click('[data-go]');
await page.click('[data-course="circuit"]');
await page.click('[data-next]');
await page.click('[data-go]');
await page.waitForSelector('.hud', { state: 'visible', timeout: 60000 });
// 横に持った中立の姿勢（スマホの上端が左）を送る
const tilt = (beta: number, gamma: number) => page.evaluate(`window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: ${beta}, gamma: ${gamma} }))`);
for (let i = 0; i < 5; i++) { await tilt(0, -90); await page.waitForTimeout(100); }
await page.waitForTimeout(3500);
const press = (sel: string, type: string) => page.evaluate(`document.querySelector('${sel}').dispatchEvent(new PointerEvent('${type}', { pointerId: 7, bubbles: true, pointerType: 'touch' }))`);
await press('.pedal.throttle', 'pointerdown');
await page.waitForTimeout(3000);
// 右へ 20° 回す
for (let i = 0; i < 10; i++) { await tilt(20, -90); await page.waitForTimeout(100); }
const st = await page.evaluate(`(() => { const a = window.__app; const v = a.session.player.vehicle; const s = a.sound;
  return { steer: v.controls.steer.toFixed(2), throttle: v.controls.throttle.toFixed(2), kmh: (v.speed * 3.6).toFixed(0),
    audio: s.ctx ? s.ctx.state : 'none', engineHz: s.engine ? s.engine.oscs[0].frequency.value.toFixed(1) : '-', rpm: v.rpm.toFixed(0),
    forced: document.body.classList.contains('forced-landscape'), canvas: [a.view.renderer.domElement.width, a.view.renderer.domElement.height] }; })()`);
console.log(JSON.stringify(st));
await page.screenshot({ path: `${out}/p2-race.png` });
await press('.pedal.throttle', 'pointerup');
await press('[data-a="pause"]', 'pointerdown');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/p3-pause.png` });
console.log(errors.length ? errors.join('\n') : 'エラーなし');
await browser.close();
