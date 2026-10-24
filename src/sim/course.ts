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
}

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
  cones: [number, number, number][];
  tireStacks: { x: number; y: number; z: number; count: number }[];
  grid: { x: number; y: number; z: number; yaw: number }[];
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

/** [割合, 値] の並びを周回として cos でつなぐ */
function cyclicKeys(keys: [number, number][], f: number) {
  const m = keys.length;
  for (let j = 0; j < m; j++) {
    const a = keys[j], b = keys[(j + 1) % m];
    const af = a[0], bf = j + 1 < m ? b[0] : b[0] + 1;
    const ff = f < keys[0][0] ? f + 1 : f;
    if (ff >= af && ff < bf) {
      const c = (1 - Math.cos((Math.PI * (ff - af)) / (bf - af))) / 2;
      return a[1] + (b[1] - a[1]) * c;
    }
  }
  return keys[0][1];
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
  const path: PathSample[] = pts.map((p, i) => ({ s: i * ds, x: p.x, y: 0, z: p.z, tx: 0, tz: 0, lx: 0, lz: 0, k: 0, surface: t.surface }));
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
    x0 = Math.min(...path.map((p) => p.x)) - 150; x1 = Math.max(...path.map((p) => p.x)) + 150;
    z0 = Math.min(...path.map((p) => p.z)) - 150; z1 = Math.max(...path.map((p) => p.z)) + 150;
  } else {
    const h = (def.size ?? 400) / 2;
    x0 = -h; z0 = -h; x1 = h; z1 = h;
  }
  const cell = def.cell;
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  x1 = x0 + nx * cell; z1 = z0 + nz * cell;

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
    const hl = hills(def, x, z);
    if (!index) return hl;
    const q = index.nearest(x, z);
    if (!q) return hl;
    const ry = roadY(q.i, q.u);
    const e = width / 2;
    if (q.d < e + 1.5) return ry - 0.35;
    if (q.d < e + SHOULDER) return ry - 0.35 + (0.23 * (q.d - e - 1.5)) / (SHOULDER - 1.5);
    return ry - 0.12 + (hl - (ry - 0.12)) * smooth((q.d - e - SHOULDER) / BLEND);
  };

  // 地形
  const vertices = new Float32Array((nx + 1) * (nz + 1) * 3);
  const colors = new Float32Array((nx + 1) * (nz + 1) * 3);
  const shade = rng(7);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, k = (j * (nx + 1) + i) * 3;
    vertices[k] = x; vertices[k + 1] = terrainHeight(x, z); vertices[k + 2] = z;
    const c = SURFACES[surfaceAt(x, z)].color;
    const v = 0.92 + shade() * 0.12;
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
      rv.set([p.x + p.lx * e, p.y, p.z + p.lz * e, p.x - p.lx * e, p.y, p.z - p.lz * e], i * 6);
      uv.set([0, p.s / 8, 1, p.s / 8], i * 4);
      const o = e + SHOULDER;
      sv.set([p.x + p.lx * o, p.y - 0.12, p.z + p.lz * o, p.x + p.lx * e, p.y, p.z + p.lz * e,
        p.x - p.lx * e, p.y, p.z - p.lz * e, p.x - p.lx * o, p.y - 0.12, p.z - p.lz * o], i * 12);
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
      if (q && q.d <= width / 2) return roadY(q.i, q.u);
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
    walls.push({ cx: w.x, cy: y + 0.5, cz: w.z, half: [0.25, 0.7, w.length / 2], yaw: w.yaw });
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
          if (b.kind === 'wall') walls.push({ cx: x, cy: y + 0.45, cz: z, half: [0.25, 0.75, step / 2 + 0.05], yaw: yawFromDir(p.tx, p.tz) });
          else tireStacks.push({ x, y, z, count: 2 });
        }
      }
    }
    for (const [f, off] of t.cones ?? []) {
      const p = at(f);
      const x = p.x + p.lx * off, z = p.z + p.lz * off;
      cones.push([x, p.y, z]);
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
      grid.push({ x: p.x + p.lx * off, y: p.y, z: p.z + p.lz * off, yaw: yawFromDir(p.tx, p.tz) });
    }
  } else {
    const st = def.start ?? { x: 0, z: 0, yaw: 0 };
    grid.push({ x: st.x, y: heightAt(st.x, st.z), z: st.z, yaw: st.yaw });
  }

  return {
    def, bounds: { x0, z0, x1, z1 },
    terrain: { nx, nz, cell, vertices, colors, parts: terrainParts },
    road, shoulder, path, length, width, ramps, rocks, walls, cones, tireStacks, grid, heightAt,
  };
}

/** 物理の世界に地面、固定物、小物を置く */
export function populate(pw: PhysicsWorld, c: CourseData) {
  for (const part of c.terrain.parts) pw.addStaticMesh(c.terrain.vertices, part.indices, SURFACES[part.surface]);
  if (c.road) {
    for (const part of c.road.parts) pw.addStaticMesh(c.road.vertices, part.indices, SURFACES[part.surface]);
  }
  if (c.shoulder) pw.addStaticMesh(c.shoulder.vertices, c.shoulder.indices, SURFACES[c.shoulder.surface]);
  for (const r of c.ramps) pw.addStaticConvex(r, SURFACES.concrete);
  for (const r of c.rocks) pw.addStaticConvex(r, SURFACES.rock);
  for (const w of c.walls) pw.addStaticBox([w.cx, w.cy, w.cz], w.half, w.yaw);
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
