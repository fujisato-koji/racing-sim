// ハンドルの補助の設定の確認：選択肢は Stability only と Off の 2 つで、標準は Stability only。
// 前の版で保存された Follow the road（自分で選んだものも、標準のまま保存されたものも）は Stability only になる。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-assist-pref.ts
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'OK  ' : 'NG  '} ${msg}`); if (!ok) fail++; };
for (const [label, saved] of [['保存なし', null], ['標準の follow が保存', { assist: 'follow' }], ['自分で follow を選んで保存', { assist: 'follow', assistSet: true }], ['自分で off を選んで保存', { assist: 'off', assistSet: true }]] as const) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  if (saved) await page.addInitScript(`localStorage.setItem('racing-sim.prefs.v1', '${JSON.stringify(saved)}')`);
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('[data-go]', { timeout: 60000 });
  await page.click('[data-prefs]');
  const r = await page.evaluate(`(() => { const s = document.querySelector('[data-assist]'); return { value: s.value, options: [...s.options].map((o) => o.value) }; })()`) as { value: string; options: string[] };
  const want = saved && 'assistSet' in saved && saved.assist === 'off' ? 'off' : 'yaw';
  check(r.value === want && r.options.join(',') === 'yaw,off', `${label}：選ばれているのは ${r.value}（期待 ${want}）、選択肢 ${r.options.join(',')}`);
  await page.close();
}
console.log(fail === 0 ? 'すべて通過' : `${fail} 件の失敗`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
