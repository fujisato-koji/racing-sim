// 実在のコースのまわり 30 km の地形（遠景）を取り込む。
// 標高は AWS の Terrain Tiles（terrarium 形式、ズーム 11、約 60 m）。各地域の提供元の表示が要る（README と画面に出す）。
// コースの中心を原点に、同心円の格子（半径 150 m から 30 km まで 64 段、角度 256 分割）の標高を書き出す。
// 実行: npx tsx tools/fetch-scenery.ts [id ...]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { terrainAttribution } from '../src/sim/tracks/terrain-credit';

const ZOOM = 11;
const TILE_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const CACHE = 'tools/cache/terrarium';
const OUT = 'src/sim/scenery';
const TRACKS = 'src/sim/tracks';
export const RINGS = { r0: 150, r1: 30000, k: 64, a: 256 };

// ------------------------------------------------------------ PNG（8 ビットの RGB か RGBA、飛び越しなし）
function decodePng(buf: Buffer) {
  let p = 8, w = 0, h = 0, type = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('対応していない PNG'); }
    if (kind === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const ch = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!ch) throw new Error(`対応していない色の形式 ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride), up = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch] : 0, b = up ? up[i] : 0, c = up && i >= ch ? up[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
  }
  // terrarium：標高 = R × 256 + G + B / 256 − 32768
  const e = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) e[i] = out[i * ch] * 256 + out[i * ch + 1] + out[i * ch + 2] / 256 - 32768;
  return { w, h, e };
}

const tiles = new Map<string, Float32Array>();
async function tile(x: number, y: number) {
  const key = `${x}/${y}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const file = `${CACHE}/${ZOOM}/${x}/${y}.png`;
  if (!existsSync(file)) {
    const res = await fetch(TILE_URL(ZOOM, x, y));
    if (!res.ok) throw new Error(`タイル ${key} の取得に失敗 ${res.status}`);
    mkdirSync(`${CACHE}/${ZOOM}/${x}`, { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const { e } = decodePng(readFileSync(file));
  tiles.set(key, e);
  return e;
}

/** 緯度経度を、ズーム 11 の世界全体の画素の位置に */
function pixel(lat: number, lon: number) {
  const n = 2 ** ZOOM * 256;
  const s = Math.sin((lat * Math.PI) / 180);
  return { px: ((lon + 180) / 360) * n, py: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

async function elevation(lat: number, lon: number) {
  const { px, py } = pixel(lat, lon);
  const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5), fx = px - 0.5 - x0, fy = py - 0.5 - y0;
  const at = async (x: number, y: number) => { const t = await tile(x >> 8, y >> 8); return t[(y & 255) * 256 + (x & 255)]; };
  const a = await at(x0, y0), b = await at(x0 + 1, y0), c = await at(x0, y0 + 1), d = await at(x0 + 1, y0 + 1);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

async function run(id: string) {
  const j = JSON.parse(readFileSync(`${TRACKS}/${id}.json`, 'utf8')) as { country: string; points: number[]; elev: number[]; source: { center: [number, number] } };
  const [lat0, lon0] = j.source.center;
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180), mz = 110574;
  const toLL = (x: number, z: number) => ({ lat: lat0 - z / mz, lon: lon0 + x / mx });
  // コースの標高は最も低い点を 0 にしてある。地形の標高との差を、コースの点で比べて決める
  const diffs: number[] = [];
  const n = j.points.length / 2, step = Math.max(1, Math.floor(n / 200));
  for (let i = 0; i < n; i += step) {
    const { lat, lon } = toLL(j.points[2 * i], j.points[2 * i + 1]);
    const k = Math.min(j.elev.length - 1, Math.round((i / n) * j.elev.length));
    diffs.push((await elevation(lat, lon)) - j.elev[k]);
  }
  diffs.sort((a, b) => a - b);
  const offset = diffs[Math.floor(diffs.length / 2)];
  const { r0, r1, k: K, a: A } = RINGS;
  const h = new Int16Array((K + 1) * A);
  let sea = 0;
  for (let k = 0; k <= K; k++) {
    const r = r0 * (r1 / r0) ** (k / K);
    for (let a = 0; a < A; a++) {
      const t = (a / A) * Math.PI * 2;
      const { lat, lon } = toLL(r * Math.cos(t), r * Math.sin(t));
      const e = await elevation(lat, lon);
      h[k * A + a] = Math.max(-200, Math.min(9000, Math.round(e)));
      if (e <= 0) sea++;
    }
  }
  const out = {
    id, offset: Math.round(offset * 10) / 10, rings: RINGS,
    heights: Buffer.from(h.buffer).toString('base64'),
    source: {
      elevation: 'Terrain Tiles (https://registry.opendata.aws/terrain-tiles/), terrarium zoom 11',
      attribution: terrainAttribution(j.country),
      retrieved: new Date().toISOString().slice(0, 10),
    },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(out));
  console.log(`${id.padEnd(14)} 差 ${offset.toFixed(1)} m、最高 ${Math.max(...h)} m、海 ${((sea / h.length) * 100).toFixed(0)}%、タイル ${tiles.size}`);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(TRACKS).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
for (const id of ids) { await run(id); tiles.clear(); }
