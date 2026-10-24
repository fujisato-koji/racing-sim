// 確認用：レースを始めて、1 フレームで描く三角形の数と描画の呼び出しの回数を出す。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/probe-render.ts <コース id> <タブ> [質]
import { chromium } from 'playwright-core';
const [id = 'spa', tab = 'international', q = 'high'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/?debug');
await page.waitForSelector('[data-go]');
await page.selectOption('[data-quality]', q);
await page.click('[data-go]');
await page.click(`[data-tab="${tab}"]`);
await page.click(`[data-course="${id}"]`);
await page.click('[data-next]');
await page.waitForTimeout(300);
const t0 = Date.now();
await page.click('[data-go]');
await page.waitForSelector('.hud', { state: 'visible', timeout: 90000 });
const load = Date.now() - t0;
await page.waitForTimeout(2500);
const r = await page.evaluate(`(() => {
  const v = window.__app.view, r = v.renderer;
  r.info.autoReset = false; r.info.reset();
  v.render(1 / 60);
  const out = { triangles: r.info.render.triangles, calls: r.info.render.calls, geometries: r.info.memory.geometries };
  r.info.autoReset = true;
  return out;
})()`);
console.log(id, q, JSON.stringify(r), `読み込み ${load} ms`);
// 大きい順に、形ごとの三角形の数（インスタンスは今描いている数を掛ける）
const parts = await page.evaluate(`(() => {
  const v = window.__app.view, out = [];
  v.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry, tri = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    out.push([o.type + (o.layers.mask !== 1 ? ' 層' + o.layers.mask : '') + (o.castShadow ? ' 影' : ''), Math.round(tri * n), n]);
  });
  out.sort((a, b) => b[1] - a[1]);
  return out.slice(0, 12);
})()`);
for (const p of parts as [string, number, number][]) console.log('  ', p[0], p[1], p[2] > 1 ? `×${p[2]}` : '');
await browser.close();
