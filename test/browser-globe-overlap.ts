// 地球儀でコースを 1 つずつ選び、説明のカードが表側のほかの柱を何本隠しているかを数える（前の置き方と比べる）。
// 先に `npx vite preview --port 4173` を起動しておく。実行: npx tsx test/browser-globe-overlap.ts [幅] [高さ] [touch]
import { chromium } from 'playwright-core';

const W = Number(process.argv[2] ?? 1280), H = Number(process.argv[3] ?? 720);
const touch = process.argv[4] === 'touch';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
await page.goto('http://localhost:4173/?debug');
await page.waitForSelector('[data-go]');
await page.click('[data-go]');
await page.waitForTimeout(1500);
const tabs: Record<string, string[]> = {
  international: ['suzuka', 'spa', 'monza', 'silverstone', 'fuji'],
  technical: ['zandvoort', 'brands-hatch', 'hungaroring', 'tsukuba', 'laguna-seca'],
  street: ['monaco', 'macau', 'singapore', 'baku', 'melbourne'],
  oval: ['indianapolis', 'daytona', 'talladega', 'charlotte', 'bristol'],
};
let totalNew = 0, totalOld = 0, selfHidden = 0;
for (const [tab, ids] of Object.entries(tabs)) {
  await page.click(`[data-tab="${tab}"]`);
  for (const id of ids) {
    await page.click(`[data-course="${id}"]`);
    await page.waitForTimeout(6000);
    const r = await page.evaluate(`(() => {
      const a = window.__app, g = a.globe, card = a.card, panel = a.coursePanel;
      const pos = card.dataset.pos.split(',').map(Number), cw = card.offsetWidth, ch = card.offsetHeight;
      const all = g.screenAll(), s = all.find((m) => m.id === '${id}');
      const others = all.filter((m) => m.id !== '${id}' && m.front);
      const inside = (x, y) => others.filter((m) => m.x > x - 16 && m.x < x + cw + 16 && m.y > y - 16 && m.y < y + ch + 16).length;
      // 前の置き方：柱の右（はみ出せば左）、上下は柱の高さの少し上
      const w = innerWidth, h = innerHeight, left = panel.offsetLeft + panel.offsetWidth + 14;
      let ox = s.x + 46; if (ox + cw > w - 12) ox = s.x - 46 - cw;
      ox = Math.max(left, Math.min(w - 12 - cw, ox));
      const oy = Math.max(12, Math.min(h - 12 - ch, s.y - ch * 0.35));
      const self = s.x > pos[0] && s.x < pos[0] + cw && s.y > pos[1] && s.y < pos[1] + ch;
      return { now: inside(pos[0], pos[1]), old: inside(ox, oy), near: others.filter((m) => Math.hypot(m.x - s.x, m.y - s.y) < 400).length, self };
    })()`) as { now: number; old: number; near: number; self: boolean };
    totalNew += r.now; totalOld += r.old; if (r.self) selfHidden++;
    console.log(`${id.padEnd(13)} 隠す柱 前 ${r.old} → 今 ${r.now}（400 px 以内の柱 ${r.near}）${r.self ? '  選んだ柱を隠している' : ''}`);
  }
}
console.log(`合計 前 ${totalOld} → 今 ${totalNew}、選んだ柱を隠したコース ${selfHidden}`);
await browser.close();
