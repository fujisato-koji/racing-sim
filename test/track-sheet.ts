// 実在のコース 20 本を 1 枚に並べた図（確認用）。白い点がスタート、黄色い線が走る向き（スタートから 150 m）。
// 実行: npx tsx test/track-sheet.ts <出力先 PNG>
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildCourse } from '../src/sim/course';
import { REAL_COURSES } from '../src/sim/tracks';

const out = process.argv[2] ?? 'sheet.png';
const T = 260, COLS = 5, ROWS = Math.ceil(REAL_COURSES.length / COLS);
const W = T * COLS, H = T * ROWS;
const img = new Uint8Array(W * H * 3).fill(28);

function crc32(buf: Uint8Array) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function png(w: number, h: number, rgb: Uint8Array) {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length); b.set(new TextEncoder().encode(type), 4); b.set(data, 8);
    dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length)));
    return b;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const res = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { res.set(p, o); o += p.length; }
  return res;
}
const dot = (x: number, y: number, r: number, col: number[]) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    img.set(col, (py * W + px) * 3);
  }
};

REAL_COURSES.forEach((def, k) => {
  const c = buildCourse(def);
  const ox = (k % COLS) * T, oy = Math.floor(k / COLS) * T;
  const xs = c.path.map((p) => p.x), zs = c.path.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sc = (T - 30) / Math.max(maxX - minX, maxZ - minZ);
  const to = (x: number, z: number): [number, number] => [ox + 15 + (x - minX) * sc + ((T - 30) - (maxX - minX) * sc) / 2, oy + 15 + (z - minZ) * sc + ((T - 30) - (maxZ - minZ) * sc) / 2];
  const ymax = Math.max(...c.path.map((p) => p.y)) || 1;
  for (const p of c.path) {
    const [x, y] = to(p.x, p.z);
    // 高いほど明るく、橋は赤
    const v = 90 + Math.round((p.y / ymax) * 160);
    dot(x, y, 1, p.bridge ? [230, 60, 60] : [v, v, v]);
  }
  for (let s = 0; s < Math.min(150, c.path.length); s++) { const [x, y] = to(c.path[s].x, c.path[s].z); dot(x, y, 2, [255, 210, 0]); }
  const [sx, sy] = to(c.path[0].x, c.path[0].z);
  dot(sx, sy, 4, [255, 255, 255]);
  console.log(`${k}: ${def.name} ${c.length.toFixed(0)} m、最小半径 ${Math.min(...c.path.map((p) => 1 / Math.max(1e-6, Math.abs(p.k)))).toFixed(1)} m、バンク最大 ${((Math.max(...c.path.map((p) => Math.abs(p.bank))) * 180) / Math.PI).toFixed(1)}°、壁 ${c.walls.length}、建物 ${c.buildings.length}、柱 ${c.pillars.length}`);
});
writeFileSync(out, png(W, H, img));
