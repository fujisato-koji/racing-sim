// 車体の形。諸元の寸法から、横から見た形、上から見た形、断面を決め、長さ方向につないだ一枚の面にする。
// 断面は、下の敷居、ドアの面、いちばん張り出した肩の線、ボンネットの縁を持つ形。
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
  /** 羽根（なし、小さな縁、大きな羽根） */
  wing: 'none' | 'lip' | 'wing';
  /** 上から見た鼻先の絞り */
  pinch: number;
  /** フェンダーの膨らみ（全幅に対する割合） */
  flare: number;
  /** 窓の下端の線を後ろへ向けて上げる量 [m] */
  wedge: number;
  /** 前のスプリッターと後ろのディフューザー */
  aero: boolean;
}

const STYLES: Record<BodyStyle, StyleDef> = {
  kei: { nose: 0.72, windshield: 0.9, rear: 0.15, tail: 0.98, wing: 'none', pinch: 0.08, flare: 0.015, wedge: 0, aero: false },
  hatch: { nose: 0.62, windshield: 1.25, rear: 0.45, tail: 0.96, wing: 'lip', pinch: 0.14, flare: 0.03, wedge: 0.02, aero: false },
  sedan: { nose: 0.58, windshield: 1.3, rear: 0.95, tail: 0.97, wing: 'wing', pinch: 0.14, flare: 0.05, wedge: 0.03, aero: true },
  coupe: { nose: 0.5, windshield: 1.35, rear: 1.4, tail: 0.95, wing: 'lip', pinch: 0.18, flare: 0.045, wedge: 0.04, aero: true },
  suv: { nose: 0.76, windshield: 1.05, rear: 0.25, tail: 0.98, wing: 'lip', pinch: 0.08, flare: 0.04, wedge: 0.01, aero: false },
  super: { nose: 0.36, windshield: 1.6, rear: 2.0, tail: 0.9, wing: 'wing', pinch: 0.24, flare: 0.07, wedge: 0.05, aero: true },
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
  readonly beltBase: number;
  readonly roof: number;
  readonly W: number;
  readonly wsEnd: number;
  readonly rwStart: number;

  constructor(readonly p: CarParams, readonly g: CarGeometry) {
    this.st = STYLES[bodyStyleOf(p)];
    this.zf = g.bodyFrontZ;
    this.zr = g.bodyRearZ;
    this.y0 = g.bodyBottomY;
    this.beltBase = g.beltY;
    this.roof = g.bodyTopY;
    this.W = p.body.width;
    const h = this.roof - this.beltBase;
    const cab = g.cabinRearZ - g.cabinFrontZ;
    // 屋根が必ず残るよう、前の窓は窓まわりの長さの 36%、後ろの窓は 40% まで
    this.wsEnd = g.cabinFrontZ + Math.min(cab * 0.36, h * this.st.windshield);
    this.rwStart = g.cabinRearZ - Math.min(cab * 0.4, h * this.st.rear);
  }

  get belt() { return this.beltBase; }

  /** 窓の下端の高さ（後ろへ向けて少し上がる） */
  beltAt(z: number) {
    const u = (z - this.zf) / (this.zr - this.zf);
    return this.beltBase + this.st.wedge * (u - 0.45);
  }

  /** 上から見た半幅（肩の線の幅）。フェンダーを膨らませ、その間を少しくびれさせる */
  halfWidth(z: number) {
    const g = this.g, p = this.p;
    const u = (z - this.zf) / (this.zr - this.zf);
    const nose = 1 - smooth(0, 0.14, u);
    const tail = smooth(0.9, 1, u);
    let w = (this.W / 2) * (1 - this.st.flare) * (1 - this.st.pinch * nose * nose - 0.1 * tail * tail);
    // 前と後ろの角を丸める（前の面が幅いっぱいの平らな板にならないように）
    w *= (0.72 + 0.28 * Math.sqrt(smooth(0, 0.045, u))) * (0.8 + 0.2 * Math.sqrt(smooth(0, 0.035, 1 - u)));
    for (const [az, r] of [[g.frontAxleZ, p.front.tireRadius], [g.rearAxleZ, p.rear.tireRadius]] as const) {
      const d = Math.abs(z - az), span = r + 0.34;
      if (d < span) w += (this.W / 2) * this.st.flare * Math.cos(((d / span) * Math.PI) / 2) ** 2;
    }
    // タイヤの上ではフェンダーをタイヤより 12 mm 以上広くする（トレッドやタイヤ幅を変えた車でもはみ出さないように）
    for (const [az, ax] of [[g.frontAxleZ, p.front], [g.rearAxleZ, p.rear]] as const) {
      const need = ax.track / 2 + ax.tireWidth / 2 + 0.012;
      const k = 1 - smooth(ax.tireRadius, ax.tireRadius + 0.3, Math.abs(z - az));
      if (need > w) w += (need - w) * k;
    }
    return w;
  }

  /** タイヤの上にどれだけかかっているか（1 はタイヤの真上、0 は離れている）。フェンダーの縁を外へ張り出すのに使う */
  archness(z: number) {
    const g = this.g, p = this.p;
    let a = 0;
    for (const [az, r] of [[g.frontAxleZ, p.front.tireRadius], [g.rearAxleZ, p.rear.tireRadius]] as const) {
      a = Math.max(a, 1 - smooth(r, r + 0.15, Math.abs(z - az)));
    }
    return a;
  }

  /** 車体の下端（車輪の上は切り欠く） */
  bottom(z: number) {
    const g = this.g, p = this.p;
    let y = this.y0;
    const u = (z - this.zf) / (this.zr - this.zf);
    y += 0.05 * (1 - smooth(0, 0.06, u)) + 0.07 * smooth(0.93, 1, u);
    for (const [az, r] of [[g.frontAxleZ, p.front.tireRadius], [g.rearAxleZ, p.rear.tireRadius]] as const) {
      const ra = r + 0.04, dz = z - az;
      if (Math.abs(dz) < ra) {
        const yArch = g.groundY + r + Math.sqrt(ra * ra - dz * dz);
        y = Math.max(y, Math.min(yArch, this.beltAt(z) - 0.08));
      }
    }
    return y;
  }

  /** 車体の下半分の上面（ボンネット、トランク）。端は丸めて前と後ろの面へつなぐ */
  top(z: number) {
    const g = this.g;
    const belt = this.beltAt(z);
    const yNose = this.y0 + (this.beltAt(this.zf) - this.y0) * this.st.nose;
    let y: number;
    if (z < g.cabinFrontZ) {
      const t = Math.min(1, (z - this.zf) / (g.cabinFrontZ - this.zf));
      // ボンネットは平らに近く、鼻先で丸く落とす
      y = yNose + (belt - 0.02 - yNose) * Math.pow(t, 0.45);
    } else if (z > g.cabinRearZ) {
      const t = (z - g.cabinRearZ) / Math.max(0.05, this.zr - g.cabinRearZ);
      const yTail = belt - (belt - this.y0) * (1 - this.st.tail) * 3;
      y = belt + (yTail - belt) * Math.pow(t, 2);
    } else {
      y = belt;
    }
    // 前後の端 4 cm を丸める
    const ef = smooth(0, 0.04, z - this.zf), er = smooth(0, 0.04, this.zr - z);
    const mid = (this.bottom(z) + y) / 2;
    return mid + (y - mid) * (0.55 + 0.45 * Math.min(ef, er));
  }

  /** 窓まわりの高さ（前の窓、屋根、後ろの窓） */
  roofAt(z: number) {
    const g = this.g;
    const belt = this.beltAt(z);
    if (z <= g.cabinFrontZ || z >= g.cabinRearZ) return belt;
    if (z < this.wsEnd) {
      const t = (z - g.cabinFrontZ) / (this.wsEnd - g.cabinFrontZ);
      return belt + (this.roof - belt) * Math.sin((t * Math.PI) / 2) ** 0.9;
    }
    if (z > this.rwStart) {
      const t = (z - this.rwStart) / (g.cabinRearZ - this.rwStart);
      return this.roof - (this.roof - belt) * (1 - Math.cos((t * Math.PI) / 2));
    }
    const t = (z - this.wsEnd) / Math.max(0.05, this.rwStart - this.wsEnd);
    return this.roof - 0.012 * Math.pow(2 * t - 1, 2);
  }

  /** 窓まわりの断面の点（j = 0 右下 … K/2 屋根の中央 … K 左下）。横窓は平ら、屋根の角は丸い */
  cabinPoint(z: number, j: number, K = 18): [number, number] {
    const belt = this.beltAt(z);
    const yr = Math.max(belt + 0.01, this.roofAt(z));
    const wb = this.halfWidth(z) * 0.86;
    const h = yr - belt;
    const wr = Math.max(0.1, wb - Math.min(0.2, h * 0.32));
    const side = j <= K / 2 ? 1 : -1;
    const jj = j <= K / 2 ? j : K - j;
    const half = K / 2;
    const rc = Math.min(0.06, h * 0.4);
    // 0..4 横窓（直線）、5..6 屋根の角、7..half 屋根
    let x: number, y: number;
    if (jj <= 4) {
      const t = jj / 4;
      x = wb + (wr - wb) * t; y = belt - 0.005 + (h - rc) * t;
    } else if (jj <= 6) {
      const a = ((jj - 4) / 2) * (Math.PI / 2);
      x = wr - rc + rc * Math.cos(a); y = belt - 0.005 + h - rc + rc * Math.sin(a);
    } else {
      const t = (jj - 6) / (half - 6);
      x = (wr - rc) * (1 - t); y = yr - 0.005 + 0.008 * t;
    }
    return [side * x, y];
  }
}

function sampleZ(a: number, b: number, n: number) {
  // 両端を細かく
  return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * (0.5 - 0.5 * Math.cos((Math.PI * i) / n)));
}

/** 断面（右半分）の制御点：下の中央 → 敷居 → ドアの面 → 肩の線 → ボンネットの縁 → 上の中央 */
/** a はタイヤの上にかかる度合い。タイヤの上では下の縁を外へ張り出し、上から見てタイヤが隠れるようにする */
function halfSection(w: number, yb: number, yt: number, a = 0): [number, number][] {
  const h = yt - yb;
  const mix = (lo: number, hi: number) => lo + (hi - lo) * a;
  return [
    [0, yb], [w * mix(0.84, 0.975), yb], [w * mix(0.92, 0.995), yb + Math.min(0.04, h * 0.12)], [w * mix(0.965, 1), yb + h * 0.38],
    [w, yb + h * 0.7], [w * 0.95, yt - h * 0.07], [w * 0.8, yt], [w * 0.4, yt + 0.012], [0, yt + 0.015],
  ];
}

/** 制御点を通るなめらかな線（Catmull-Rom）で m 点にする */
function smoothPolyline(ctrl: [number, number][], m: number): [number, number][] {
  const out: [number, number][] = [];
  const n = ctrl.length;
  for (let k = 0; k < m; k++) {
    const f = (k / (m - 1)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f)), t = f - i;
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(n - 1, i + 2)];
    const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t * t + (-a + 3 * b - 3 * cc + d) * t * t * t);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

export interface BodyMeshes {
  paint: THREE.BufferGeometry;
  /** 下回り、バンパーの下側（黒い樹脂） */
  trim: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  /** 窓まわりのうち車体色で塗る部分（屋根、A と C の柱） */
  pillars: THREE.BufferGeometry;
  /** 窓まわりのうち黒い部分（B の柱、窓の下の縁） */
  blackout: THREE.BufferGeometry;
  profile: BodyProfile;
}

export function buildBody(p: CarParams, g: CarGeometry): BodyMeshes {
  const pr = new BodyProfile(p, g);
  const H = 15; // 片側の点の数
  // ---- 下半分：断面の右半分を左右に写し、下の中央から反時計回り（右から見て）に並べる
  const zs = sampleZ(pr.zf, pr.zr, 64);
  const pos: number[] = [];
  let M = 0;
  const trimLine = pr.y0 + 0.1;
  for (const z of zs) {
    const w = pr.halfWidth(z), yb = pr.bottom(z), yt = pr.top(z);
    const right = smoothPolyline(halfSection(w, yb, yt, pr.archness(z)), H);
    const loop: [number, number][] = [...right, ...right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
    M = loop.length;
    for (const [x, y] of loop) pos.push(x, y, z);
  }
  const paintIdx: number[] = [], trimIdx: number[] = [];
  for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
    const ym = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    (ym < trimLine ? trimIdx : paintIdx).push(a, b, c, b, d, c);
  }
  // 前と後ろのふた
  const cap = (i: number, flip: boolean) => {
    const z = zs[i];
    let cx = 0, cy = 0;
    for (let j = 0; j < M; j++) { cx += pos[(i * M + j) * 3]; cy += pos[(i * M + j) * 3 + 1]; }
    const ci = pos.length / 3;
    pos.push(cx / M, cy / M, z + (flip ? 0.008 : -0.008));
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M);
      if (flip) paintIdx.push(ci, a, b); else paintIdx.push(ci, b, a);
    }
  };
  cap(0, false);
  cap(zs.length - 1, true);
  const mk = (verts: number[], ix: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(ix);
    geo.computeVertexNormals();
    return geo;
  };

  // ---- 窓まわり
  const cz = sampleZ(g.cabinFrontZ, g.cabinRearZ, 44);
  const K = 18;
  const gpos: number[] = [];
  for (const z of cz) for (let j = 0; j <= K; j++) { const [x, y] = pr.cabinPoint(z, j, K); gpos.push(x, y, z); }
  const R = K + 1;
  const glassIdx: number[] = [], pillarIdx: number[] = [], blackIdx: number[] = [];
  const bpillar = g.cabinFrontZ + (g.cabinRearZ - g.cabinFrontZ) * 0.5;
  for (let i = 0; i < cz.length - 1; i++) {
    const zm = (cz[i] + cz[i + 1]) / 2;
    const onRoof = zm > pr.wsEnd && zm < pr.rwStart;
    const nearWs = zm < pr.wsEnd + 0.05;
    const nearRw = zm > pr.rwStart - 0.05;
    for (let j = 0; j < K; j++) {
      const a = i * R + j, b = i * R + j + 1, c = (i + 1) * R + j, d = (i + 1) * R + j + 1;
      const jj = j < K / 2 ? j : K - 1 - j;
      const top = jj >= 5;
      const corner = jj === 4;
      const side = jj <= 3;
      let kind: 'glass' | 'paint' | 'black' = 'glass';
      if (onRoof && top) kind = 'paint'; // 屋根
      if ((nearWs || nearRw) && corner) kind = 'paint'; // A、C の柱
      if (side && jj === 0 && zm > pr.wsEnd && zm < pr.rwStart + 0.05) kind = 'black'; // 横窓の下の黒い縁
      if (side && Math.abs(zm - bpillar) < 0.045 && pr.st.rear > 0.2) kind = 'black'; // B の柱
      if (side && zm > pr.rwStart && pr.st.rear < 0.6) kind = 'paint'; // 後ろが切り立った車の C の柱
      (kind === 'glass' ? glassIdx : kind === 'paint' ? pillarIdx : blackIdx).push(a, b, c, b, d, c);
    }
  }
  return {
    paint: mk(pos, paintIdx), trim: mk(pos, trimIdx),
    glass: mk(gpos, glassIdx), pillars: mk(gpos, pillarIdx), blackout: mk(gpos, blackIdx), profile: pr,
  };
}
