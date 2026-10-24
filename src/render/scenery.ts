// 遠景：コースのまわり 30 km の地形、海、市街地の街並み。
// 実在のコースは標高データ（Terrain Tiles を tools/fetch-scenery.ts で取り込んだもの）、作ったコースは雑音から作る。
// 遠くまで写すカメラで先に描き、そのあと手前（コースの地形と物）を重ねる。描くのは層 1。
import * as THREE from 'three';
import type { CourseData } from '../sim/course';
import type { SceneryData } from '../sim/terrain-sampler';
import { decodeHeights } from '../sim/terrain-sampler';

export type { SceneryData };

export const SCENERY_LAYER = 1;

export type Biome = 'temperate' | 'dry' | 'mediterranean' | 'tropical';

export interface SceneryStyle {
  biome: Biome;
  /** 市街地の建物（半径 [m]、高さの幅 [m]） */
  city?: { radius: number; height: [number, number] };
  /** 作ったコースの山の強さ（0〜1.5） */
  mountains?: number;
  /** 海面の標高 [m]（カスピ海は −28） */
  seaLevel?: number;
  /** 植生の色（植生の種類の標準を上書き） */
  palette?: Partial<Palette>;
  /** 街の建物の外壁の色 */
  facades?: number[];
  /** 水の色 */
  water?: number;
}

export interface Palette { meadow: number; field: number; forest: number; rock: number; beach: number }

/** 植生の種類の標準に、テーマの色を重ねる */
export function paletteOf(style: SceneryStyle): Palette {
  return { ...PALETTES[style.biome], ...style.palette };
}

const files = import.meta.glob<SceneryData>('../sim/scenery/*.json', { import: 'default' });

export async function loadScenery(id: string): Promise<SceneryData | null> {
  const f = files[`../sim/scenery/${id}.json`];
  try { return f ? await f() : null; } catch { return null; }
}

// ------------------------------------------------------------ 雑音
function hash(ix: number, iz: number, seed: number) {
  let h = (ix * 73856093) ^ (iz * 19349663) ^ (seed * 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 65536) / 65536;
}
function noise(x: number, z: number, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}
function fbm(x: number, z: number, seed = 0) {
  return 0.55 * noise(x, z, seed) + 0.28 * noise(x * 2.1 + 5, z * 2.1 - 3, seed) + 0.17 * noise(x * 4.3 - 9, z * 4.3 + 7, seed);
}
/** 尾根の続く山（1 − |雑音| を重ねる） */
function ridged(x: number, z: number, seed = 0) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < 4; o++) { const n = 1 - Math.abs(noise(x * f, z * f, seed + o)); s += a * n * n; a *= 0.5; f *= 2.03; }
  return s;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------ 色
const PALETTES: Record<Biome, Palette> = {
  temperate: { meadow: 0x6f8c46, field: 0x93a057, forest: 0x34512a, rock: 0x7b766c, beach: 0xd3c69e },
  dry: { meadow: 0xb39c62, field: 0xc4ad73, forest: 0x6a6b3c, rock: 0x9b8b73, beach: 0xdccca2 },
  mediterranean: { meadow: 0x87894f, field: 0xa39e64, forest: 0x4c5f35, rock: 0xa29a8c, beach: 0xd9cba3 },
  tropical: { meadow: 0x5e9a3d, field: 0x7fae4c, forest: 0x2c6a2b, rock: 0x6f6a5f, beach: 0xe0d2a6 },
};
const SNOW = 0xf1f4f8, CITY = 0x8e9096;

const _c = new THREE.Color();

/** 森の濃さ（0〜1）。斜面と丘ほど濃い。木を植える場所にも使う */
export function forestAmount(x: number, z: number, slope: number, seed = 1, n1 = fbm(x / 900, z / 900, seed + 11), n3 = noise(x / 40, z / 40, seed + 23)) {
  return Math.max(0, Math.min(1, smooth(0.04, 0.2, slope) * 0.85 + smooth(-0.1, 0.35, n1) * 0.55 - 0.15 + 0.12 * n3));
}

/**
 * 地面の色（色空間は描画の線形）。平らな低地は草地と畑、斜面と丘は森、急な所は岩、高い所は雪、水際は浜。
 * abs は標高 [m]、aboveSea は水面からの高さ [m]
 */
export function natureColor(out: THREE.Color, x: number, z: number, slope: number, abs: number, aboveSea: number, pal: Palette, seed = 1) {
  const n1 = fbm(x / 900, z / 900, seed + 11), n2 = noise(x / 260, z / 260, seed + 17), n3 = noise(x / 40, z / 40, seed + 23);
  const forest = forestAmount(x, z, slope, seed, n1, n3);
  out.setHex(pal.meadow);
  if (n2 > 0.3 && slope < 0.08) out.lerp(_c.setHex(pal.field), 0.7);
  out.lerp(_c.setHex(pal.forest), forest);
  out.lerp(_c.setHex(pal.rock), smooth(0.55, 1.0, slope));
  const snowLine = 2700 + 250 * n1;
  if (abs > snowLine) out.lerp(_c.setHex(SNOW), smooth(snowLine, snowLine + 250, abs) * (1 - smooth(0.9, 1.4, slope) * 0.5));
  if (aboveSea > 0.5 && aboveSea < 6) out.lerp(_c.setHex(pal.beach), 0.8);
  // 明るさに少しむらを付ける
  out.multiplyScalar(0.93 + 0.1 * n2);
  return out;
}

/** 市街地の色を混ぜる（平らな所だけ。急な斜面は植生のまま）。色はテーマの外壁の色から作り、屋根のむらを付ける */
export function cityMix(out: THREE.Color, x: number, z: number, slope: number, style: SceneryStyle) {
  const city = style.city;
  if (!city) return out;
  const r = Math.hypot(x, z);
  if (r >= city.radius || slope >= 0.3) return out;
  const f = style.facades ?? [CITY];
  const n = 0.5 + 0.5 * noise(x / 55, z / 55, 41), m = 0.5 + 0.5 * noise(x / 23 + 7, z / 23 - 3, 43);
  _c.setHex(f[Math.floor(n * f.length) % f.length]).lerp(_c2.setHex(f[Math.floor(m * f.length) % f.length]), 0.5).multiplyScalar(0.72 + 0.2 * m);
  out.lerp(_c, 0.7 * (1 - smooth(city.radius * 0.6, city.radius, r)) * (1 - smooth(0.15, 0.3, slope)));
  return out;
}
const _c2 = new THREE.Color();

/** 街の建物の材質。壁の色はインスタンスの色、窓は高さ 3.4 m ごとの帯と縦の桟 */
function cityMaterial(glassy: boolean) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.winColor = { value: new THREE.Color(glassy ? 0x5f7f9c : 0x2a3340) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;\nvarying float vCityUp;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp;
        #endif
        vCityPos = (modelMatrix * cwp).xyz;
        vCityUp = abs(normal.y);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;\nvarying float vCityUp;\nuniform vec3 winColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fl = fract(vCityPos.y / 3.4);
        float col = fract((vCityPos.x + vCityPos.z) / 2.8);
        float win = step(0.36, fl) * step(fl, 0.74) * step(0.14, col) * (1.0 - step(0.5, vCityUp)) * step(2.2, vCityPos.y - floor(vCityPos.y / 3.4) * 0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, winColor, win * 0.85);
        diffuseColor.rgb *= mix(1.0, 0.82, vCityUp);`);
  };
  return m;
}

export interface SceneryMesh {
  group: THREE.Group;
  dispose(): void;
}

/** 遠景を作る。data が無ければ雑音から作る */
export function buildScenery(c: CourseData, data: SceneryData | null, style: SceneryStyle, seed = 1): SceneryMesh {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const rings = data?.rings ?? { r0: 150, r1: 30000, k: 64, a: 256 };
  const K = rings.k, A = rings.a;
  const radius = (k: number) => rings.r0 * (rings.r1 / rings.r0) ** (k / K);
  const abs = data ? decodeHeights(data) : null;
  const offset = data?.offset ?? 0;
  const seaLevel = style.seaLevel ?? 0;
  const seaY = data ? seaLevel - offset : -Infinity;
  const isSea = (e: number) => !!data && e <= seaLevel + 0.5;
  const { x0, z0, x1, z1 } = c.bounds;
  const mtn = style.mountains ?? 1;
  const pal = paletteOf(style);
  const waterColor = style.water ?? 0x1c4a68;

  // 頂点の高さ（ゲームの高さ）と、標高（海と雪の判断に使う）
  const nV = (K + 2) * A;
  const pos = new Float32Array(nV * 3), elev = new Float32Array(nV), col = new Float32Array(nV * 3);
  for (let k = 0; k <= K + 1; k++) {
    // 外側にもう 1 周、60 km まで同じ高さのすそを足す（霧の中に消えるように）
    const r = k <= K ? radius(k) : rings.r1 * 2;
    for (let a = 0; a < A; a++) {
      const t = (a / A) * Math.PI * 2;
      const x = r * Math.cos(t), z = r * Math.sin(t);
      const kk = Math.min(k, K);
      let e: number, y: number;
      if (abs) {
        e = abs[kk * A + a];
        y = e - offset;
      } else {
        const rr = Math.min(r, rings.r1);
        const hills = 28 * fbm(x / 1100, z / 1100, seed) + 12;
        const far = smooth(1800, 9000, rr) * mtn * (820 * ridged(x / 6500, z / 6500, seed + 3) + 260 * ridged(x / 2300, z / 2300, seed + 9));
        y = hills * smooth(150, 900, rr) + far;
        e = y + 200;
      }
      if (k > K) y -= 150;
      // コースの地形の縁へなめらかにつなぐ（中は手前の地形に隠れる）
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1), d = Math.hypot(dx, dz);
      const hEdge = c.heightAt(Math.max(x0, Math.min(x1, x)), Math.max(z0, Math.min(z1, z)));
      if (d === 0) y = hEdge - 3;
      else y = hEdge + (y - hEdge) * smooth(0, 700, d);
      // 海の底は水面の下へ
      if (isSea(e) && d > 60) y = Math.min(y, seaY - 4);
      const i = k * A + a;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      elev[i] = e;
    }
  }
  // 色：傾き、標高、雑音で、草地、畑、森、岩、雪、浜、街
  const cl = new THREE.Color(), tmp = new THREE.Color();
  const city = style.city;
  for (let k = 0; k <= K + 1; k++) {
    for (let a = 0; a < A; a++) {
      const i = k * A + a;
      const kp = Math.min(K + 1, k + 1), km = Math.max(0, k - 1);
      const ip = kp * A + a, im = km * A + a;
      const ja = k * A + ((a + 1) % A), jb = k * A + ((a + A - 1) % A);
      const x = pos[i * 3], z = pos[i * 3 + 2];
      const r = Math.hypot(x, z) || 1;
      const dr = Math.max(1, Math.hypot(pos[ip * 3] - pos[im * 3], pos[ip * 3 + 2] - pos[im * 3 + 2]));
      const da = Math.max(1, (2 * Math.PI * r * 2) / A);
      const slope = Math.max(Math.abs(pos[ip * 3 + 1] - pos[im * 3 + 1]) / dr, Math.abs(pos[ja * 3 + 1] - pos[jb * 3 + 1]) / da);
      const e = elev[i];
      natureColor(cl, x, z, slope, e, data ? e - seaLevel : 100, pal, seed);
      if (!isSea(e)) cityMix(cl, x, z, slope, style);
      col[i * 3] = cl.r; col[i * 3 + 1] = cl.g; col[i * 3 + 2] = cl.b;
    }
  }
  const idx: number[] = [];
  for (let k = 0; k <= K; k++) {
    for (let a = 0; a < A; a++) {
      const a2 = (a + 1) % A;
      const p = k * A + a, q = k * A + a2, s = (k + 1) * A + a, u = (k + 1) * A + a2;
      // 上から見て表になる向き
      idx.push(p, q, s, q, u, s);
    }
  }
  const g = track(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const land = new THREE.Mesh(g, track(new THREE.MeshLambertMaterial({ vertexColors: true })));
  land.frustumCulled = false;
  group.add(land);

  // 海
  let sea = 0;
  for (let i = 0; i < nV; i++) if (isSea(elev[i])) sea++;
  if (data && sea > 0) {
    const w = new THREE.Mesh(track(new THREE.CircleGeometry(rings.r1 * 2, 96)), track(new THREE.MeshStandardMaterial({ color: waterColor, roughness: 0.3, metalness: 0.05 })));
    w.rotation.x = -Math.PI / 2;
    w.position.y = seaY;
    w.frustumCulled = false;
    group.add(w);
  }

  // 走れる範囲の水面は手前の層に置く（遠景の層の水は、手前の地形の外だけに見える）
  if (data && isFinite(c.seaY)) {
    const w = new THREE.Mesh(track(new THREE.PlaneGeometry(x1 - x0, z1 - z0)), track(new THREE.MeshStandardMaterial({ color: waterColor, roughness: 0.3, metalness: 0.05 })));
    w.rotation.x = -Math.PI / 2;
    w.position.set((x0 + x1) / 2, c.seaY, (z0 + z1) / 2);
    w.userData.near = true;
    group.add(w);
  }

  // 市街地：箱の建物を並べる。コースの範囲の外は遠景の層、範囲の中（道から離れた斜面）は手前の層
  if (city) {
    let rs = seed * 977 + 13;
    const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    const far: [number, number, number][] = [], near: [number, number, number][] = [];
    for (let k = 0; k < K; k++) {
      const r = radius(k);
      if (r > city.radius) break;
      for (let a = 0; a < A; a++) {
        const i = k * A + a, x = pos[i * 3], z = pos[i * 3 + 2];
        const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
        if (Math.hypot(dx, dz) < 60 || isSea(elev[i] - 0.5)) continue;
        if (rnd() > 0.55 * (1 - smooth(city.radius * 0.5, city.radius, r))) continue;
        far.push([x + (rnd() - 0.5) * 30, pos[i * 3 + 1], z + (rnd() - 0.5) * 30]);
      }
    }
    // 範囲の中：道から 22 m 以上離れた所に、ずらした格子で置く
    const cellSize = 50, hashKey = (ix: number, iz: number) => ix * 73856093 ^ iz * 19349663;
    const cells = new Map<number, [number, number][]>();
    for (const q of c.path) {
      const key = hashKey(Math.floor(q.x / cellSize), Math.floor(q.z / cellSize));
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push([q.x, q.z]);
    }
    const roadDist = (x: number, z: number) => {
      let best = Infinity;
      const ix = Math.floor(x / cellSize), iz = Math.floor(z / cellSize);
      for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (const [px, pz] of cells.get(hashKey(ix + u, iz + v)) ?? []) best = Math.min(best, (px - x) ** 2 + (pz - z) ** 2);
      return Math.sqrt(best);
    };
    const clear = c.width / 2 + 22;
    for (let gx = x0; gx < x1; gx += 34) {
      for (let gz = z0; gz < z1; gz += 34) {
        const x = gx + rnd() * 20, z = gz + rnd() * 20;
        const r = Math.hypot(x, z);
        if (r > city.radius || rnd() > 0.6 * (1 - smooth(city.radius * 0.5, city.radius, r))) continue;
        if (roadDist(x, z) < clear + 12) continue;
        const y = c.heightAt(x, z);
        if (y < c.seaY + 1) continue;
        near.push([x, y, z]);
      }
    }
    const facade = style.facades ?? [0xd8d2c6, 0xbfc3c8, 0x9aa3ad, 0xcfc0a8, 0xe6e2da, 0x8a949e, 0xb6aa96];
    const glassy = !!style.facades && style.facades.some((f) => (f & 0xff) > ((f >> 16) & 0xff));
    const mat = track(cityMaterial(glassy));
    const box = track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const place = (spots: [number, number, number][], isNear: boolean, maxFoot: number) => {
      if (spots.length === 0) return;
      const m = new THREE.InstancedMesh(box, mat, spots.length);
      spots.forEach(([x, y, z], i) => {
        const r = Math.hypot(x, z);
        const close = 1 - smooth(0, city.radius, r);
        const h = city.height[0] + (city.height[1] - city.height[0]) * rnd() ** 2 * (0.4 + 0.6 * close);
        q.setFromAxisAngle(Y, rnd() * Math.PI);
        sv.set(14 + rnd() * (maxFoot - 14), h, 14 + rnd() * (maxFoot - 14));
        // 斜面では谷側が浮かないよう深く埋める
        pv.set(x, y - (isNear ? 6 : 2), z);
        m.setMatrixAt(i, m4.compose(pv, q, sv));
        m.setColorAt(i, tmp.setHex(facade[Math.floor(rnd() * facade.length)]));
      });
      m.frustumCulled = false;
      m.receiveShadow = isNear;
      m.castShadow = isNear;
      m.userData.near = isNear;
      group.add(m);
    };
    place(far, false, 44);
    place(near, true, 30);
  }

  group.traverse((o) => o.layers.set(o.userData.near ? 0 : SCENERY_LAYER));
  return { group, dispose: () => { for (const d of disposables) d.dispose(); } };
}
