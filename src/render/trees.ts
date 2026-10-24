// 木の形。どれも頂点の色で陰影（下と内側は暗く、上と外側は明るく）を付け、テクスチャは使わない。
// 種類ごとに形の違う 3 本を作り、インスタンスで向き、大きさ、色味をずらして並べる。
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type TreeKind = 'conifer' | 'broadleaf' | 'umbrella' | 'palm' | 'cypress';

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const _c = new THREE.Color();
/** 葉の塊の細かさ（遠くに置く木は 0 で面を減らす） */
let blobDetail = 1;

/** 頂点ごとに色を決める */
function colorize(g: THREE.BufferGeometry, f: (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color) => void) {
  // 添字のある形は、なめらかな法線を作ってから頂点を分ける
  g.computeVertexNormals();
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    f(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), _c);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function trunk(h: number, r0: number, r1: number, color: number, lean = 0, segs = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 3).translate(0, h / 2, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + lean * (p.getY(i) / h) ** 2);
  const base = new THREE.Color(color);
  return colorize(g, (_x, y, _z, nx, _ny, nz, out) => out.copy(base).multiplyScalar(0.7 + 0.3 * Math.max(0, nx * 0.6 + nz * 0.4) + 0.1 * (y / h)));
}

/** 葉の塊：でこぼこにした多面体。下と内側を暗く */
function blob(r: number, cx: number, cy: number, cz: number, sy: number, rnd: () => number, dark: THREE.Color, light: THREE.Color, crown: THREE.Vector3, crownH: [number, number]) {
  const ico = new THREE.IcosahedronGeometry(r, blobDetail);
  ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  const p = g.getAttribute('position');
  const ph = rnd() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.2 * Math.sin(x * 3.1 / r + ph) * Math.cos(z * 2.7 / r - ph) + 0.12 * Math.sin(y * 4.3 / r + ph * 2);
    p.setXYZ(i, cx + x * k, cy + y * k * sy, cz + z * k);
  }
  return colorize(g, (x, y, z, nx, ny, nz, out) => {
    const t = Math.max(0, Math.min(1, (y - crownH[0]) / (crownH[1] - crownH[0])));
    const ox = x - crown.x, oy = y - crown.y, oz = z - crown.z, ol = Math.hypot(ox, oy, oz) || 1;
    const outward = Math.max(0, (nx * ox + ny * oy + nz * oz) / ol);
    out.copy(dark).lerp(light, t * 0.75 + 0.25 * Math.max(0, ny)).multiplyScalar(0.6 + 0.4 * outward);
  });
}

function conifer(seed: number) {
  const rnd = rng(seed);
  const H = 13 + rnd() * 4;
  const parts = [trunk(H * 0.4, 0.34, 0.16, 0x4b3a2b)];
  const dark = new THREE.Color(0x223f25), light = new THREE.Color(0x5a8748);
  const tiers = 6 + Math.floor(rnd() * 2);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const h = H * (0.27 - 0.1 * t), r = H * 0.25 * (1 - t * 0.85) + 0.25;
    const y0 = H * (0.16 + 0.72 * t);
    const g = new THREE.ConeGeometry(r, h, 9, 1).rotateY(rnd() * Math.PI);
    const p = g.getAttribute('position');
    for (let j = 0; j < p.count; j++) {
      if (p.getY(j) < -h / 2 + 1e-3 && Math.hypot(p.getX(j), p.getZ(j)) > 1e-3) {
        // 同じ角度の頂点は同じだけ動かす（継ぎ目が割れないように）
        const ang = Math.atan2(p.getZ(j), p.getX(j));
        const k = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(ang * 5 + seed + i * 1.7));
        const droop = (0.5 + 0.5 * Math.sin(ang * 3 + seed * 0.7 + i)) * h * 0.18;
        p.setXYZ(j, p.getX(j) * k, p.getY(j) - droop, p.getZ(j) * k);
      }
    }
    g.translate(0, y0 + h / 2, 0);
    parts.push(colorize(g, (x, y, z, _nx, ny, _nz, out) => {
      const edge = Math.min(1, Math.hypot(x, z) / r);
      out.copy(dark).lerp(light, 0.25 + 0.45 * t + 0.3 * (1 - edge) * Math.max(0, ny)).multiplyScalar(0.75 + 0.25 * ((y - y0) / h));
    }));
  }
  return mergeGeometries(parts)!;
}

function broadleaf(seed: number) {
  const rnd = rng(seed);
  const H = 10 + rnd() * 4;
  const lean = (rnd() - 0.5) * 0.8;
  const parts = [trunk(H * 0.55, 0.36, 0.2, 0x5a4634, lean)];
  // 枝
  for (let b = 0; b < 3; b++) {
    const a = rnd() * Math.PI * 2, len = H * 0.22;
    const g = new THREE.CylinderGeometry(0.06, 0.12, len, 5).translate(0, len / 2, 0).rotateZ(0.7).rotateY(a).translate(lean * 0.3, H * 0.4, 0);
    parts.push(colorize(g, (_x, _y, _z, _a, _b, _d, out) => out.setHex(0x4e3c2d)));
  }
  const dark = new THREE.Color(0x2c4a24), light = new THREE.Color(0x7aa152);
  const cy = H * 0.66, R = H * 0.3;
  const crown = new THREE.Vector3(lean * 0.8, cy, 0);
  const n = 5 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(), d = i === 0 ? 0 : R * (0.45 + 0.25 * rnd());
    const rb = i === 0 ? R * 0.85 : R * (0.5 + 0.2 * rnd());
    parts.push(blob(rb, crown.x + Math.cos(a) * d, cy + (rnd() - 0.4) * R * 0.55, Math.sin(a) * d, 0.85, rnd, dark, light, crown, [cy - R, cy + R]));
  }
  return mergeGeometries(parts)!;
}

/** 笠松：高い幹の上に平たく広い葉（地中海とイタリアの公園） */
function umbrella(seed: number) {
  const rnd = rng(seed);
  const H = 12 + rnd() * 4;
  const lean = (rnd() - 0.5) * 1.6;
  const parts = [trunk(H * 0.8, 0.34, 0.2, 0x6a4e38, lean)];
  const dark = new THREE.Color(0x243d22), light = new THREE.Color(0x587d3e);
  const cy = H * 0.86, R = H * 0.36;
  const crown = new THREE.Vector3(lean, cy, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd(), d = i === 0 ? 0 : R * (0.5 + 0.2 * rnd());
    parts.push(blob(i === 0 ? R * 0.7 : R * 0.5, lean + Math.cos(a) * d, cy + (rnd() - 0.5) * 0.6, Math.sin(a) * d, 0.42, rnd, dark, light, crown, [cy - R * 0.3, cy + R * 0.3]));
  }
  return mergeGeometries(parts)!;
}

/** 糸杉：細長い炎の形（縦に伸ばした葉の塊を重ねる） */
function cypress(seed: number) {
  const rnd = rng(seed);
  const H = 11 + rnd() * 5, R = 1.2 + rnd() * 0.4;
  const dark = new THREE.Color(0x203c24), light = new THREE.Color(0x527c44);
  const crown = new THREE.Vector3(0, H * 0.5, 0);
  const parts = [trunk(H * 0.2, 0.2, 0.15, 0x4b3a2b)];
  parts.push(blob(R, 0, H * 0.45, 0, 2.6, rnd, dark, light, crown, [H * 0.1, H]));
  parts.push(blob(R * 0.75, (rnd() - 0.5) * 0.3, H * 0.72, (rnd() - 0.5) * 0.3, 2.4, rnd, dark, light, crown, [H * 0.1, H]));
  return mergeGeometries(parts)!;
}

/** ヤシ：曲がった幹と、垂れた葉（葉は両面を描く） */
function palm(seed: number) {
  const rnd = rng(seed);
  const H = 9 + rnd() * 4, bend = 0.8 + rnd() * 1.2;
  const parts = [trunk(H, 0.36, 0.24, 0x8a7458, bend, 7)];
  const top = new THREE.Vector3(bend, H, 0);
  const leafDark = new THREE.Color(0x3b6a2c), leafLight = new THREE.Color(0x86ad4a);
  const fronds = 11;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rnd() * 0.3, L = 3.6 + rnd() * 1.2, rise = 0.6 + rnd() * 0.5;
    const seg = 5, pos: number[] = [];
    const pt = (s: number, side: number) => {
      const t = s / seg;
      const w = 0.85 * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.7 * (1 - 0.25 * t);
      const along = t * L, drop = rise * t * 2 - 2.2 * t * t * (L / 4);
      const px = Math.cos(a) * along - Math.sin(a) * w * side, pz = Math.sin(a) * along + Math.cos(a) * w * side;
      return [top.x + px, top.y + drop + Math.abs(side) * w * 0.15, top.z + pz];
    };
    for (let s = 0; s < seg; s++) {
      const c0 = pt(s, 0), c1 = pt(s + 1, 0), l0 = pt(s, -1), l1 = pt(s + 1, -1), r0 = pt(s, 1), r1 = pt(s + 1, 1);
      pos.push(...c0, ...l0, ...c1, ...l0, ...l1, ...c1, ...c0, ...c1, ...r0, ...r0, ...c1, ...r1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    parts.push(colorize(g, (x, _y, z, _a, _b, _d, out) => out.copy(leafDark).lerp(leafLight, Math.min(1, Math.hypot(x - top.x, z - top.z) / L))));
  }
  return mergeGeometries(parts)!;
}

const MAKERS: Record<TreeKind, (seed: number) => THREE.BufferGeometry> = { conifer, broadleaf, umbrella, palm, cypress };

/** 種類ごとに形の違う 3 本。far は遠くに置く木（葉の塊の面を減らす） */
export function treeVariants(kind: TreeKind, far = false): THREE.BufferGeometry[] {
  blobDetail = far ? 0 : 1;
  return [11, 23, 37].map((s) => {
    const g = MAKERS[kind](s);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    return g;
  });
}

/** 両面を描く必要がある種類（ヤシの葉） */
export const DOUBLE_SIDED: Record<TreeKind, boolean> = { conifer: false, broadleaf: false, umbrella: false, palm: true, cypress: false };
