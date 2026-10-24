// 確認用：モナコの地面の頂点の色の平均をブラウザの中で読む
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto('http://localhost:4173/?debug');
await page.waitForSelector('[data-go]');
await page.click('[data-go]');
await page.click('[data-tab="street"]');
await page.click('[data-course="monaco"]');
await page.click('[data-next]');
await page.waitForTimeout(300);
await page.click('[data-go]');
await page.waitForSelector('.hud', { state: 'visible', timeout: 60000 });
const r = await page.evaluate(`(() => {
  const a = window.__app, cm = a.view.courseMesh, c = a.session.course;
  const t = cm.group.children[0];
  const col = t.geometry.getAttribute('color'), n = col.count;
  let s = [0,0,0];
  for (let i = 0; i < n; i++) { s[0] += col.getX(i); s[1] += col.getY(i); s[2] += col.getZ(i); }
  const nat = c.terrain.nature; let w = 0; for (const v of nat) w += v;
  return { mesh: t.type, mat: t.material.type, map: !!t.material.map, avg: s.map(v => (v/n).toFixed(3)), natAvg: (w / nat.length).toFixed(3), ground: c.def.ground, terrain: !!a.session.cfg.terrain, children: cm.group.children.length };
})()`);
console.log(JSON.stringify(r));
await browser.close();
