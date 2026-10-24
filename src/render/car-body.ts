// 車体の形。諸元の寸法から、横から見た形、上から見た形、断面を決め、長さ方向につないだ一枚の面にする。
// 車体座標は重心が原点、右 +x、上 +y、後ろ +z。
import * as THREE from 'three';
import type { CarGeometry, CarParams } from '../sim/params';

export type BodyStyle = CarParams['body']['style'];

interface StyleDef {
  /** 鼻先の高さ（最低地上高から窓の下端までの割合） */
  nose: number;
  /** 前の窓の寝かせ方（窓の高さに対する前後の長さ） */
  windshield: number;
  /** 後ろの窓の寝かせ方 */
  rear: number;
  /** 尾の高さ（窓の下端に対する割合） */
  tail: number;
  /** 羽根 */
  wing: boolean;
  /** 上から見た鼻先の絞り */
  pinch: number;
}

const STYLES: Record<BodyStyle, StyleDef> = {
  kei: { nose: 0.78, windshield: 0.9, rear: 0.15, tail: 0.98, wing: false, pinch: 0.1 },
  hatch: { nose: 0.66, windshield: 1.25, rear: 0.45, tail: 0.96, wing: false, pinch: 0.16 },
  sedan: { nose: 0.62, windshield: 1.3, rear: 0.95, tail: 0.97, wing: true, pinch: 0.16 },
  coupe: { nose: 0.55, windshield: 1.35, rear: 1.4, tail: 0.95, wing: false, pinch: 0.2 },
  suv: { nose: 0.8, windshield: 1.05, rear: 0.25, tail: 0.98, wing: false, pinch: 0.1 },
  super: { nose: 0.42, windshield: 1.6, rear: 2.0, tail: 0.92, wing: true, pinch: 0.26 },
};

export function bodyStyleOf(p: CarParams): BodyStyle {
  return STYLES[p.body.style] ? p.body.style : 'hatch';
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 横から見た形と上から見た形 */
export class BodyProfile {
  readonly st: StyleDef;
  readonly zf: number;
  readonly zr: number;
  readonly y0: number;
  readonly belt: number;
  readonly roof: number;
  readonly W: number;
  readonly wsEnd: number;
  readonly rwStart: number;

  constructor(readonly p: CarParams, readonly g: CarGeometry) {
    this.st = STYLES[bodyStyleOf(p)];
    this.zf = g.bodyFrontZ;
    this.zr = g.bodyRearZ;
    this.y0 = g.bodyBottomY;
    this.belt = g.beltY;
    this.roof = g.bodyTopY;
    this.W = p.body.width;
    const h = this.roof - this.belt;
    const cab = g.cabinRearZ - g.cabinFrontZ;
    // 屋根が必ず残るよう、前の窓は窓まわりの長さの 36%、後ろの窓は 40% まで
    this.wsEnd = g.cabinFrontZ + Math.min(cab * 0.36, h * this.st.windshield);
    this.rwStart = g.cabinRearZ - Math.min(cab * 0.4, h * this.st.rear);
  }

  /** 上から見た半幅 */
  halfWidth(z: number) {
    const u = (z - this.zf) / (this.zr - this.zf);
    const nose = 1 - smooth(0, 0.16, u);
    const tail = smooth(0.88, 1, u);
    return (this.W / 2) * (1 - this.st.pinch * nose * nose - 0.12 * tail * tail);
  }

  /** 車体の下端（車輪の上は切り欠く） */
  bottom(z: number) {
    const g = this.g, p = this.p;
    let y = this.y0;
    const u = (z - this.zf) / (this.zr - this.zf);
    y += 0.06 * (1 - smooth(0, 0.08, u)) + 0.08 * smooth(0.9, 1, u);
    for (const [az, r] of [[g.frontAxleZ, p.front.tireRadius], [g.rearAxleZ, p.rear.tireRadius]] as const) {
      const ra = r + 0.05, dz = z - az;
      if (Math.abs(dz) < ra) {
        const yArch = g.groundY + r + Math.sqrt(ra * ra - dz * dz);
        y = Math.max(y, Math.min(yArch, this.belt - 0.06));
      }
    }
    return y;
  }

  /** 車体の下半分の上面（ボンネット、トランク） */
  top(z: number) {
    const g = this.g;
    const yNose = this.y0 + (this.belt - this.y0) * this.st.nose;
    if (z < g.cabinFrontZ) {
      const t = (z - this.zf) / (g.cabinFrontZ - this.zf);
      return yNose + (this.belt - yNose) * Math.pow(Math.sin((Math.min(1, t * 1.15) * Math.PI) / 2), 0.7);
    }
    if (z > g.cabinRearZ) {
      const t = (z - g.cabinRearZ) / Math.max(0.05, this.zr - g.cabinRearZ);
      const yTail = this.belt * 1 + (this.y0 - this.belt) * (1 - this.st.tail) * 3;
      return this.belt + (yTail - this.belt) * Math.pow(t, 2.2);
    }
    return this.belt;
  }

  /** 窓まわりの断面の点（j = 0 右下 … K/2 屋根 … K 左下） */
  cabinPoint(z: number, j: number, K = 18): [number, number] {
    const yr = Math.max(this.belt + 0.01, this.roofAt(z));
    const w = this.halfWidth(z) * 0.93;
    const a = (Math.PI * j) / K, c = Math.cos(a), s = Math.sin(a);
    const x = w * (0.82 + 0.18 * (1 - s)) * Math.sign(c) * Math.pow(Math.abs(c), 0.35);
    return [x, this.belt - 0.005 + (yr - this.belt) * Math.pow(s, 0.3)];
  }

  /** 窓まわりの高さ（前の窓、屋根、後ろの窓） */
  roofAt(z: number) {
    const g = this.g;
    if (z <= g.cabinFrontZ || z >= g.cabinRearZ) return this.belt;
    if (z < this.wsEnd) {
      const t = (z - g.cabinFrontZ) / (this.wsEnd - g.cabinFrontZ);
      return this.belt + (this.roof - this.belt) * Math.sin((t * Math.PI) / 2);
    }
    if (z > this.rwStart) {
      const t = (z - this.rwStart) / (g.cabinRearZ - this.rwStart);
      return this.roof - (this.roof - this.belt) * (1 - Math.cos((t * Math.PI) / 2));
    }
    // 屋根は中ほどが少し高い
    const t = (z - this.wsEnd) / Math.max(0.05, this.rwStart - this.wsEnd);
    return this.roof - 0.015 * Math.pow(2 * t - 1, 2);
  }
}

function sampleZ(a: number, b: number, n: number) {
  // 両端を細かく
  return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * (0.5 - 0.5 * Math.cos((Math.PI * i) / n)));
}

/** 角の丸い箱の断面（中心 x=0、下 yb、上 yt、半幅 w、上の絞り taper）。下中央から反時計回り（右から見て） */
function section(w: number, yb: number, yt: number, taper: number, m: number): [number, number][] {
  const pts: [number, number][] = [];
  const yc = (yb + yt) / 2, hh = (yt - yb) / 2, n = 4.5;
  for (let j = 0; j < m; j++) {
    const th = -Math.PI / 2 + (2 * Math.PI * j) / m;
    const c = Math.cos(th), s = Math.sin(th);
    let x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (y > yc) x *= 1 - taper * ((y - yc) / hh);
    pts.push([x, y]);
  }
  return pts;
}

export interface BodyMeshes {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  /** ガラスのうち車体色で塗る部分（屋根、柱） */
  pillars: THREE.BufferGeometry;
  profile: BodyProfile;
}

export function buildBody(p: CarParams, g: CarGeometry): BodyMeshes {
  const pr = new BodyProfile(p, g);
  const M = 28;
  // ---- 下半分
  const zs = sampleZ(pr.zf, pr.zr, 56);
  const pos: number[] = [];
  for (const z of zs) {
    const w = pr.halfWidth(z), yb = pr.bottom(z), yt = pr.top(z);
    for (const [x, y] of section(w, yb, yt, 0.07, M)) pos.push(x, y, z);
  }
  const idx: number[] = [];
  for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
    idx.push(a, b, c, b, d, c);
  }
  // 前と後ろのふた
  const cap = (i: number, flip: boolean) => {
    const z = zs[i];
    let cx = 0, cy = 0;
    for (let j = 0; j < M; j++) { cx += pos[(i * M + j) * 3]; cy += pos[(i * M + j) * 3 + 1]; }
    const ci = pos.length / 3;
    pos.push(cx / M, cy / M, z + (flip ? 0.01 : -0.01));
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M);
      if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  };
  cap(0, false);
  cap(zs.length - 1, true);
  const paint = new THREE.BufferGeometry();
  paint.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  paint.setIndex(idx);
  paint.computeVertexNormals();

  // ---- 窓まわり：ガラスと、車体色の屋根と柱
  const cz = sampleZ(g.cabinFrontZ, g.cabinRearZ, 40);
  const K = 18;
  const gpos: number[] = [];
  for (const z of cz) {
    // 下端（窓の下端）から屋根まで。右の下端 → 屋根 → 左の下端
    for (let j = 0; j <= K; j++) {
      const [x, y] = pr.cabinPoint(z, j, K);
      gpos.push(x, y, z);
    }
  }
  const R = K + 1;
  const glassIdx: number[] = [], pillarIdx: number[] = [];
  const bpillar = g.cabinFrontZ + (g.cabinRearZ - g.cabinFrontZ) * 0.5;
  for (let i = 0; i < cz.length - 1; i++) {
    const zm = (cz[i] + cz[i + 1]) / 2;
    const onRoof = zm > pr.wsEnd && zm < pr.rwStart;
    const nearWs = zm < pr.wsEnd + 0.04;
    const nearRw = zm > pr.rwStart - 0.04;
    for (let j = 0; j < K; j++) {
      const a = i * R + j, b = i * R + j + 1, c = (i + 1) * R + j, d = (i + 1) * R + j + 1;
      const top = j >= 3 && j < K - 3;
      const corner = j === 2 || j === K - 3;
      const side = j < 2 || j >= K - 2;
      let body = false;
      if (onRoof && top) body = true; // 屋根
      if ((nearWs || nearRw) && corner) body = true; // A、C ピラー
      if (side && Math.abs(zm - bpillar) < 0.05 && pr.st.rear > 0.2) body = true; // B ピラー
      if (side && zm > pr.rwStart && pr.st.rear < 0.6) body = true; // 後ろが切り立った車の C ピラー
      // 外向きの面
      (body ? pillarIdx : glassIdx).push(a, b, c, b, d, c);
    }
  }
  const mk = (ix: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    geo.setIndex(ix);
    geo.computeVertexNormals();
    return geo;
  };
  return { paint, glass: mk(glassIdx), pillars: mk(pillarIdx), profile: pr };
}
