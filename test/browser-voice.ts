// 読み上げの確認：音声合成を記録だけするものに置き換え、メニューをキーボードで進めてレースを始め、読んだ文を確かめる。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-voice.ts
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(`(() => {
  window.__said = [];
  const fake = {
    speaking: false, pending: false,
    getVoices() { return []; },
    addEventListener() {},
    cancel() { this.speaking = false; },
    speak(u) { window.__said.push(u.text); this.speaking = true; setTimeout(() => { this.speaking = false; u.onend && u.onend(); }, 400); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
})()`);
await page.goto('http://localhost:4173/?debug');
await page.waitForSelector('[data-go]', { timeout: 60000 });
await page.waitForTimeout(1500);
const said = async () => (await page.evaluate('window.__said')) as string[];
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(400);
const menu = await said();
await page.keyboard.press('Enter');
await page.waitForSelector('.hud', { state: 'visible', timeout: 90000 });
await page.waitForTimeout(2500);
// ソフトウェア描画は遅いので、カウントダウンの終わりまで進める
await page.evaluate('window.__app.session.race.time = -0.05');
await page.waitForTimeout(4000);
const race = (await said()).slice(menu.length);
console.log('メニュー:', menu.join(' | '));
console.log('レース:', race.join(' | '));
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'OK  ' : 'NG  '} ${msg}`); if (!ok) fail++; };
check(menu.includes('Choose your track.'), 'コースの画面で Choose your track');
check(menu.includes('Grand Prix circuits.'), '種類の切り替えを読む');
check(menu.some((t) => /^Suzuka, Japan\.$/.test(t)), 'コース名と国を読む');
check(menu.includes('Choose your car.'), '車の画面で Choose your car');
check(menu.some((t) => /horsepower/.test(t)), '車の名前と馬力を読む');
check(race.some((t) => /Welcome to Suzuka|race day at Suzuka/.test(t)), 'レースの始まりの実況');
check(race.some((t) => /away we go|they're off|Green flag/.test(t)), 'スタートの実況');
console.log(errors.length ? errors.join('\n') : 'エラーなし');
console.log(fail === 0 ? 'すべて通過' : `${fail} 件の失敗`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
