// 車の見た目。諸元の寸法から車体の面を作り（car-body.ts）、ライト、ミラー、羽根、タイヤとホイールを付ける。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarGeometry, CarParams, Livery } from '../sim/params';
import { carGeometry } from '../sim/params';
import type { Vehicle } from '../sim/vehicle';
import { buildBody } from './car-body';
import { quality } from './quality';

const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, metalness: 0.85, roughness: 0.3 });
const discMat = new THREE.MeshStandardMaterial({ color: 0x6d6f73, metalness: 0.7, roughness: 0.5 });
const caliperMat = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.75 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.9, roughness: 0.1 });
const plasticMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.55, metalness: 0.1 });
const housingMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.25, metalness: 0.6 });

/** ハンドルの回転角 [rad]（右に切ると正）。実際の前輪の切れ角の平均 × ステアリングギア比 */
export function steeringWheelAngle(v: Vehicle) {
  return ((v.wheels[0].steer + v.wheels[1].steer) / 2) * v.p.steer.ratio;
}

function paintMaterial(color: string) {
  if (quality.level === 'low') return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.4, roughness: 0.4 });
  // 塗装：金属粉の入った下地に透明な上塗り
  return new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), metalness: 0.55, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 });
}

const LIVERY_STYLE: Record<Livery['style'], number> = { none: 0, stripes: 1, side: 2, rally: 3, flash: 4, twotone: 5 };

/** ゼッケンの絵（丸か、ラリーの四角の板に番号） */
function numberTexture(lv: Livery) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const plate = new THREE.Color(lv.plate);
  const dark = plate.r * 0.3 + plate.g * 0.59 + plate.b * 0.11 < 0.5;
  g.fillStyle = lv.plate;
  g.strokeStyle = dark ? '#f2f2f2' : '#111418';
  g.lineWidth = 10;
  g.beginPath();
  if (lv.style === 'rally') g.roundRect(20, 52, 216, 152, 18);
  else g.arc(128, 128, 112, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = dark ? '#ffffff' : '#111418';
  const text = String(lv.number);
  const size = text.length > 1 ? 128 : 150;
  g.font = `italic 900 ${size}px "Titillium Web", "Arial Black", "Helvetica Neue", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 136, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const LIVERY_COMMON = /* glsl */ `
varying vec3 vLvP; varying vec3 vLvN;
uniform vec3 uC2; uniform float uStyle; uniform sampler2D uNum; uniform float uHasNum;
uniform vec4 uDim; uniform vec4 uDim2; uniform vec3 uDoor; uniform vec3 uRoof;
float lvBand(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
`;

const LIVERY_COLOR = /* glsl */ `
{
  vec3 P = vLvP; vec3 N = normalize(vLvN);
  float hw = uDim.x, zf = uDim.y, zr = uDim.z, belt = uDim.w, yb = uDim2.x;
  float t = clamp((P.z - zf) / (zr - zf), 0.0, 1.0);
  float side = smoothstep(0.45, 0.7, abs(N.x));
  float aa = 0.006;
  float m = 0.0;
  float ax = abs(P.x);
  float sb = belt - yb;
  if (uStyle > 0.5 && uStyle < 1.5) {
    // 中央の 2 本線（前から屋根を越えて後ろまで）と外の細い線
    m = (lvBand(ax, 0.045, 0.2 * hw + 0.03, aa) + lvBand(ax, 0.2 * hw + 0.075, 0.2 * hw + 0.1, aa)) * (1.0 - side);
  } else if (uStyle > 1.5 && uStyle < 2.5) {
    // 横の帯：窓の下に太い帯と細い線
    m = (lvBand(P.y, belt - 0.17, belt - 0.07, aa) + lvBand(P.y, belt - 0.25, belt - 0.22, aa)) * side;
  } else if (uStyle > 2.5 && uStyle < 3.5) {
    // ラリー：横は前の下から後ろの上へ斜めの色面、ボンネットに片寄せの線
    float edge = yb + sb * (0.18 + 0.85 * t);
    m = (1.0 - smoothstep(edge - aa, edge + aa, P.y)) * side;
    m += lvBand(P.x, -0.36 * hw, -0.18 * hw, aa) * (1.0 - side) * step(P.z, uDim2.z);
  } else if (uStyle > 3.5 && uStyle < 4.5) {
    // 稲妻：横に前の下から後ろの上へ斜めの帯、上に中央の太い線
    float c = yb + sb * (0.22 + 0.62 * t);
    m = lvBand(P.y, c - 0.07, c + 0.07, aa) * side * step(0.06, t) * step(t, 0.96);
    m += (1.0 - smoothstep(0.13 * hw - aa, 0.13 * hw + aa, ax)) * (1.0 - side);
  } else if (uStyle > 4.5) {
    // 上下の塗り分け：窓から上を 2 色目
    m = smoothstep(belt + 0.01, belt + 0.04, P.y);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, uC2, clamp(m, 0.0, 1.0));
  if (uHasNum > 0.5) {
    // ドア：どちらの側から見ても読めるように（右側は前が右、左側は後ろが右）
    float dir = P.x > 0.0 ? -1.0 : 1.0;
    vec2 du = vec2(dir * (P.z - uDoor.x) / uDoor.z + 0.5, (P.y - uDoor.y) / uDoor.z + 0.5);
    if (side > 0.5 && du.x > 0.0 && du.x < 1.0 && du.y > 0.0 && du.y < 1.0) {
      vec4 c = texture2D(uNum, du);
      diffuseColor.rgb = mix(diffuseColor.rgb, c.rgb, c.a);
    }
    // 屋根：後ろから見て読めるように（前が上）
    vec2 ru = vec2(P.x / uRoof.z + 0.5, -(P.z - uRoof.x) / uRoof.z + 0.5);
    if (N.y > 0.8 && P.y > uRoof.y - 0.25 && ru.x > 0.0 && ru.x < 1.0 && ru.y > 0.0 && ru.y < 1.0) {
      vec4 c = texture2D(uNum, ru);
      diffuseColor.rgb = mix(diffuseColor.rgb, c.rgb, c.a);
    }
  }
}
`;

/**
 * 塗装に柄を足す。柄は車体の座標（右が +x、上が +y、前が −z）から決めるので、展開図（UV）が要らない。
 * 線と色面は位置の範囲で、番号は横と屋根に絵を投影して描く
 */
function applyLivery(mat: THREE.Material, p: CarParams, g: CarGeometry, num: THREE.Texture | null) {
  const lv = p.livery;
  const hw = p.body.width / 2;
  const doorZ = g.cabinFrontZ + 0.4 * (g.cabinRearZ - g.cabinFrontZ);
  const doorY = g.bodyBottomY + 0.52 * (g.beltY - g.bodyBottomY);
  const doorS = Math.min(0.62, (g.beltY - g.bodyBottomY) * 0.9);
  const roofS = Math.min(0.62, hw * 0.85);
  const uniforms = {
    uC2: { value: new THREE.Color(lv.color2) },
    uStyle: { value: LIVERY_STYLE[lv.style] ?? 0 },
    uNum: { value: num },
    uHasNum: { value: num ? 1 : 0 },
    uDim: { value: new THREE.Vector4(hw, g.bodyFrontZ, g.bodyRearZ, g.beltY) },
    uDim2: { value: new THREE.Vector4(g.bodyBottomY, g.bodyTopY, g.cabinFrontZ, g.cabinRearZ) },
    uDoor: { value: new THREE.Vector3(doorZ, doorY, doorS) },
    uRoof: { value: new THREE.Vector3((g.cabinFrontZ + g.cabinRearZ) / 2 + 0.05, g.bodyTopY, roofS) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLvP;\nvarying vec3 vLvN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLvP = position;\nvLvN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LIVERY_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + LIVERY_COLOR);
  };
  mat.customProgramCacheKey = () => 'livery';
}

function glassMaterial() {
  if (quality.level === 'low') return new THREE.MeshStandardMaterial({ color: 0x18222e, metalness: 0.6, roughness: 0.12 });
  return new THREE.MeshPhysicalMaterial({ color: 0x101820, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 });
}

/** タイヤの断面を回した形（車軸は x 方向） */
function tireGeometry(r: number, w: number) {
  const rr = r * 0.66, sh = Math.min(0.03, w * 0.15);
  const pts = [
    new THREE.Vector2(rr, -w / 2), new THREE.Vector2(r - sh * 1.6, -w / 2), new THREE.Vector2(r - sh * 0.4, -w / 2 + sh * 0.3),
    new THREE.Vector2(r, -w / 2 + sh), new THREE.Vector2(r, w / 2 - sh), new THREE.Vector2(r - sh * 0.4, w / 2 - sh * 0.3),
    new THREE.Vector2(r - sh * 1.6, w / 2), new THREE.Vector2(rr, w / 2),
  ];
  return new THREE.LatheGeometry(pts, 32).rotateZ(Math.PI / 2);
}

/** ホイール：リム、外周の縁、10 本のスポーク（中心へ向けてへこむ）、中心（外側の面が side の向き） */
function rimGeometry(r: number, w: number, side: number) {
  const rr = r * 0.66;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(rr, rr, w * 0.96, 28, 1, true).rotateZ(Math.PI / 2));
  // 外周の縁
  parts.push(new THREE.TorusGeometry(rr * 0.98, 0.012, 6, 28).rotateY(Math.PI / 2).translate(side * (w / 2 - 0.01), 0, 0));
  const face = side * (w / 2 - 0.018);
  for (let s = 0; s < 10; s++) {
    const a = (s / 10) * Math.PI * 2 + (s % 2) * 0.12;
    // 外周は外側、中心は奥（へこんだ面）
    const sp = new THREE.BoxGeometry(0.016, rr * 0.82, 0.028).translate(0, rr * 0.5, 0);
    sp.rotateZ(side * 0.18);
    parts.push(sp.rotateX(a).translate(face - side * 0.02, 0, 0));
  }
  parts.push(new THREE.CylinderGeometry(rr * 0.2, rr * 0.24, 0.05, 14).rotateZ(Math.PI / 2).translate(face - side * 0.03, 0, 0));
  // 合わせる前に索引の有無をそろえる
  return mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)))!;
}

export class CarMesh {
  readonly group = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  private readonly steeringWheel: THREE.Object3D;
  private readonly brakeMat: THREE.MeshStandardMaterial;
  private readonly paint: THREE.Material;
  /** 鏡や羽根など小さな部品の塗装（柄なし） */
  private readonly paintPlain: THREE.Material;
  private readonly numberTex: THREE.Texture | null;
  private readonly glass: THREE.Material;

  constructor(readonly p: CarParams) {
    const g = carGeometry(p);
    const b = p.body;
    this.paint = paintMaterial(p.color);
    this.paintPlain = paintMaterial(p.color);
    this.numberTex = p.livery && p.livery.number > 0 ? numberTexture(p.livery) : null;
    if (p.livery) applyLivery(this.paint, p, g, this.numberTex);
    this.glass = glassMaterial();
    const add = <T extends THREE.Object3D>(m: T, shadow = true) => {
      m.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = shadow; o.receiveShadow = true; } });
      this.group.add(m);
      return m;
    };

    // 車体：塗装、黒い下回り、ガラス、屋根と柱、黒い縁
    const body = buildBody(p, g);
    const pr = body.profile;
    add(new THREE.Mesh(body.paint, this.paint));
    add(new THREE.Mesh(body.trim, plasticMat));
    add(new THREE.Mesh(body.glass, this.glass));
    add(new THREE.Mesh(body.pillars, this.paint));
    add(new THREE.Mesh(body.blackout, plasticMat));

    const zf = pr.zf, zr = pr.zr;
    const rbox = (w: number, h: number, d: number, r = 0.012) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
    // 前：細いライト（黒い枠と光る帯）を前の面の上の角に、グリルと吸気口を前の面の表に
    const zl = zf + 0.04;
    const yl = pr.top(zl) - 0.05;
    const lw = b.width * 0.17;
    for (const s of [-1, 1]) {
      const x = s * pr.halfWidth(zl) * 0.62;
      const lamp = new THREE.Group();
      lamp.add(new THREE.Mesh(rbox(lw, 0.05, 0.14, 0.018), housingMat));
      const bar = new THREE.Mesh(rbox(lw * 0.88, 0.016, 0.03, 0.006), headMat);
      bar.position.set(0, -0.006, -0.06);
      lamp.add(bar);
      lamp.position.set(x, yl, zl);
      // 外へ向けて後ろへ流す
      lamp.rotation.set(0, -s * 0.3, 0);
      add(lamp, false);
    }
    const zg = zf + 0.02;
    const fb = pr.bottom(zg), ft = pr.top(zg);
    const ghw = pr.halfWidth(zg);
    const grille = new THREE.Mesh(rbox(ghw * 0.85, Math.max(0.05, (ft - fb) * 0.24), 0.03, 0.02), plasticMat);
    grille.position.set(0, fb + (ft - fb) * 0.55, zf - 0.006);
    add(grille, false);
    const big = pr.st.aero;
    const intake = new THREE.Mesh(rbox(ghw * (big ? 1.45 : 1.3), Math.max(0.04, (ft - fb) * (big ? 0.34 : 0.16)), 0.03, 0.025), plasticMat);
    intake.position.set(0, fb + (ft - fb) * (big ? 0.3 : 0.2), zf - 0.004);
    add(intake, false);
    if (big) {
      // 両脇の吸気口
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(rbox(0.16, Math.max(0.05, (ft - fb) * 0.3), 0.03, 0.02), plasticMat);
        side.position.set(s * ghw * 0.95, fb + (ft - fb) * 0.32, zf + 0.03);
        side.rotation.y = -s * 0.5;
        add(side, false);
      }
    }
    if (pr.st.aero) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(pr.halfWidth(zf + 0.06) * 1.7, 0.016, 0.07), plasticMat);
      sp.position.set(0, pr.bottom(zf + 0.1) - 0.004, zf + 0.06);
      add(sp, false);
    }
    // 後ろ：横一文字の灯火と両端、ディフューザー、排気管
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xff1a1a, emissiveIntensity: 0.25, roughness: 0.2 });
    const zt = zr + 0.004;
    const yt = pr.top(zr - 0.12) - 0.06;
    const thw = pr.halfWidth(zr - 0.05);
    const strip = new THREE.Mesh(rbox(thw * 1.7, 0.03, 0.03, 0.01), this.brakeMat);
    strip.position.set(0, yt, zt);
    add(strip, false);
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(rbox(thw * 0.42, 0.065, 0.05, 0.015), this.brakeMat);
      t.position.set(s * thw * 0.7, yt - 0.01, zt - 0.01);
      add(t, false);
    }
    if (pr.st.aero) {
      const dif = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.7, 0.08, 0.2), plasticMat);
      dif.position.set(0, pr.bottom(zr - 0.1) + 0.02, zr - 0.08);
      add(dif, false);
      for (let k = -2; k <= 2; k++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.22), plasticMat);
        fin.position.set(k * b.width * 0.12, pr.bottom(zr - 0.1) + 0.02, zr - 0.08);
        add(fin, false);
      }
    }
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.14, 16).rotateX(Math.PI / 2), rimMat);
      e.position.set(s * b.width * (pr.st.aero ? 0.12 : 0.3), pr.bottom(zr - 0.1) + 0.06, zr - 0.03);
      add(e, false);
    }
    // ミラー：支柱の先に車体色の殻
    const zm = g.cabinFrontZ + 0.2;
    for (const s of [-1, 1]) {
      const bx = s * pr.halfWidth(zm) * 0.86;
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.04), plasticMat);
      stalk.position.set(bx + s * 0.04, pr.beltAt(zm) + 0.04, zm);
      add(stalk, false);
      const shell = new THREE.Mesh(rbox(0.07, 0.07, 0.13, 0.03), this.paintPlain);
      shell.position.set(bx + s * 0.1, pr.beltAt(zm) + 0.07, zm + 0.01);
      add(shell, false);
    }
    // 羽根：小さな縁か、支柱の上の羽根
    if (pr.st.wing === 'lip') {
      const zw = Math.min(zr - 0.06, g.cabinRearZ + 0.05);
      const lip = new THREE.Mesh(rbox(b.width * 0.72, 0.02, 0.1, 0.008), this.paintPlain);
      lip.position.set(0, pr.top(zw) + 0.012, zw);
      lip.rotation.x = 0.12;
      add(lip, false);
    } else if (pr.st.wing === 'wing') {
      const zw = zr - 0.2;
      const yw = pr.top(zw) + 0.2;
      const wing = new THREE.Mesh(rbox(b.width * 0.88, 0.022, 0.28, 0.01), this.paintPlain);
      wing.position.set(0, yw, zw);
      wing.rotation.x = 0.1;
      add(wing);
      for (const s of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.1, 0.32), plasticMat);
        plate.position.set(s * b.width * 0.44, yw - 0.02, zw);
        add(plate, false);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.2, 0.07), plasticMat);
        post.position.set(s * b.width * 0.28, yw - 0.1, zw);
        add(post, false);
      }
    }

    // 運転席：計器盤、ハンドル、前の柱（中から見える）
    const [ex, ey, ez] = g.eye;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.8, 0.12, 0.36), darkMat);
    dash.position.set(0, pr.belt + 0.03, g.cabinFrontZ + 0.34);
    add(dash, false);
    for (const s of [-1, 1]) {
      const [x0, y0] = pr.cabinPoint(g.cabinFrontZ + 0.02, s > 0 ? 2 : 16);
      const [x1, y1] = pr.cabinPoint(pr.wsEnd, s > 0 ? 2 : 16);
      const a = new THREE.Vector3(x0 * 0.97, y0, g.cabinFrontZ + 0.03), c = new THREE.Vector3(x1 * 0.97, y1 - 0.02, pr.wsEnd);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, a.distanceTo(c), 6), darkMat);
      beam.position.copy(a).add(c).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      add(beam, false);
    }
    const sw = new THREE.Group();
    sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 28), darkMat));
    sw.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.015), darkMat));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.015), darkMat);
    spoke.position.y = -0.085;
    sw.add(spoke);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.02), new THREE.MeshBasicMaterial({ color: 0xffb000 }));
    mark.position.y = 0.18;
    sw.add(mark);
    const holder = new THREE.Group();
    holder.position.set(ex, ey - 0.27, ez - 0.42);
    holder.rotation.x = -0.35;
    holder.add(sw);
    this.group.add(holder);
    this.steeringWheel = sw;

    // 車輪
    for (let k = 0; k < 4; k++) {
      const front = k < 2;
      const ax = front ? p.front : p.rear;
      const side = k % 2 === 0 ? -1 : 1;
      const wg = new THREE.Group();
      wg.rotation.order = 'YXZ';
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tireGeometry(ax.tireRadius, ax.tireWidth), tireMat));
      spin.add(new THREE.Mesh(rimGeometry(ax.tireRadius, ax.tireWidth, side), rimMat));
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(ax.tireRadius * 0.52, ax.tireRadius * 0.52, 0.025, 20).rotateZ(Math.PI / 2), discMat);
      disc.position.x = -side * ax.tireWidth * 0.1;
      spin.add(disc);
      spin.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      wg.add(spin);
      // ブレーキのキャリパーは回らない
      const cal = new THREE.Mesh(new THREE.BoxGeometry(0.05, ax.tireRadius * 0.34, ax.tireRadius * 0.22), caliperMat);
      cal.position.set(-side * ax.tireWidth * 0.05, ax.tireRadius * 0.36, front ? -ax.tireRadius * 0.25 : ax.tireRadius * 0.25);
      wg.add(cal);
      wg.userData.spin = spin;
      this.wheels.push(wg);
      this.group.add(wg);
      wg.position.set((side * ax.track) / 2, g.groundY + ax.tireRadius, front ? g.frontAxleZ : g.rearAxleZ);
    }
  }

  /** 物理の状態から姿勢を合わせる。alpha は前のステップとの補間 */
  update(v: Vehicle, alpha: number) {
    this.group.position.lerpVectors(v.prevPos, v.pos, alpha);
    this.group.quaternion.slerpQuaternions(v.prevQuat, v.quat, alpha);
    for (let k = 0; k < 4; k++) {
      const w = v.wheels[k], m = this.wheels[k];
      m.position.set(w.mount.x, w.mount.y - w.dist, w.mount.z);
      m.rotation.y = -w.steer;
      (m.userData.spin as THREE.Object3D).rotation.x = -w.spin;
    }
    // ハンドルの回転 = 実際のタイヤの切れ角 × ステアリングギア比
    this.steeringWheel.rotation.z = -steeringWheelAngle(v);
    this.brakeMat.emissiveIntensity = v.brakeOut > 0.05 ? 1.8 : 0.25;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.paint.dispose();
    this.paintPlain.dispose();
    this.numberTex?.dispose();
    this.glass.dispose();
    this.brakeMat.dispose();
  }
}
