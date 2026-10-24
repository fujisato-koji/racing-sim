// 実在のサーキットの形と標高を取り込む（手元で一度だけ動かし、結果の JSON をリポジトリに入れる）。
// 形：OpenStreetMap（© OpenStreetMap contributors、ODbL 1.0）を Overpass API で取る。
// 標高：日本は国土地理院の標高 API、ほかは OpenTopoData（NED 10 m、EU-DEM 25 m、SRTM 30 m）。
// 実行: npx tsx tools/fetch-tracks.ts [id ...]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { TrackSource } from './track-list';
import { TRACK_SOURCES } from './track-list';

const UA = 'racing-sim/0.1 (personal hobby project; https://github.com/fujisato-koji/racing-sim)';
const OUT = 'src/sim/tracks';
const CACHE = 'tools/cache';
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });
const today = new Date().toISOString().slice(0, 10);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cached<T>(key: string, f: () => Promise<T>): Promise<T> {
  const file = `${CACHE}/${createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8')) as T;
  const v = await f();
  writeFileSync(file, JSON.stringify(v));
  return v;
}

async function overpass(q: string): Promise<{ elements: OsmEl[] }> {
  return cached(`overpass:${q}`, async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: q }),
      });
      if (r.ok) { await sleep(2000); return r.json(); }
      console.log(`  Overpass ${r.status}、待って再試行`);
      await sleep(10000 * (attempt + 1));
    }
    throw new Error('Overpass に接続できない');
  });
}

interface OsmEl { type: 'way' | 'relation' | 'node'; id: number; nodes?: number[]; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string>; members?: { type: string; ref: number; role: string }[] }

// ピットロードとカートコースなど（名前に「Pits Straight」「Paddock Hill」を含むコース本体は除かない）
const PIT = /pit ?lane|pitlane|pit road|pit entr|pit exit|pit-?in|pit-?out|boxengasse|voie des stands|sortie des stands|entr[ée]e des stands|corsia box|pitstraat|bokszutca|ピット|warm ?up lane/i;
const EXCLUDE = new RegExp(`${PIT.source}|kart|カート|drag ?strip|run-?off|escape road|service road`, 'i');

interface Edge { id: number; a: number; b: number; pts: { lat: number; lon: number }[]; len: number; oneway: boolean; flag: 'bridge' | 'tunnel' | null; way: number }

function dist(p: { lat: number; lon: number }, q: { lat: number; lon: number }) {
  const dy = (q.lat - p.lat) * 110574, dx = (q.lon - p.lon) * 111320 * Math.cos((p.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

function polyLen(pts: { lat: number; lon: number }[]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** 区間を分かれ道で切って辺にする */
function buildEdges(ways: OsmEl[]): Edge[] {
  const count = new Map<number, number>();
  for (const w of ways) w.nodes!.forEach((n, i) => {
    const end = i === 0 || i === w.nodes!.length - 1;
    count.set(n, (count.get(n) ?? 0) + (end ? 2 : 1));
  });
  const edges: Edge[] = [];
  for (const w of ways) {
    const t = w.tags ?? {};
    // 一方通行はサーキットの区間だけ見る（公道の一方通行は一般車の向きで、レースの向きとは限らない）
    const raceway = t.highway === 'raceway';
    const oneway = raceway && (t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1');
    const reverse = oneway && t.oneway === '-1';
    const flag = t.bridge && t.bridge !== 'no' ? 'bridge' : t.tunnel && t.tunnel !== 'no' ? 'tunnel' : null;
    let nodes = w.nodes!, geo = w.geometry!;
    if (reverse) { nodes = [...nodes].reverse(); geo = [...geo].reverse(); }
    let start = 0;
    for (let i = 1; i < nodes.length; i++) {
      if ((count.get(nodes[i]) ?? 0) >= 2 || i === nodes.length - 1) {
        const pts = geo.slice(start, i + 1);
        edges.push({ id: edges.length, a: nodes[start], b: nodes[i], pts, len: polyLen(pts), oneway, flag, way: w.id });
        start = i;
      }
    }
  }
  return edges;
}

/** 周回で曲がる量の合計 [rad] */
function turning(cyc: { e: Edge; fwd: boolean }[]) {
  const pts: { lat: number; lon: number }[] = [];
  for (const { e, fwd } of cyc) { const q = fwd ? e.pts : [...e.pts].reverse(); pts.push(...q.slice(pts.length ? 1 : 0)); }
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    if (dist(a, b) < 2 || dist(b, c) < 2) continue;
    const h1 = Math.atan2(b.lon - a.lon, b.lat - a.lat), h2 = Math.atan2(c.lon - b.lon, c.lat - b.lat);
    let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    sum += Math.abs(d);
  }
  return sum;
}

/** 長さが target に近い周回を探す（辺を一度ずつしか使わない）。オーバルは寄り道の少ないものを選ぶ */
function findCycle(edges: Edge[], target: number, oval = false): { edges: { e: Edge; fwd: boolean }[]; len: number } | null {
  const found = findCycles(edges, target);
  if (found.length === 0) return null;
  const score = (c: { edges: { e: Edge; fwd: boolean }[]; len: number }) => Math.abs(c.len - target) / target + (oval ? 0.03 * Math.max(0, turning(c.edges) - 2 * Math.PI) : 0);
  found.sort((a, b) => score(a) - score(b));
  return found[0];
}

function findCycles(edges: Edge[], target: number): { edges: { e: Edge; fwd: boolean }[]; len: number }[] {
  const adj = new Map<number, { e: Edge; fwd: boolean }[]>();
  const add = (n: number, x: { e: Edge; fwd: boolean }) => { if (!adj.has(n)) adj.set(n, []); adj.get(n)!.push(x); };
  for (const e of edges) {
    add(e.a, { e, fwd: true });
    if (!e.oneway) add(e.b, { e, fwd: false });
  }
  const found: { edges: { e: Edge; fwd: boolean }[]; len: number }[] = [];
  const seen = new Set<string>();
  let steps = 0;
  const maxLen = target * 1.12;
  for (const start of edges) {
    if (steps > 3e6) break;
    const path: { e: Edge; fwd: boolean }[] = [{ e: start, fwd: true }];
    const usedE = new Set([start.id]);
    const usedN = new Set([start.a]);
    const s0 = start.a;
    const dfs = (node: number, len: number) => {
      if (++steps > 3e6) return;
      if (node === s0) {
        if (len > target * 0.9 && len < target * 1.1) {
          const key = path.map((x) => x.e.id).sort((a, b) => a - b).join(',');
          if (!seen.has(key) && found.length < 400) { seen.add(key); found.push({ edges: [...path], len }); }
        }
        return;
      }
      if (usedN.has(node)) return;
      usedN.add(node);
      for (const x of adj.get(node) ?? []) {
        if (usedE.has(x.e.id)) continue;
        const nl = len + x.e.len;
        if (nl > maxLen) continue;
        usedE.add(x.e.id); path.push(x);
        dfs(x.fwd ? x.e.b : x.e.a, nl);
        path.pop(); usedE.delete(x.e.id);
      }
      usedN.delete(node);
    };
    dfs(start.b, start.len);
  }
  return found;
}

async function elevations(src: TrackSource, pts: { lat: number; lon: number }[]): Promise<(number | null)[]> {
  if (src.dem === 'flat') return pts.map(() => 0);
  if (src.dem === 'gsi') {
    const out: (number | null)[] = [];
    for (const p of pts) {
      const v = await cached(`gsi:${p.lat.toFixed(6)},${p.lon.toFixed(6)}`, async () => {
        const url = `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${p.lon}&lat=${p.lat}&outtype=JSON`;
        for (let a = 0; a < 4; a++) {
          const r = await fetch(url, { headers: { 'User-Agent': UA } });
          if (r.ok) { await sleep(120); return r.json(); }
          await sleep(3000);
        }
        return { elevation: '-----' };
      }) as { elevation: number | string };
      out.push(typeof v.elevation === 'number' ? v.elevation : null);
    }
    return out;
  }
  const out: (number | null)[] = [];
  for (let i = 0; i < pts.length; i += 100) {
    const chunk = pts.slice(i, i + 100);
    const loc = chunk.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
    const res = await cached(`otd:${src.dem}:${loc}`, async () => {
      for (let a = 0; a < 5; a++) {
        const r = await fetch(`https://api.opentopodata.org/v1/${src.dem}?locations=${loc}`, { headers: { 'User-Agent': UA } });
        if (r.ok) { await sleep(1200); return r.json(); }
        console.log(`  OpenTopoData ${r.status}、待って再試行`);
        await sleep(5000 * (a + 1));
      }
      throw new Error('OpenTopoData に接続できない');
    }) as { results: { elevation: number | null }[] };
    for (const r of res.results) out.push(r.elevation);
  }
  return out;
}

function resample(pts: { x: number; z: number; f: Edge['flag'] }[], step: number) {
  const out: { x: number; z: number; f: Edge['flag'] }[] = [];
  const n = pts.length;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    let d = carry;
    while (d < L) {
      const t = d / L;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, f: a.f });
      d += step;
    }
    carry = d - L;
  }
  return out;
}

/** 周回の長さを n 等分して点を置き直す（継ぎ目も同じ間隔にする） */
function resampleUniform(pts: { x: number; z: number; f: Edge['flag'] }[], step: number) {
  const m = pts.length;
  const cum = [0];
  for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m]; cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z)); }
  const L = cum[m];
  const n = Math.max(8, Math.round(L / step));
  const out: { x: number; z: number; f: Edge['flag'] }[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / n) * L;
    while (j < m - 1 && cum[j + 1] < d) j++;
    const a = pts[j], b = pts[(j + 1) % m];
    const t = (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, f: a.f });
  }
  return out;
}

function smoothCyclic(v: number[], half: number) {
  const n = v.length, out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    for (let j = -half; j <= half; j++) {
      const k = Math.exp(-(j * j) / (2 * (half / 2) ** 2));
      s += v[(i + j + n) % n] * k; w += k;
    }
    out[i] = s / w;
  }
  return out;
}

async function run(src: TrackSource) {
  console.log(`\n== ${src.nameJa}（${src.id}）`);
  const [lat, lon] = src.center;
  const q = `[out:json][timeout:120];(way(around:${src.radius},${lat},${lon})["highway"="raceway"];rel(around:${src.radius},${lat},${lon})["type"="circuit"];)->.a;(.a;way(r.a););out body geom;`;
  const data = await overpass(q);
  const all = data.elements.filter((e) => e.type === 'way' && e.nodes && e.geometry);
  const rels = data.elements.filter((e) => e.type === 'relation');
  const isPit = (w: OsmEl) => EXCLUDE.test(Object.values(w.tags ?? {}).join(' ')) || w.tags?.service === 'pit_lane' || w.tags?.raceway === 'pitlane';
  const usable = all.filter((w) => !isPit(w) && w.tags?.area !== 'yes');
  const edges = buildEdges(usable);
  // 地図の描き方で区間の端がつながっていないことがあるので、20 m 以内の行き止まりどうしをつなぐ
  {
    const deg = new Map<number, number>(), pos = new Map<number, { lat: number; lon: number }>();
    for (const e of edges) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
      pos.set(e.a, e.pts[0]); pos.set(e.b, e.pts[e.pts.length - 1]);
    }
    const dead = [...deg].filter(([, d]) => d === 1).map(([n]) => n);
    let joined = 0;
    const used = new Set<number>();
    for (const a of dead) {
      if (used.has(a)) continue;
      let best = -1, bd = 20;
      for (const b of dead) {
        if (b === a || used.has(b)) continue;
        const d = dist(pos.get(a)!, pos.get(b)!);
        if (d < bd) { bd = d; best = b; }
      }
      if (best >= 0) {
        used.add(a); used.add(best);
        edges.push({ id: edges.length, a, b: best, pts: [pos.get(a)!, pos.get(best)!], len: bd, oneway: false, flag: null, way: 0 });
        joined++;
      }
    }
    if (joined) console.log(`  行き止まりを ${joined} か所つないだ`);
  }
  console.log(`  区間 ${all.length}（使う ${usable.length}）、周回の関係 ${rels.map((r) => r.tags?.name).join(' / ') || 'なし'}、辺 ${edges.length}`);
  const cyc = findCycle(edges, src.length, src.type === 'oval');
  if (!cyc) { console.log('  周回が見つからない'); return null; }
  console.log(`  周回 ${cyc.len.toFixed(0)} m（公式 ${src.length} m、差 ${(((cyc.len - src.length) / src.length) * 100).toFixed(1)}%）、辺 ${cyc.edges.length}`);

  // 周回の点の並び（緯度経度）
  const ll: { lat: number; lon: number; f: Edge['flag'] }[] = [];
  for (const { e, fwd } of cyc.edges) {
    const pts = fwd ? e.pts : [...e.pts].reverse();
    for (let i = ll.length === 0 ? 0 : 1; i < pts.length; i++) ll.push({ ...pts[i], f: e.flag });
  }
  if (dist(ll[0], ll[ll.length - 1]) < 0.5) ll.pop();
  const lat0 = ll.reduce((s, p) => s + p.lat, 0) / ll.length, lon0 = ll.reduce((s, p) => s + p.lon, 0) / ll.length;
  const toXZ = (p: { lat: number; lon: number }) => ({ x: (p.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), z: -(p.lat - lat0) * 110574 });
  const toLL = (x: number, z: number) => ({ lat: lat0 - z / 110574, lon: lon0 + x / (111320 * Math.cos((lat0 * Math.PI) / 180)) });
  let pts = resampleUniform(ll.map((p) => ({ ...toXZ(p), f: p.f })), 4);

  // 向きとスタート：ピットロードの中ほどに最も近い点をスタートに、ピットロードの向きをレースの向きにする
  const pits = all.filter((w) => (PIT.test(Object.values(w.tags ?? {}).join(' ')) || w.tags?.service === 'pit_lane' || w.tags?.raceway === 'pitlane') && w.tags?.highway === 'raceway');
  pits.sort((a, b) => polyLen(b.geometry!) - polyLen(a.geometry!));
  let how = '';
  const area = pts.reduce((s, p, i) => { const q2 = pts[(i + 1) % pts.length]; return s + (p.x * q2.z - q2.x * p.z); }, 0) / 2;
  if (pits.length > 0 && pits[0].tags?.oneway && pits[0].tags.oneway !== 'no') {
    let g = pits[0].geometry!;
    if (pits[0].tags.oneway === '-1') g = [...g].reverse();
    const mid = toXZ(g[Math.floor(g.length / 2)]), nxt = toXZ(g[Math.min(g.length - 1, Math.floor(g.length / 2) + 2)]);
    let bi = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = (p.x - mid.x) ** 2 + (p.z - mid.z) ** 2; if (d < bd) { bd = d; bi = i; } });
    const a = pts[bi], b = pts[(bi + 2) % pts.length];
    const dot = (b.x - a.x) * (nxt.x - mid.x) + (b.z - a.z) * (nxt.z - mid.z);
    if (dot < 0) { pts.reverse(); bi = pts.length - 1 - bi; }
    pts = [...pts.slice(bi), ...pts.slice(0, bi)];
    how = `ピットロード（${pits[0].tags?.name ?? pits[0].id}）の向き`;
  } else {
    // x 東、z 南の座標では、上から見て時計回りのとき面積が正
    const cw = area > 0;
    if ((src.direction === 'cw') !== cw) pts.reverse();
    // スタートは最も長い直線の中ほど
    const k = pts.map((p, i) => {
      const a = pts[(i - 3 + pts.length) % pts.length], b = pts[(i + 3) % pts.length];
      const h1 = Math.atan2(p.x - a.x, p.z - a.z), h2 = Math.atan2(b.x - p.x, b.z - p.z);
      let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      return Math.abs(d);
    });
    let bestS = 0, bestL = 0, runS = -1;
    for (let i = 0; i < pts.length * 2; i++) {
      const straight = k[i % pts.length] < 0.02;
      if (straight && runS < 0) runS = i;
      if (!straight && runS >= 0) { if (i - runS > bestL) { bestL = i - runS; bestS = runS; } runS = -1; }
    }
    const si = (bestS + Math.floor(bestL / 2)) % pts.length;
    pts = [...pts.slice(si), ...pts.slice(0, si)];
    how = `向きは ${src.direction}、スタートは最も長い直線（${(bestL * 4).toFixed(0)} m）の中ほど`;
  }
  console.log(`  ${how}`);

  // 角をならしてから 8 m ごとに
  const xs = smoothCyclic(pts.map((p) => p.x), 3), zs = smoothCyclic(pts.map((p) => p.z), 3);
  // 半径 9 m 未満の角は、まわりの点ごと少しずつ丸める（地図の点のつなぎ目で角張ったところ）
  {
    const m = xs.length;
    const radius = (i: number) => {
      const a = [xs[(i - 2 + m) % m], zs[(i - 2 + m) % m]], b = [xs[i], zs[i]], c = [xs[(i + 2) % m], zs[(i + 2) % m]];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      return cross < 1e-6 ? Infinity : (ab * bc * ca) / (2 * cross);
    };
    for (let it = 0; it < 60; it++) {
      const bad: number[] = [];
      for (let i = 0; i < m; i++) if (radius(i) < 9) bad.push(i);
      if (bad.length === 0) break;
      for (const i of bad) for (let j = -2; j <= 2; j++) {
        const k = (i + j + m) % m;
        xs[k] = (xs[(k - 1 + m) % m] + 2 * xs[k] + xs[(k + 1) % m]) / 4;
        zs[k] = (zs[(k - 1 + m) % m] + 2 * zs[k] + zs[(k + 1) % m]) / 4;
      }
    }
  }
  const sm = resampleUniform(pts.map((p, i) => ({ x: xs[i], z: zs[i], f: p.f })), 8);

  // 標高：24 m ごとに引き、橋とトンネルは前後から直線でつなぐ
  const every = 3;
  const sampleIdx = sm.map((_, i) => i).filter((i) => i % every === 0);
  const ev = await elevations(src, sampleIdx.map((i) => toLL(sm[i].x, sm[i].z)));
  const n = sm.length;
  const raw: (number | null)[] = new Array(n).fill(null);
  sampleIdx.forEach((i, k) => { raw[i] = sm[i].f ? null : ev[k]; });
  const known = raw.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (known.length < 4) { console.log('  標高が取れない'); return null; }
  const elev: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    // 前後で最も近い既知の点から直線で
    let a = -1, b = -1;
    for (let d = 0; d < n && (a < 0 || b < 0); d++) {
      if (a < 0 && raw[(i - d + n) % n] !== null) a = (i - d + n) % n;
      if (b < 0 && raw[(i + d) % n] !== null) b = (i + d) % n;
    }
    const da = (i - a + n) % n, db = (b - i + n) % n;
    elev[i] = da + db === 0 ? raw[a]! : (raw[a]! * db + raw[b]! * da) / (da + db);
  }
  // SRTM は建物や木の高さを含むので、街では強くならす
  const es = smoothCyclic(elev, src.dem === 'srtm30m' ? 10 : 5);
  // 標高データは崖や建物のそばで高さを拾うことがあるので、勾配と勾配の変わり目に上限を置く
  // （実際の急坂：スパのラディオン、ラグナ・セカのコークスクリューで 17〜18%、モナコで 1 割前後）
  const street = src.type === 'street' || src.type === 'oval';
  const gmax = street ? 0.1 : 0.18, rmin = street ? 200 : 120, step = 8;
  for (let it = 0; it < 400; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const g = (es[j] - es[i]) / step;
      if (Math.abs(g) > gmax) {
        const fix = ((Math.abs(g) - gmax) * step) / 2 * Math.sign(g);
        es[i] += fix; es[j] -= fix; changed = true;
      }
    }
    for (let i = 0; i < n; i++) {
      const a = es[(i - 1 + n) % n], b = es[i], c = es[(i + 1) % n];
      const curv = (a - 2 * b + c) / (step * step);
      if (Math.abs(curv) > 1 / rmin) { es[i] = b + (curv - Math.sign(curv) / rmin) * step * step * 0.5; changed = true; }
    }
    if (!changed) break;
  }
  let maxG = 0;
  for (let i = 0; i < n; i++) maxG = Math.max(maxG, Math.abs(es[(i + 1) % n] - es[i]) / step);
  console.log(`  最大勾配 ${(maxG * 100).toFixed(1)}%`);
  const emin = Math.min(...es);
  const bridges = sm.map((p) => (p.f === 'bridge' ? 1 : 0));
  let L = 0;
  for (let i = 0; i < n; i++) L += Math.hypot(sm[(i + 1) % n].x - sm[i].x, sm[(i + 1) % n].z - sm[i].z);
  const out = {
    id: src.id, name: src.name, nameJa: src.nameJa, country: src.country, type: src.type, width: src.width, laps: src.laps,
    lengthOfficial: src.length, length: Math.round(L), banking: src.banking ?? null,
    points: sm.flatMap((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]),
    elev: es.map((e) => Math.round((e - emin) * 100) / 100),
    bridge: bridges,
    source: {
      shape: 'OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0), Overpass API',
      ways: [...new Set(cyc.edges.map((x) => x.e.way).filter((w) => w > 0))],
      relations: rels.map((r) => ({ id: r.id, name: r.tags?.name ?? '' })),
      elevation: src.dem === 'gsi' ? '国土地理院 標高 API（地理院タイル DEM）' : `OpenTopoData ${src.dem}`,
      center: [lat0, lon0],
      retrieved: today,
    },
  };
  writeFileSync(`${OUT}/${src.id}.json`, JSON.stringify(out));
  console.log(`  書き出し：${n} 点、長さ ${Math.round(L)} m、高低差 ${(Math.max(...es) - emin).toFixed(1)} m`);
  return out;
}

const want = process.argv.slice(2);
for (const src of TRACK_SOURCES) {
  if (want.length && !want.includes(src.id)) continue;
  try { await run(src); } catch (e) { console.log(`  失敗：${String(e)}`); }
}
