// 実在のコースのまわりの建物を取り込む。形と高さは OpenStreetMap（© OpenStreetMap contributors、ODbL 1.0）を Overpass API で取る。
// 範囲はコースの範囲（コースの外接の四角 + 120 m）と同じ。道に重なる建物（トンネルの上のホテルなど）は除く。
// 高さは height のタグ、無ければ building:levels × 3.2 m、無ければ建物の種類ごとの標準値。
// 実行: npx tsx tools/fetch-buildings.ts [id ...]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const UA = 'racing-sim/0.1 (personal hobby project; https://github.com/fujisato-koji/racing-sim)';
const TRACKS = 'src/sim/tracks';
const OUT = 'src/sim/buildings';
const CACHE = 'tools/cache';
const MARGIN = 120;
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OsmEl { type: 'way' | 'relation'; id: number; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string>; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }

async function overpass(q: string): Promise<{ elements: OsmEl[] }> {
  const file = `${CACHE}/${createHash('sha1').update(`overpass:${q}`).digest('hex').slice(0, 16)}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8'));
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: q }),
    });
    if (r.ok) {
      const v = await r.json();
      writeFileSync(file, JSON.stringify(v));
      await sleep(3000);
      return v;
    }
    console.log(`  Overpass ${r.status}、待って再試行`);
    await sleep(15000 * (attempt + 1));
  }
  throw new Error('Overpass に接続できない');
}

/** 建物の種類（描画の色分け）：0 一般、1 観客席、2 屋根だけ、3 工場と倉庫、4 住宅 */
function kindOf(t: Record<string, string>) {
  const b = t.building ?? 'yes';
  if (b === 'grandstand' || t.leisure === 'stadium') return 1;
  if (b === 'roof' || b === 'carport') return 2;
  if (['industrial', 'warehouse', 'hangar', 'manufacture'].includes(b)) return 3;
  if (['house', 'detached', 'semidetached_house', 'bungalow', 'terrace', 'farm'].includes(b)) return 4;
  return 0;
}

function heightOf(t: Record<string, string>) {
  const num = (s?: string) => { if (!s) return NaN; const m = s.replace(',', '.').match(/^\s*(\d+(?:\.\d+)?)\s*(m|meters?)?\s*$/); return m ? Number(m[1]) : NaN; };
  const h = num(t.height) || num(t['building:height']);
  if (h > 0) return Math.min(h, 400);
  const lv = num(t['building:levels']);
  if (lv > 0) return Math.min(lv * 3.2 + (num(t['roof:levels']) || 0) * 2, 400);
  const b = t.building ?? 'yes';
  const table: Record<string, number> = {
    house: 7, detached: 7, semidetached_house: 7, bungalow: 4, terrace: 8, farm: 7,
    apartments: 15, residential: 12, hotel: 18, commercial: 12, retail: 8, office: 16,
    industrial: 9, warehouse: 9, hangar: 10, manufacture: 9,
    garage: 3.5, garages: 3.5, shed: 3, hut: 3, kiosk: 3, toilets: 3.5, cabin: 3.5,
    roof: 5, carport: 3, grandstand: 12, church: 16, cathedral: 25, school: 10, train_station: 10, stadium: 18,
  };
  return table[b] ?? 8;
}

/** 閉じた多角形の簡略化（ダグラス・ポイカー） */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const rec = (a: number, b: number) => {
    let dmax = 0, idx = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx > 0) { keep[idx] = 1; rec(a, idx); rec(idx, b); }
  };
  // 最初の点から一番遠い点で 2 つに分けてから
  let far = 1, fd = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[far] = 1;
  rec(0, far); rec(far, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
}

const area = (p: [number, number][]) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + (q[0] * r[1] - r[0] * q[1]); }, 0) / 2;

async function run(id: string) {
  const j = JSON.parse(readFileSync(`${TRACKS}/${id}.json`, 'utf8')) as { width: number; points: number[]; source: { center: [number, number] } };
  const [lat0, lon0] = j.source.center;
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180), mz = 110574;
  const toXZ = (p: { lat: number; lon: number }): [number, number] => [(p.lon - lon0) * mx, -(p.lat - lat0) * mz];
  const track: [number, number][] = [];
  for (let i = 0; i < j.points.length; i += 2) track.push([j.points[i], j.points[i + 1]]);
  const xs = track.map((p) => p[0]), zs = track.map((p) => p[1]);
  const x0 = Math.min(...xs) - MARGIN, x1 = Math.max(...xs) + MARGIN, z0 = Math.min(...zs) - MARGIN, z1 = Math.max(...zs) + MARGIN;
  const s = lat0 - z1 / mz, n = lat0 - z0 / mz, w = lon0 + x0 / mx, e = lon0 + x1 / mx;
  const bbox = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  const data = await overpass(`[out:json][timeout:180];(way["building"](${bbox});relation["building"]["type"="multipolygon"](${bbox}););out geom tags;`);

  // 道までの距離（線分を 40 m の升目に入れて引く）
  const cell = 40, grid = new Map<string, number[]>();
  for (let i = 0; i < track.length; i++) {
    const a = track[i], b = track[(i + 1) % track.length];
    const ka = `${Math.floor(Math.min(a[0], b[0]) / cell)},${Math.floor(Math.min(a[1], b[1]) / cell)}`;
    for (let gx = Math.floor(Math.min(a[0], b[0]) / cell); gx <= Math.floor(Math.max(a[0], b[0]) / cell); gx++)
      for (let gz = Math.floor(Math.min(a[1], b[1]) / cell); gz <= Math.floor(Math.max(a[1], b[1]) / cell); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(i);
      }
    void ka;
  }
  const roadDist = (x: number, z: number) => {
    let best = Infinity;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (const i of grid.get(`${gx + u},${gz + v}`) ?? []) {
      const a = track[i], b = track[(i + 1) % track.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
    }
    return best;
  };
  const inside = (x: number, z: number, p: [number, number][]) => {
    let c = false;
    for (let i = 0, k = p.length - 1; i < p.length; k = i++) if ((p[i][1] > z) !== (p[k][1] > z) && x < ((p[k][0] - p[i][0]) * (z - p[i][1])) / (p[k][1] - p[i][1]) + p[i][0]) c = !c;
    return c;
  };

  const out: number[] = [];
  let count = 0, dropRoad = 0, dropSmall = 0;
  const rings: { ring: { lat: number; lon: number }[]; tags: Record<string, string> }[] = [];
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    if (Number(tags.min_height) > 0 || Number(tags['building:min_level']) > 0 || tags.layer && Number(tags.layer) < 0 || tags.location === 'underground') continue;
    if (el.type === 'way' && el.geometry) rings.push({ ring: el.geometry, tags });
    if (el.type === 'relation') for (const m of el.members ?? []) if (m.role === 'outer' && m.geometry) rings.push({ ring: m.geometry, tags });
  }
  for (const { ring, tags } of rings) {
    let pts = ring.map(toXZ);
    if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts.pop();
    pts = simplify(pts, 0.4);
    if (pts.length < 3) continue;
    const A = area(pts);
    if (Math.abs(A) < 12) { dropSmall++; continue; }
    if (A < 0) pts.reverse();
    // 道に重なる、または道が中を通る建物は除く
    const half = j.width / 2;
    if (pts.some(([x, z]) => roadDist(x, z) < half + 1.5) || track.some(([x, z], i) => i % 3 === 0 && inside(x, z, pts))) { dropRoad++; continue; }
    const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length, cz = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
    if (cx < x0 || cx > x1 || cz < z0 || cz > z1) continue;
    out.push(pts.length, Math.round(heightOf(tags) * 10), kindOf(tags));
    for (const [x, z] of pts) out.push(Math.round(x * 2), Math.round(z * 2));
    count++;
  }
  const buf = Buffer.from(new Int16Array(out).buffer);
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify({
    id, count, data: buf.toString('base64'),
    source: { shape: 'OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0), Overpass API', retrieved: today },
  }));
  console.log(`${id.padEnd(14)} 建物 ${count}（道に重なり除外 ${dropRoad}、小さすぎ ${dropSmall}）、${(buf.length / 1024).toFixed(0)} KB`);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(TRACKS).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
for (const id of ids) await run(id);
