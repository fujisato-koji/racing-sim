// コースを上から見た図を PNG に描く（確認用）。実行: npx tsx test/map-png.ts <出力先フォルダ>
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildCourse } from '../src/sim/course';
import { COURSES } from '../src/sim/courses';

const out = process.argv[2] ?? '.';

function crc32(buf: Uint8Array) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function png(w: number, h: number, rgb: Uint8Array) {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const b = new Uint8Array(12 + data.length);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, data.length);
    b.set(new TextEncoder().encode(type), 4);
    b.set(data, 8);
    dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length)));
    return b;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { res.set(p, o); o += p.length; }
  return res;
}

for (const def of COURSES) {
  const c = buildCourse(def);
  const scale = 1.5; // 1 px = 1.5 m
  const { x0, z0, x1, z1 } = c.bounds;
  const W = Math.ceil((x1 - x0) / scale), H = Math.ceil((z1 - z0) / scale);
  const img = new Uint8Array(W * H * 3);
  const { nx, cell, colors } = c.terrain;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const i = Math.min(nx, Math.round((px * scale) / cell)), j = Math.round((py * scale) / cell);
    const k = (j * (nx + 1) + i) * 3;
    const o = (py * W + px) * 3;
    img[o] = colors[k] * 255; img[o + 1] = colors[k + 1] * 255; img[o + 2] = colors[k + 2] * 255;
  }
  const dot = (x: number, z: number, r: number, col: [number, number, number]) => {
    const cx = (x - x0) / scale, cy = (z - z0) / scale;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      img.set(col, (py * W + px) * 3);
    }
  };
  const colorOf = (s: string): [number, number, number] => s === 'asphalt' ? [40, 40, 45] : s === 'sand' ? [230, 200, 120] : [150, 130, 105];
  for (const p of c.path) dot(p.x, p.z, Math.max(1, Math.round(c.width / 2 / scale)), colorOf(p.surface));
  // 1 割ごとの目印（濃さで順番が分かる）、0 は白
  for (let f = 0; f < 10; f++) {
    const p = c.path[Math.floor((f / 10) * c.path.length)];
    if (p) dot(p.x, p.z, 5, f === 0 ? [255, 255, 255] : [30 + f * 22, 30, 200 - f * 15]);
  }
  for (const j of def.track?.jumps ?? []) { const p = c.path[Math.floor(j.at * c.path.length)]; dot(p.x, p.z, 4, [230, 30, 30]); }
  for (const w of c.walls) dot(w.cx, w.cz, 1, [255, 255, 255]);
  for (const s of c.tireStacks) dot(s.x, s.z, 1, [10, 10, 10]);
  for (const [x, , z] of c.cones) dot(x, z, 1, [255, 120, 0]);
  for (const r of c.ramps) dot(r[0], r[2], 3, [200, 200, 200]);
  for (const g of c.grid) dot(g.x, g.z, 2, [255, 255, 0]);
  writeFileSync(`${out}/map-${def.id}.png`, png(W, H, img));

  // 経路が自分に近づきすぎていないか（50 m 以上離れた点どうし）
  let minD = Infinity, at = [0, 0];
  const n = c.path.length;
  for (let i = 0; i < n; i += 2) for (let j = i + 50; j < n; j += 2) {
    if (n - (j - i) < 50) continue;
    const d = Math.hypot(c.path[i].x - c.path[j].x, c.path[i].z - c.path[j].z);
    if (d < minD) { minD = d; at = [i / n, j / n]; }
  }
  let minR = Infinity;
  for (const p of c.path) minR = Math.min(minR, 1 / Math.max(1e-6, Math.abs(p.k)));
  const ys = c.path.map((p) => p.y);
  console.log(`${def.name}: 全長 ${c.length.toFixed(0)} m、最小半径 ${minR.toFixed(1)} m、経路どうしの最短距離 ${minD.toFixed(1)} m（${at.map((v) => v.toFixed(2)).join(' と ')}）、標高 ${Math.min(...ys).toFixed(1)}〜${Math.max(...ys).toFixed(1)} m、地形 ${c.terrain.nx}×${c.terrain.nz}、岩 ${c.rocks.length}、タイヤ ${c.tireStacks.length}、壁 ${c.walls.length}`);
}
