// 森と並木。木を散らさず、森は密な塊にする。
// - 森の範囲は植生の森の濃さ（forestAmount）をテーマのしきい値で切って決める
// - 遠くからは樹冠の面（でこぼこの緑の塊）に見せ、道から見える帯と森の縁には 1 本ずつの木を密に並べる
// - 畑の多いテーマは、畑の境に並木の列を置く
// - 道から遠い木は葉の面を減らした形にする
import * as THREE from 'three';
import type { CourseData } from '../sim/course';
import { quality } from './quality';
import { forestAmount, paletteOf } from './scenery';
import type { CourseTheme } from './themes';
import type { TreeKind } from './trees';
import { DOUBLE_SIDED, treeVariants } from './trees';

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function hash01(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function vnoise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const h = (a: number, b: number) => hash01(a * 157 + b * 311);
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}

/** 道からの距離（経路の点を升目に入れて引く） */
export function roadDistance(c: CourseData) {
  const cell = 40, grid = new Map<number, number[]>();
  const key = (ix: number, iz: number) => ix * 73856093 ^ iz * 19349663;
  c.path.forEach((p, i) => {
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  });
  return (x: number, z: number) => {
    if (c.path.length === 0) return 1e9;
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    let best = Infinity;
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (const i of grid.get(key(ix + u, iz + v)) ?? []) {
      const p = c.path[i];
      best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
    }
    return isFinite(best) ? Math.sqrt(best) : 1e9;
  };
}

/** 簡単な形の木の層（前のカメラだけが写す） */
export const FAR_TREE_LAYER = 2;

export interface ForestMesh { group: THREE.Group; update(cx: number, cz: number): void; dispose(): void }

/** blocked(x, z) が true の所（建物の中、作ったコースの砂地など）には木も樹冠も置かない */
export function buildForest(c: CourseData, theme: CourseTheme, blocked: (x: number, z: number) => boolean): ForestMesh {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const { x0, z0, x1, z1 } = c.bounds;
  const dist = roadDistance(c);
  const half = c.width / 2;
  const { threshold: T, canopy: H, hedgerows } = theme.forest;
  const slopeAt = (x: number, z: number) => Math.hypot(c.heightAt(x + 6, z) - c.heightAt(x - 6, z), c.heightAt(x, z + 6) - c.heightAt(x, z - 6)) / 12;
  // 森の濃さ（0〜1）。道の近く、水、ふさがれた所は 0
  const mask = (x: number, z: number) => {
    const d = dist(x, z);
    if (d < half + 14) return 0;
    if (c.heightAt(x, z) < c.seaY + 1) return 0;
    if (blocked(x, z)) return 0;
    const f = forestAmount(x, z, slopeAt(x, z), 1);
    return smooth(T, T + 0.12, f) * smooth(half + 14, half + 30, d);
  };
  // 並木：畑の境に見立てた雑音の等高線（軽い判定から先に）
  const hedge = (x: number, z: number, d: number) => hedgerows > 0 && Math.abs(vnoise(x / 260, z / 260)) < 0.035 * hedgerows && d > half + 16 && !blocked(x, z) && c.heightAt(x, z) > c.seaY + 1;

  // ---------------------------------------------------------------- 樹冠の面
  const pal = paletteOf(theme);
  const dark = new THREE.Color(pal.forest).multiplyScalar(0.7), light = new THREE.Color(pal.forest).lerp(new THREE.Color(pal.meadow), 0.35).multiplyScalar(1.1);
  const tint = new THREE.Color(theme.treeTint);
  dark.multiply(tint); light.multiply(tint);
  const cs = quality.level === 'low' ? 18 : 13;
  const nx = Math.ceil((x1 - x0) / cs), nz = Math.ceil((z1 - z0) / cs);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const m = new Float32Array((nx + 1) * (nz + 1));
  const cl = new THREE.Color();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * cs + (vnoise(i * 0.7, j * 0.7) * cs * 0.3), z = z0 + j * cs + (vnoise(j * 0.7 + 9, i * 0.7) * cs * 0.3);
    const k = j * (nx + 1) + i;
    const w = mask(x, z);
    m[k] = w;
    const lump = 0.75 + 0.35 * vnoise(x / 22, z / 22) + 0.15 * vnoise(x / 7, z / 7);
    const y = c.heightAt(x, z) + (w > 0.02 ? H * lump * (0.35 + 0.65 * w) : -2);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    cl.copy(dark).lerp(light, Math.max(0, Math.min(1, 0.45 + 0.45 * vnoise(x / 16 + 3, z / 16) + 0.25 * (lump - 0.75))));
    col[k * 3] = cl.r; col[k * 3 + 1] = cl.g; col[k * 3 + 2] = cl.b;
  }
  // 木の位置では、格子で求めた森の濃さを補間して使う
  const maskAt = (x: number, z: number) => {
    const fi = Math.max(0, Math.min(nx - 1e-3, (x - x0) / cs)), fj = Math.max(0, Math.min(nz - 1e-3, (z - z0) / cs));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * (nx + 1) + i;
    return (m[k] * (1 - u) + m[k + 1] * u) * (1 - v) + (m[k + nx + 1] * (1 - u) + m[k + nx + 2] * u) * v;
  };
  const idx: number[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, d = cc + 1;
    if (m[a] + m[b] + m[cc] + m[d] < 0.3) continue;
    idx.push(a, cc, b, b, cc, d);
  }
  if (idx.length > 0) {
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const canopy = new THREE.Mesh(g, track(new THREE.MeshLambertMaterial({ vertexColors: true })));
    canopy.receiveShadow = true;
    group.add(canopy);
  }

  // ---------------------------------------------------------------- 1 本ずつの木
  // 植える場所は先に全部決めておき、描くのは車の近くだけにする（近くは細かい形、少し先は簡単な形）。
  // 車が 15 m 動くたびに描く木を入れ替える。遠くの森は樹冠の面が受け持つ
  const cap = quality.level === 'low' ? 2500 : quality.level === 'medium' ? 6000 : 10000;
  const spots: { x: number; y: number; z: number; d: number }[] = [];
  const band = 70;
  for (let gx = x0; gx < x1; gx += 6.5) for (let gz = z0; gz < z1; gz += 6.5) {
    const x = gx + (hash01(gx * 3.1 + gz) - 0.5) * 4.5, z = gz + (hash01(gz * 2.7 - gx) - 0.5) * 4.5;
    const d = dist(x, z);
    if (d < half + 14 || d > half + 260) continue;
    const w = maskAt(x, z);
    const inBand = d < half + band && w > 0.3;
    const edge = w > 0.12 && w < 0.7 && hash01(x * 0.37 + z * 0.91) < 0.55;
    const row = !inBand && !edge && hedge(x, z, d);
    if (inBand || edge || row) spots.push({ x, y: c.heightAt(x, z) - 0.2, z, d });
  }
  spots.sort((a, b) => a.d - b.d);
  const use = spots.slice(0, cap);
  const kinds = (Object.entries(theme.trees) as [TreeKind, number][]).filter(([, w]) => w > 0);
  const total = kinds.reduce((sum, [, w]) => sum + w, 0);
  // 種類と形ごとの組。木ごとの姿勢と色は先に計算しておく
  interface Set { ids: number[]; near: THREE.InstancedMesh; far: THREE.InstancedMesh }
  const sets: Set[] = [];
  const mats = new Float32Array(use.length * 16), cols = new Float32Array(use.length * 3);
  if (total > 0 && use.length > 0) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), tc = new THREE.Color();
    const groups = new Map<string, number[]>();
    use.forEach((sp, i) => {
      let u = hash01(i * 7 + 3 + sp.x) * total, kind = kinds[0][0];
      for (const [k, w] of kinds) { if (u < w) { kind = k; break; } u -= w; }
      const key = `${kind}:${Math.floor(hash01(i * 5.3) * 3)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
      const k = 0.85 + 0.4 * hash01(i * 17 + 1);
      q.setFromAxisAngle(Y, hash01(i * 13) * Math.PI * 2);
      sc.set(k, k * (0.9 + 0.25 * hash01(i * 19)), k);
      ps.set(sp.x, sp.y, sp.z);
      m4.compose(ps, q, sc).toArray(mats, i * 16);
      tc.copy(tint).multiplyScalar(0.86 + 0.28 * hash01(i * 23)).toArray(cols, i * 3);
    });
    for (const [kind] of kinds) {
      const mat = track(new THREE.MeshLambertMaterial({ vertexColors: true, side: DOUBLE_SIDED[kind] ? THREE.DoubleSide : THREE.FrontSide }));
      const nearGeo = treeVariants(kind, false), farGeo = treeVariants(kind, true);
      for (let v = 0; v < 3; v++) {
        const ids = groups.get(`${kind}:${v}`) ?? [];
        if (ids.length === 0) { nearGeo[v].dispose(); farGeo[v].dispose(); continue; }
        const near = new THREE.InstancedMesh(track(nearGeo[v]), mat, ids.length);
        const far = new THREE.InstancedMesh(track(farGeo[v]), mat, ids.length);
        for (const im of [near, far]) {
          im.count = 0;
          im.frustumCulled = false;
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.setColorAt(0, new THREE.Color(1, 1, 1));
          im.receiveShadow = true;
          group.add(im);
        }
        near.castShadow = quality.level === 'high';
        // 簡単な形の木はバックミラーに写さない（層 2 は前のカメラだけが写す）
        far.layers.set(FAR_TREE_LAYER);
        sets.push({ ids, near, far });
      }
    }
  }
  const NEAR = 120, FAR = 350;
  let lastX = Infinity, lastZ = Infinity;
  const update = (cx: number, cz: number) => {
    if ((cx - lastX) ** 2 + (cz - lastZ) ** 2 < 15 * 15) return;
    lastX = cx; lastZ = cz;
    for (const st of sets) {
      let n = 0, f = 0;
      const nm = st.near.instanceMatrix.array as Float32Array, fm = st.far.instanceMatrix.array as Float32Array;
      const nc = st.near.instanceColor!.array as Float32Array, fc = st.far.instanceColor!.array as Float32Array;
      for (const i of st.ids) {
        const sp = use[i];
        const d2 = (sp.x - cx) ** 2 + (sp.z - cz) ** 2;
        if (d2 < NEAR * NEAR) {
          nm.set(mats.subarray(i * 16, i * 16 + 16), n * 16); nc.set(cols.subarray(i * 3, i * 3 + 3), n * 3); n++;
        } else if (d2 < FAR * FAR) {
          fm.set(mats.subarray(i * 16, i * 16 + 16), f * 16); fc.set(cols.subarray(i * 3, i * 3 + 3), f * 3); f++;
        }
      }
      st.near.count = n; st.far.count = f;
      st.near.instanceMatrix.needsUpdate = true; st.far.instanceMatrix.needsUpdate = true;
      st.near.instanceColor!.needsUpdate = true; st.far.instanceColor!.needsUpdate = true;
    }
  };
  return { group, update, dispose: () => { for (const d of disposables) d.dispose(); } };
}
