// コース。定義（中心線、標高、ジャンプ、路面、置く物）から、地形、路面、衝突形状、走行経路を作る。
// 描画と物理の両方がここで作った配列を使う。
import { CatmullRomCurve3, Vector3 } from 'three';
import type { SurfaceId } from './surfaces';
import { SURFACES } from './surfaces';
import type { PhysicsWorld } from './world';

export interface TrackDef {
  /** 平面の制御点 [x, z]。この順に回る閉じた周回 */
  points: [number, number][];
  width: number;
  surface: SurfaceId;
  shoulder: SurfaceId;
  /** 路面の区間（周回に対する割合 0〜1） */
  sections?: { from: number; to: number; surface: SurfaceId }[];
  /** 地形の起伏に足す標高 [割合, m] */
  elevation?: [number, number][];
  /** ジャンプ台：at の位置が頂点。up m かけて height m 上がり、down m かけて下りる */
  jumps?: { at: number; up: number; height: number; down: number }[];
  /** 壁とタイヤバリア。outside はカーブの外側 */
  barriers?: { from: number; to: number; side: 'left' | 'right' | 'outside' | 'both'; kind: 'wall' | 'tires' }[];
  /** 路上のコーン [割合, 中心からの横位置 m（左が正）] */
  cones?: [number, number][];
  /** オーバルのバンク角 [度]（曲がりと直線） */
  banking?: { turns: number; straights: number };
  /** 制御点ごとの橋の印（1 が橋） */
  bridges?: number[];
  /** 壁と景色を自動で置く（実在のコース） */
  auto?: 'circuit' | 'street' | 'oval';
}

export type CourseCategory = 'original' | 'international' | 'technical' | 'street' | 'oval';

export interface CourseDef {
  id: string;
  name: string;
  description: string;
  ground: SurfaceId;
  cell: number;
  /** 地形の範囲（track が無いときに使う。中心が原点の正方形） */
  size?: number;
  hills?: { amp: number; wave: number };
  track?: TrackDef;
  patches?: { x: number; z: number; w: number; d: number; surface: SurfaceId }[];
  ramps?: { x: number; z: number; yaw: number; length: number; width: number; height: number }[];
  rockFields?: { x: number; z: number; radius: number; count: number; size: number; seed: number }[];
  cones?: [number, number][];
  tireStacks?: { x: number; z: number; count: number }[];
  walls?: { x: number; z: number; yaw: number; length: number }[];
  start?: { x: number; z: number; yaw: number };
  laps: number;
  category?: CourseCategory;
  country?: string;
  /** 公式の 1 周の長さ [m] */
  lengthOfficial?: number;
  /** 地形の起伏をコースの標高からなめらかに作る（実在のコース） */
  terrainFromTrack?: boolean;
  /** データの出どころ（画面に出す） */
  credit?: string;
  /** 英語の名前（実在のコース） */
  nameEn?: string;
  /** 高低差 [m]（実在のコース） */
  rise?: number;
}

export interface PathSample {
  s: number;
  x: number;
  y: number;
  z: number;
  /** 進む向き（水平） */
  tx: number;
  tz: number;
  /** 左向き（水平） */
  lx: number;
  lz: number;
  /** 曲率 [1/m]（左に曲がるとき正） */
  k: number;
  /** バンク角 [rad]（正なら右の端が高い） */
  bank: number;
  /** 橋の上 */
  bridge: boolean;
  surface: SurfaceId;
}

export interface MeshPart {
  surface: SurfaceId;
  indices: Uint32Array;
}

export interface CourseData {
  def: CourseDef;
  bounds: { x0: number; z0: number; x1: number; z1: number };
  terrain: { nx: number; nz: number; cell: number; vertices: Float32Array; colors: Float32Array; parts: MeshPart[] };
  road: { vertices: Float32Array; uvs: Float32Array; parts: MeshPart[] } | null;
  shoulder: { vertices: Float32Array; indices: Uint32Array; surface: SurfaceId } | null;
  path: PathSample[];
  length: number;
  width: number;
  ramps: Float32Array[];
  rocks: Float32Array[];
  walls: { cx: number; cy: number; cz: number; half: [number, number, number]; yaw: number }[];
  /** 縁石（路面の端に沿う帯）。色を塗り分けるため頂点ごとに赤か白か */
  kerbs: { vertices: Float32Array; indices: Uint32Array; colors: Float32Array } | null;
  /** 木 [x, y, z, 大きさ] */
  trees: [number, number, number, number][];
  /** 観客席とピットの建物、街の建物 */
  buildings: { kind: 'stand' | 'pit' | 'block'; x: number; y: number; z: number; yaw: number; length: number; depth?: number; height?: number; color?: number }[];
  /** 橋の柱 [x, 上の高さ, z, 下の高さ] */
  pillars: [number, number, number, number][];
  cones: [number, number, number][];
  tireStacks: { x: number; y: number; z: number; count: number }[];
  grid: { x: number; y: number; z: number; yaw: number; up?: [number, number, number] }[];
  heightAt: (x: number, z: number) => number;
}

// ---------------------------------------------------------------- 乱数と雑音
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash(ix: number, iz: number) {
  let h = (ix * 73856093) ^ (iz * 19349663);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 65536) / 65536;
}

function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}

function hills(def: CourseDef, x: number, z: number) {
  if (!def.hills) return 0;
  const { amp, wave } = def.hills;
  return amp * (0.65 * noise(x / wave, z / wave) + 0.25 * noise(x / (wave * 0.45) + 31, z / (wave * 0.45) - 7) + 0.1 * noise(x / (wave * 0.2) - 3, z / (wave * 0.2) + 11));
}

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/**
 * [割合, 値] の並びを周回としてなめらかにつなぐ（区分 3 次の単調補間）。
 * 山と谷の点では傾きを 0 にし（手で置いた頂上は平らなまま）、上りや下りが続く点では傾きを前後から取る。
 * どの点でも傾きを 0 にするつなぎ方（cos）だと、細かく点を置いた実在のコースで坂が階段のようになり、車が跳ねる
 */
function cyclicKeys(keys: [number, number][], f: number) {
  const m = keys.length;
  if (m === 1) return keys[0][1];
  // j 番目の点（周回を越えた番号は 1 周ぶんずらす）
  const fx = (j: number) => keys[((j % m) + m) % m][0] + Math.floor(j / m);
  const vy = (j: number) => keys[((j % m) + m) % m][1];
  const slope = (j: number) => {
    const h0 = fx(j) - fx(j - 1), h1 = fx(j + 1) - fx(j);
    const s0 = (vy(j) - vy(j - 1)) / Math.max(1e-9, h0), s1 = (vy(j + 1) - vy(j)) / Math.max(1e-9, h1);
    if (s0 * s1 <= 0) return 0;
    const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / s0 + w1 / s1);
  };
  let j = m - 1;
  for (let k = 0; k < m; k++) if (keys[k][0] <= f) j = k;
  const ff = f < keys[0][0] ? f + 1 : f;
  const a = j === m - 1 && f < keys[0][0] ? fx(-1) + 1 : fx(j);
  const h = fx(j + 1) - fx(j);
  const t = Math.max(0, Math.min(1, (ff - a) / Math.max(1e-9, h)));
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * vy(j) + (t3 - 2 * t2 + t) * h * slope(j) + (-2 * t3 + 3 * t2) * vy(j + 1) + (t3 - t2) * h * slope(j + 1);
}

/** 経路の点 i での路面の上向き（坂とバンクに沿う） */
export function pathUp(path: PathSample[], i: number): [number, number, number] {
  const n = path.length;
  const a = path[(i - 2 + n) % n], b = path[(i + 2) % n], p = path[i];
  const ds = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const f = [p.tx, (b.y - a.y) / ds, p.tz];
  const l = [p.lx, -Math.tan(p.bank), p.lz];
  // 上 = 前 × 左
  const u = [f[1] * l[2] - f[2] * l[1], f[2] * l[0] - f[0] * l[2], f[0] * l[1] - f[1] * l[0]];
  const m = Math.hypot(u[0], u[1], u[2]) || 1;
  return [u[0] / m, u[1] / m, u[2] / m];
}

export const yawFromDir = (tx: number, tz: number) => Math.atan2(-tx, -tz);

// ---------------------------------------------------------------- 走行経路
const SHOULDER = 2;
const BLEND = 18;

function buildPath(def: CourseDef, t: TrackDef): { path: PathSample[]; length: number } {
  const curve = new CatmullRomCurve3(t.points.map(([x, z]) => new Vector3(x, 0, z)), true, 'centripetal');
  const length = curve.getLength();
  const n = Math.max(64, Math.round(length));
  const pts = curve.getSpacedPoints(n).slice(0, n);
  const ds = length / n;
  const path: PathSample[] = pts.map((p, i) => ({ s: i * ds, x: p.x, y: 0, z: p.z, tx: 0, tz: 0, lx: 0, lz: 0, k: 0, bank: 0, bridge: false, surface: t.surface }));
  for (let i = 0; i < n; i++) {
    const a = path[(i - 1 + n) % n], b = path[(i + 1) % n];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const p = path[i];
    p.tx = tx; p.tz = tz; p.lx = tz; p.lz = -tx;
  }
  for (let i = 0; i < n; i++) {
    const a = path[(i - 1 + n) % n], b = path[(i + 1) % n];
    const ha = Math.atan2(a.tx, a.tz), hb = Math.atan2(b.tx, b.tz);
    let dh = hb - ha;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    // atan2(tx, tz) は左に曲がると増える
    path[i].k = dh / (2 * ds);
  }
  // 曲率は前後 5 m でならす（地図の点のがたつきを AI の速さに持ち込まない）
  {
    const raw = path.map((p) => p.k), w = Math.max(1, Math.round(5 / ds));
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -w; j <= w; j++) sum += raw[(i + j + n) % n];
      path[i].k = sum / (2 * w + 1);
    }
  }
  // バンク：曲がりのきつさに合わせて傾け、前後 30 m でならす。外側（主に曲がる向きの反対）が高い
  if (t.banking) {
    const meanK = path.reduce((a, p) => a + p.k, 0) / n;
    const sign = meanK >= 0 ? 1 : -1;
    const raw = path.map((p) => {
      const tt = smooth((Math.abs(p.k) - 1 / 2000) / (1 / 350 - 1 / 2000));
      return sign * ((t.banking!.straights + (t.banking!.turns - t.banking!.straights) * tt) * Math.PI) / 180;
    });
    const w = Math.max(1, Math.round(30 / ds));
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -w; j <= w; j++) sum += raw[(i + j + n) % n];
      path[i].bank = sum / (2 * w + 1);
    }
  }
  if (t.bridges) {
    const m = t.bridges.length;
    for (let i = 0; i < n; i++) path[i].bridge = t.bridges[Math.floor((i / n) * m) % m] === 1;
  }
  // 標高：地形の起伏を経路に沿って均し、指定の標高とジャンプを足す
  const base = path.map((p) => hills(def, p.x, p.z));
  const win = Math.round(40 / ds);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -win; j <= win; j++) sum += base[(i + j + n) % n];
    path[i].y = sum / (2 * win + 1);
  }
  const keys = [...(t.elevation ?? [])].sort((a, b) => a[0] - b[0]);
  if (keys.length > 0) for (let i = 0; i < n; i++) path[i].y += cyclicKeys(keys, i / n);
  for (const j of t.jumps ?? []) {
    const s0 = j.at * length;
    // 踏み切りの手前 e m はなめらかに上げ、頂点は角のまま（ここで飛ぶ）。下りは着地しやすい cos の形
    const e = Math.min(4, j.up / 2);
    const m = j.height / (j.up - e / 2);
    for (let i = 0; i < n; i++) {
      let d = path[i].s - s0;
      if (d > length / 2) d -= length;
      if (d < -length / 2) d += length;
      let h = 0;
      if (d >= -j.up && d <= 0) {
        const x = d + j.up;
        h = x < e ? (m * x * x) / (2 * e) : m * (x - e / 2);
      } else if (d > 0 && d <= j.down) {
        h = (j.height * (1 + Math.cos((Math.PI * d) / j.down))) / 2;
      }
      path[i].y += h;
    }
  }
  for (const sec of t.sections ?? []) {
    for (const p of path) {
      const f = p.s / length;
      if (f >= sec.from && f < sec.to) p.surface = sec.surface;
    }
  }
  return { path, length };
}

/** 経路への最寄り点を引くための格子 */
class PathIndex {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly path: PathSample[], private readonly size: number, reach: number) {
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const a = path[i], b = path[(i + 1) % n];
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / size), x1 = Math.floor((Math.max(a.x, b.x) + reach) / size);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach) / size), z1 = Math.floor((Math.max(a.z, b.z) + reach) / size);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const key = cx * 100003 + cz;
        let list = this.cells.get(key);
        if (!list) { list = []; this.cells.set(key, list); }
        list.push(i);
      }
    }
  }

  /** 最寄りの線分 i、その中の位置 u、距離 d、左右（左が正）の位置 */
  nearest(x: number, z: number): { i: number; u: number; d: number; side: number } | null {
    const list = this.cells.get(Math.floor(x / this.size) * 100003 + Math.floor(z / this.size));
    if (!list) return null;
    const n = this.path.length;
    let best = Infinity, bi = 0, bu = 0, bside = 0;
    for (const i of list) {
      const a = this.path[i], b = this.path[(i + 1) % n];
      const ex = b.x - a.x, ez = b.z - a.z;
      const l2 = ex * ex + ez * ez || 1;
      const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
      const px = a.x + ex * u, pz = a.z + ez * u;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; bi = i; bu = u; bside = (x - px) * a.lx + (z - pz) * a.lz; }
    }
    return { i: bi, u: bu, d: best, side: bside };
  }

  /** 経路の別の部分（60 m 以上離れた区間）ごとの最寄り。立体交差で両方の道を見る */
  branches(x: number, z: number, reach: number): { i: number; u: number; d: number; side: number }[] {
    const list = this.cells.get(Math.floor(x / this.size) * 100003 + Math.floor(z / this.size));
    if (!list) return [];
    const n = this.path.length;
    const cand: { i: number; u: number; d: number; side: number }[] = [];
    for (const i of list) {
      const a = this.path[i], b = this.path[(i + 1) % n];
      const ex = b.x - a.x, ez = b.z - a.z;
      const l2 = ex * ex + ez * ez || 1;
      const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
      const px = a.x + ex * u, pz = a.z + ez * u;
      const d = Math.hypot(x - px, z - pz);
      if (d <= reach) cand.push({ i, u, d, side: (x - px) * a.lx + (z - pz) * a.lz });
    }
    cand.sort((p, q) => p.d - q.d);
    const out: typeof cand = [];
    for (const c of cand) {
      if (out.every((o) => { const di = Math.abs(o.i - c.i); return Math.min(di, n - di) > 60; })) out.push(c);
    }
    return out;
  }
}

// ---------------------------------------------------------------- 組み立て
export function buildCourse(def: CourseDef): CourseData {
  const t = def.track;
  let path: PathSample[] = [], length = 0;
  if (t) ({ path, length } = buildPath(def, t));
  const width = t?.width ?? 0;
  const reach = width / 2 + SHOULDER + BLEND;
  const index = t ? new PathIndex(path, 16, reach) : null;
  const n = path.length;
  const roadY = (i: number, u: number) => path[i].y + (path[(i + 1) % n].y - path[i].y) * u;

  // 範囲
  let x0: number, z0: number, x1: number, z1: number;
  if (t) {
    const m = def.terrainFromTrack ? 120 : 150;
    x0 = Math.min(...path.map((p) => p.x)) - m; x1 = Math.max(...path.map((p) => p.x)) + m;
    z0 = Math.min(...path.map((p) => p.z)) - m; z1 = Math.max(...path.map((p) => p.z)) + m;
  } else {
    const h = (def.size ?? 400) / 2;
    x0 = -h; z0 = -h; x1 = h; z1 = h;
  }
  // 大きなコースでも頂点が 18 万を超えないように
  const cell = Math.max(def.cell, Math.min(6, Math.sqrt(((x1 - x0) * (z1 - z0)) / 180000)));
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  x1 = x0 + nx * cell; z1 = z0 + nz * cell;

  // 実在のコース：周りの地形を、コースの標高から距離の重みでなめらかに作る（40 m の格子）
  let field: ((x: number, z: number) => number) | null = null;
  if (t && def.terrainFromTrack) {
    const fc = 40, fx = Math.ceil((x1 - x0) / fc) + 1, fz = Math.ceil((z1 - z0) / fc) + 1;
    const grid = new Float32Array(fx * fz);
    const samples = path.filter((_, i) => i % 8 === 0);
    for (let j = 0; j < fz; j++) for (let i = 0; i < fx; i++) {
      const x = x0 + i * fc, z = z0 + j * fc;
      let sw = 0, sh = 0;
      for (const p of samples) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
        const w = 1 / (d2 + 900);
        sw += w; sh += w * p.y;
      }
      grid[j * fx + i] = sh / sw;
    }
    field = (x: number, z: number) => {
      const gi = Math.max(0, Math.min(fx - 1.001, (x - x0) / fc)), gj = Math.max(0, Math.min(fz - 1.001, (z - z0) / fc));
      const i = Math.floor(gi), j = Math.floor(gj), u = gi - i, v = gj - j;
      const g = (a: number, b: number) => grid[b * fx + a];
      return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v - 0.3;
    };
  }
  const ground = (x: number, z: number) => (field ? field(x, z) : hills(def, x, z));
  // 路面の高さ（横の位置 side で。バンクがあれば傾く）
  const roadAt = (i: number, u: number, side: number) => {
    const e = width / 2;
    const b = path[i].bank + (path[(i + 1) % n].bank - path[i].bank) * u;
    return roadY(i, u) - Math.max(-e, Math.min(e, side)) * Math.tan(b);
  };
  const sink = def.terrainFromTrack ? 0.6 : 0.35;

  const rocksDefs = def.rockFields ?? [];
  const surfaceAt = (x: number, z: number): SurfaceId => {
    for (const r of rocksDefs) if (Math.hypot(x - r.x, z - r.z) < r.radius) return 'rock';
    for (const p of def.patches ?? []) if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return p.surface;
    if (t && index) {
      const q = index.nearest(x, z);
      if (q && q.d < width / 2 + SHOULDER) return t.shoulder;
    }
    return def.ground;
  };

  const terrainHeight = (x: number, z: number) => {
    const hl = ground(x, z);
    if (!index) return hl;
    const qs = index.branches(x, z, reach);
    if (qs.length === 0) return hl;
    const e = width / 2;
    // 立体交差では低い方の道に合わせる（上の道は橋になる）
    let h = Infinity;
    for (const q of qs) {
      const ry = roadAt(q.i, q.u, q.side);
      let v: number;
      if (q.d < e + 1.5) v = ry - sink;
      else if (q.d < e + SHOULDER) v = ry - sink + ((sink - 0.12) * (q.d - e - 1.5)) / (SHOULDER - 1.5);
      else v = ry - 0.12 + (hl - (ry - 0.12)) * smooth((q.d - e - SHOULDER) / BLEND);
      if (path[q.i].bridge && q.d < e + SHOULDER + 4) continue;
      h = Math.min(h, v);
    }
    return isFinite(h) ? h : hl;
  };

  // 地形
  const vertices = new Float32Array((nx + 1) * (nz + 1) * 3);
  const colors = new Float32Array((nx + 1) * (nz + 1) * 3);
  const shade = rng(7);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, k = (j * (nx + 1) + i) * 3;
    vertices[k] = x; vertices[k + 1] = terrainHeight(x, z); vertices[k + 2] = z;
    const c = SURFACES[surfaceAt(x, z)].color;
    const v = (0.92 + shade() * 0.1) * (0.88 + 0.24 * (noise(x / 45 + 3.1, z / 45 - 1.7) * 0.5 + 0.5));
    colors[k] = (((c >> 16) & 255) / 255) * v; colors[k + 1] = (((c >> 8) & 255) / 255) * v; colors[k + 2] = ((c & 255) / 255) * v;
  }
  const bySurface = new Map<SurfaceId, number[]>();
  const push = (s: SurfaceId, a: number, b: number, c: number) => {
    let l = bySurface.get(s);
    if (!l) { l = []; bySurface.set(s, l); }
    l.push(a, b, c);
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
    push(surfaceAt(cx - cell * 0.2, cz - cell * 0.2), a, c, b);
    push(surfaceAt(cx + cell * 0.2, cz + cell * 0.2), b, c, d);
  }
  const terrainParts: MeshPart[] = [...bySurface].map(([surface, l]) => ({ surface, indices: new Uint32Array(l) }));

  // 路面と路肩
  let road: CourseData['road'] = null;
  let shoulder: CourseData['shoulder'] = null;
  if (t) {
    const rv = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
    const sv = new Float32Array(n * 4 * 3);
    const e = width / 2;
    for (let i = 0; i < n; i++) {
      const p = path[i];
      const tb = Math.tan(p.bank);
      const yl = p.y - e * tb, yr = p.y + e * tb;
      rv.set([p.x + p.lx * e, yl, p.z + p.lz * e, p.x - p.lx * e, yr, p.z - p.lz * e], i * 6);
      uv.set([0, p.s / 8, 1, p.s / 8], i * 4);
      const o = e + SHOULDER;
      sv.set([p.x + p.lx * o, yl - SHOULDER * tb - 0.12, p.z + p.lz * o, p.x + p.lx * e, yl, p.z + p.lz * e,
        p.x - p.lx * e, yr, p.z - p.lz * e, p.x - p.lx * o, yr + SHOULDER * tb - 0.12, p.z - p.lz * o], i * 12);
    }
    const roadBy = new Map<SurfaceId, number[]>();
    const si: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
      let l = roadBy.get(path[i].surface);
      if (!l) { l = []; roadBy.set(path[i].surface, l); }
      // 上から見て反時計回り（上向きの面）
      l.push(a, b, c, b, d, c);
      const A = i * 4, C = j * 4;
      si.push(A, A + 1, C, A + 1, C + 1, C, A + 2, A + 3, C + 2, A + 3, C + 3, C + 2);
    }
    road = { vertices: rv, uvs: uv, parts: [...roadBy].map(([surface, l]) => ({ surface, indices: new Uint32Array(l) })) };
    shoulder = { vertices: sv, indices: new Uint32Array(si), surface: t.shoulder };
  }

  const heightAt = (x: number, z: number) => {
    if (index) {
      const q = index.nearest(x, z);
      if (q && q.d <= width / 2) return roadAt(q.i, q.u, q.side);
    }
    const fi = (x - x0) / cell, fj = (z - z0) / cell;
    const i = Math.max(0, Math.min(nx - 1, Math.floor(fi))), j = Math.max(0, Math.min(nz - 1, Math.floor(fj)));
    const u = Math.max(0, Math.min(1, fi - i)), v = Math.max(0, Math.min(1, fj - j));
    const h = (ii: number, jj: number) => vertices[(jj * (nx + 1) + ii) * 3 + 1];
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
  };

  // ジャンプ台（試験場）：三角柱
  const ramps = (def.ramps ?? []).map((r) => {
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    const base = heightAt(r.x, r.z) - 0.05;
    const loc = (lx: number, lz: number, y: number) => [r.x + lx * c + lz * s, base + y, r.z - lx * s + lz * c];
    const hw = r.width / 2, L = r.length;
    // 車は +z 側から -z 向きに上る（yaw = 0 のとき）
    return new Float32Array([
      ...loc(-hw, L / 2, 0), ...loc(hw, L / 2, 0), ...loc(-hw, -L / 2, 0), ...loc(hw, -L / 2, 0),
      ...loc(-hw, -L / 2, r.height + 0.05), ...loc(hw, -L / 2, r.height + 0.05),
    ]);
  });

  // 岩：つぶした球の凸包を半分埋める
  const rocks: Float32Array[] = [];
  for (const f of rocksDefs) {
    const rnd = rng(f.seed);
    for (let k = 0; k < f.count; k++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * f.radius;
      const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
      if (index) {
        const q = index.nearest(x, z);
        if (q && q.d < width / 2 + SHOULDER + 1) continue;
      }
      const size = f.size * (0.5 + rnd());
      const y = heightAt(x, z) - size * 0.35;
      const pts: number[] = [];
      for (let m = 0; m < 14; m++) {
        const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), rr = size * (0.7 + 0.3 * rnd());
        pts.push(x + rr * Math.sin(ph) * Math.cos(th), y + rr * 0.6 * Math.cos(ph), z + rr * Math.sin(ph) * Math.sin(th));
      }
      rocks.push(new Float32Array(pts));
    }
  }

  // 壁、タイヤバリア、コーン
  const walls: CourseData['walls'] = [];
  const tireStacks: CourseData['tireStacks'] = [];
  const cones: CourseData['cones'] = [];
  for (const w of def.walls ?? []) {
    const y = heightAt(w.x, w.z);
    walls.push({ cx: w.x, cy: y + 0.5, cz: w.z, half: [0.3, 0.5, w.length / 2], yaw: w.yaw });
  }
  for (const s of def.tireStacks ?? []) tireStacks.push({ x: s.x, y: heightAt(s.x, s.z), z: s.z, count: s.count });
  for (const [x, z] of def.cones ?? []) cones.push([x, heightAt(x, z), z]);
  if (t) {
    const at = (f: number) => path[Math.floor((((f % 1) + 1) % 1) * n) % n];
    for (const b of t.barriers ?? []) {
      const step = b.kind === 'wall' ? 4 : 0.8;
      const s0 = b.from * length, s1 = (b.to < b.from ? b.to + 1 : b.to) * length;
      for (let s = s0; s < s1; s += step) {
        const p = at(s / length);
        const sides = b.side === 'both' ? [1, -1] : b.side === 'left' ? [1] : b.side === 'right' ? [-1] : [p.k > 0 ? -1 : 1];
        for (const side of sides) {
          const off = (width / 2 + SHOULDER + 1.8) * side;
          const x = p.x + p.lx * off, z = p.z + p.lz * off;
          const y = heightAt(x, z);
          if (b.kind === 'wall') walls.push({ cx: x, cy: y + 0.45, cz: z, half: [0.3, 0.5, step / 2 + 0.05], yaw: yawFromDir(p.tx, p.tz) });
          else tireStacks.push({ x, y, z, count: 2 });
        }
      }
    }
    for (const [f, off] of t.cones ?? []) {
      const p = at(f);
      const x = p.x + p.lx * off, z = p.z + p.lz * off;
      cones.push([x, p.y, z]);
    }
    // 実在のコース：サーキットは退避帯の外、市街地は道路のすぐ脇、オーバルは外側に壁を並べる
    if (t.auto && index) {
      const e = width / 2, step = 6;
      const meanK = path.reduce((a, q) => a + q.k, 0) / n;
      const off = t.auto === 'street' ? e + 0.7 : t.auto === 'oval' ? e + 0.6 : e + SHOULDER + 7;
      const sides = t.auto === 'oval' ? [meanK >= 0 ? -1 : 1] : [1, -1];
      for (let s0 = 0; s0 < length;) {
        const i0 = Math.floor(s0 / (length / n)) % n;
        const p = path[i0];
        // 曲がりがきついところは壁を短く刻む（まっすぐな箱が内側で路面にはみ出さないように）
        const seg = Math.max(1.5, Math.min(step, 0.35 / Math.max(1e-6, Math.abs(p.k))));
        for (const side of sides) {
          const x = p.x + p.lx * off * side, z = p.z + p.lz * off * side;
          // 壁の中心と両端のどれかが、ほかの区間（立体交差、ヘアピンの反対側）の路面に近いところには置かない
          let ok = true;
          for (const a of [0, -0.5, 0.5]) {
            const near = index.nearest(x + p.tx * seg * a, z + p.tz * seg * a);
            if (near && near.d < off - 0.4) { ok = false; break; }
          }
          if (!ok) continue;
          const others = index.branches(x, z, e + 8).filter((q) => { const di = Math.abs(q.i - i0); return Math.min(di, n - di) > 60; });
          if (others.length > 0) continue;
          const tb = Math.tan(p.bank);
          const base = t.auto === 'circuit' ? heightAt(x, z) : side > 0 ? p.y - e * tb : p.y + e * tb;
          walls.push({ cx: x, cy: base + 0.45, cz: z, half: [0.3, 0.5, seg / 2 + 0.1], yaw: yawFromDir(p.tx, p.tz) });
        }
        s0 += seg;
      }
    }
  }

  // 縁石：曲がりのきつい区間の両端に、路面の端から外へ 1.1 m の帯を置く（内側が少し高い）
  let kerbs: CourseData['kerbs'] = null;
  if (t && t.surface === 'asphalt' && !t.banking) {
    const kv: number[] = [], kc: number[] = [], ki: number[] = [];
    const e = width / 2;
    const sharp = path.map((p) => Math.abs(p.k) > 1 / 140);
    // 前後 12 m に広げる
    const on = path.map((_, i) => { for (let j = -12; j <= 12; j++) if (sharp[(i + j + n) % n]) return true; return false; });
    for (const side of [1, -1]) {
      let run: number[] = [];
      const flush = () => {
        if (run.length < 2) { run = []; return; }
        const base = kv.length / 3;
        run.forEach((i, r) => {
          const p = path[i];
          const red = Math.floor(path[i].s / 1.5) % 2 === 0;
          const col = red ? [0.78, 0.12, 0.1] : [0.92, 0.92, 0.9];
          for (const [off, dy] of [[e - 0.05, 0.035], [e + 1.1, -0.04]] as const) {
            kv.push(p.x + p.lx * off * side, p.y + dy, p.z + p.lz * off * side);
            kc.push(...col);
          }
          if (r > 0) {
            const a = base + (r - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
            // 上向きの面（左側は内から外へが左向きなので、順を入れ替える）
            if (side > 0) ki.push(a, c, b, b, c, d); else ki.push(a, b, c, b, d, c);
          }
        });
        run = [];
      };
      for (let i = 0; i < n; i++) { if (on[i]) run.push(i); else flush(); }
      flush();
    }
    if (ki.length > 0) kerbs = { vertices: new Float32Array(kv), indices: new Uint32Array(ki), colors: new Float32Array(kc) };
  }

  // 木：コースから 18 m 以上離れた草地に、ばらつかせて置く
  const trees: CourseData['trees'] = [];
  {
    const rnd = rng(31);
    const area = (x1 - x0) * (z1 - z0);
    const want = Math.min(1600, Math.round(area / 900));
    for (let k = 0; k < want * 3 && trees.length < want; k++) {
      const x = x0 + 20 + rnd() * (x1 - x0 - 40), z = z0 + 20 + rnd() * (z1 - z0 - 40);
      if (surfaceAt(x, z) !== 'grass') continue;
      if (index) { const q = index.nearest(x, z); if (q && q.d < width / 2 + 18) continue; }
      if (!t && Math.abs(x) < 140 && Math.abs(z) < 140) continue;
      trees.push([x, heightAt(x, z), z, 0.7 + rnd() * 0.8]);
    }
  }

  // 観客席とピット：スタートラインの前後の直線の外
  const buildings: CourseData['buildings'] = [];
  if (t) {
    const p0 = path[0];
    const yaw = yawFromDir(p0.tx, p0.tz);
    const off = width / 2 + SHOULDER + 9;
    if (t.auto !== 'oval') {
      buildings.push({ kind: 'stand', x: p0.x + p0.lx * off, y: p0.y, z: p0.z + p0.lz * off, yaw, length: 80 });
      buildings.push({ kind: 'pit', x: p0.x - p0.lx * (off + 2), y: p0.y, z: p0.z - p0.lz * (off + 2), yaw, length: 90 });
    } else {
      // オーバル：外側に観客席を並べ、内側にピット
      const meanK = path.reduce((a, q) => a + q.k, 0) / n;
      const out = meanK >= 0 ? -1 : 1;
      for (const ds of [-140, 0, 140]) {
        const q = path[((Math.round(ds / (length / n)) % n) + n) % n];
        const o = (width / 2 + 14) * out;
        buildings.push({ kind: 'stand', x: q.x + q.lx * o, y: q.y, z: q.z + q.lz * o, yaw: yawFromDir(q.tx, q.tz) + (out > 0 ? 0 : Math.PI), length: 120 });
      }
      const o = (width / 2 + 25) * -out;
      buildings.push({ kind: 'pit', x: p0.x + p0.lx * o, y: p0.y, z: p0.z + p0.lz * o, yaw: yaw + (out > 0 ? Math.PI : 0), length: 110 });
    }
  }
  // 市街地：壁の外に街の建物
  if (t?.auto === 'street' && index) {
    const rnd = rng(77);
    const e = width / 2;
    const colors = [0xb8b0a4, 0xd2c8b8, 0x9aa3ad, 0xc9b79c, 0x8d8f94, 0xe0dcd2, 0xa48f7a];
    for (let s0 = 0; s0 < length; s0 += 24) {
      const p = path[Math.floor(s0 / (length / n)) % n];
      for (const side of [1, -1]) {
        if (rnd() < 0.25) continue;
        const gap = e + 5 + rnd() * 10, depth = 12 + rnd() * 18, len = 14 + rnd() * 12, h = 9 + rnd() * 38;
        const c = gap + depth / 2;
        const x = p.x + p.lx * c * side, z = p.z + p.lz * c * side;
        // 四隅と中心がどれもコースから離れていること
        let ok = true;
        for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const px = x + p.tx * (len / 2) * a + p.lx * (depth / 2) * b, pz = z + p.tz * (len / 2) * a + p.lz * (depth / 2) * b;
          const q = index.nearest(px, pz);
          if (q && q.d < e + 4) { ok = false; break; }
        }
        if (!ok) continue;
        buildings.push({ kind: 'block', x, y: heightAt(x, z) - 0.5, z, yaw: yawFromDir(p.tx, p.tz), length: len, depth, height: h, color: colors[Math.floor(rnd() * colors.length)] });
      }
    }
  }

  // 橋の柱：橋の区間に 8 m ごと。下を通る道の上には立てない
  const pillars: CourseData['pillars'] = [];
  if (t && index) {
    const e = width / 2;
    for (let i = 0; i < n; i += 8) {
      const p = path[i];
      if (!p.bridge) continue;
      const below = index.branches(p.x, p.z, e + 2).filter((q) => { const di = Math.abs(q.i - i); return Math.min(di, n - di) > 60; });
      if (below.length > 0) continue;
      const bottom = terrainHeight(p.x, p.z);
      if (p.y - bottom > 1.5) pillars.push([p.x, p.y - 0.4, p.z, bottom - 0.5]);
    }
  }

  // スタート位置
  const grid: CourseData['grid'] = [];
  if (t) {
    for (let k = 0; k < 8; k++) {
      const row = Math.floor(k / 2), side = k % 2 === 0 ? 1 : -1;
      const s = length - 12 - row * 10 - (side < 0 ? 4 : 0);
      const p = path[Math.floor(s) % n];
      const off = (width / 4) * side;
      grid.push({ x: p.x + p.lx * off, y: p.y - off * Math.tan(p.bank), z: p.z + p.lz * off, yaw: yawFromDir(p.tx, p.tz), up: pathUp(path, Math.floor(s) % n) });
    }
  } else {
    const st = def.start ?? { x: 0, z: 0, yaw: 0 };
    grid.push({ x: st.x, y: heightAt(st.x, st.z), z: st.z, yaw: st.yaw });
  }

  return {
    def, bounds: { x0, z0, x1, z1 },
    terrain: { nx, nz, cell, vertices, colors, parts: terrainParts },
    road, shoulder, path, length, width, ramps, rocks, walls, kerbs, trees, buildings, pillars, cones, tireStacks, grid, heightAt,
  };
}

/** 物理の世界に地面、固定物、小物を置く */
export function populate(pw: PhysicsWorld, c: CourseData) {
  for (const part of c.terrain.parts) pw.addStaticMesh(c.terrain.vertices, part.indices, SURFACES[part.surface]);
  if (c.road) {
    for (const part of c.road.parts) pw.addStaticMesh(c.road.vertices, part.indices, SURFACES[part.surface]);
  }
  if (c.shoulder) pw.addStaticMesh(c.shoulder.vertices, c.shoulder.indices, SURFACES[c.shoulder.surface]);
  if (c.kerbs) pw.addStaticMesh(c.kerbs.vertices, c.kerbs.indices, SURFACES.kerb);
  for (const r of c.ramps) pw.addStaticConvex(r, SURFACES.concrete);
  for (const r of c.rocks) pw.addStaticConvex(r, SURFACES.rock);
  for (const w of c.walls) pw.addStaticBox([w.cx, w.cy, w.cz], w.half, w.yaw);
  // 街の建物と橋の柱にもぶつかる
  for (const b of c.buildings) {
    if (b.kind !== 'block') continue;
    const h = b.height ?? 12;
    pw.addStaticBox([b.x, b.y + h / 2, b.z], [(b.depth ?? 14) / 2, h / 2, b.length / 2], b.yaw);
  }
  for (const [x, top, z, bottom] of c.pillars) pw.addStaticBox([x, (top + bottom) / 2, z], [0.7, Math.max(0.25, (top - bottom) / 2), 0.7], 0);
  for (const s of c.tireStacks) pw.addTireStack(s.x, s.y, s.z, s.count);
  for (const [x, y, z] of c.cones) pw.addCone(x, y, z);
  // 地形の外へ落ちないように縁を囲う
  const { x0, z0, x1, z1 } = c.bounds;
  const cy = c.heightAt((x0 + x1) / 2, (z0 + z1) / 2);
  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  pw.addStaticBox([mx, cy, z0], [hx, 60, 1], 0);
  pw.addStaticBox([mx, cy, z1], [hx, 60, 1], 0);
  pw.addStaticBox([x0, cy, mz], [1, 60, hz], 0);
  pw.addStaticBox([x1, cy, mz], [1, 60, hz], 0);
}
