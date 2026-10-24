// 地球儀の陸の点を作る。Natural Earth の陸地（1:110m、パブリックドメイン）の GeoJSON を読み、
// フィボナッチ格子の点のうち陸にあるものを 1 ビットずつ並べて src/render/globe-land.ts に書く。
// 実行: npx tsx tools/make-globe.ts <ne_110m_land.geojson>
// 取得元: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson（2026-10-24 取得）
import { readFileSync, writeFileSync } from 'node:fs';
import { fibLatLon } from '../src/render/globe-points';

const N = 60000;
const src = process.argv[2];
if (!src) throw new Error('GeoJSON のパスを渡してください');
type Ring = [number, number][];
const gj = JSON.parse(readFileSync(src, 'utf8')) as { features: { geometry: { type: string; coordinates: unknown } }[] };
const rings: { ring: Ring; box: [number, number, number, number] }[] = [];
for (const f of gj.features) {
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
  for (const poly of polys) for (const ring of poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    rings.push({ ring, box: [x0, y0, x1, y1] });
  }
}

/** 偶奇の規則（穴のある陸にも効く） */
function onLand(lon: number, lat: number) {
  let inside = false;
  for (const { ring, box } of rings) {
    if (lat < box[1] || lat > box[3] || lon < box[0] || lon > box[2]) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const bits = new Uint8Array(Math.ceil(N / 8));
let land = 0, south = 0;
for (let i = 0; i < N; i++) {
  const [lat, lon] = fibLatLon(i, N);
  if (onLand(lon, lat)) { bits[i >> 3] |= 1 << (i & 7); land++; if (lat < -80) south++; }
}
const b64 = Buffer.from(bits).toString('base64');
writeFileSync('src/render/globe-land.ts', `// tools/make-globe.ts が作る。手で直さない。
// 元データ: Natural Earth 1:110m Land（パブリックドメイン）
export const LAND_N = ${N};
export const LAND_BITS = '${b64}';
`);
console.log(`陸 ${land} / ${N} 点（${((land / N) * 100).toFixed(1)}%）、南緯 80° より南 ${south} 点、${b64.length} 文字`);
