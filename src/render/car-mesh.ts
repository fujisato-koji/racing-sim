// 車の見た目。諸元の寸法から車体の面を作り（car-body.ts）、ライト、ミラー、羽根、タイヤとホイールを付ける。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarParams } from '../sim/params';
import { carGeometry } from '../sim/params';
import type { Vehicle } from '../sim/vehicle';
import { buildBody } from './car-body';
import { quality } from './quality';

const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, metalness: 0.85, roughness: 0.3 });
const discMat = new THREE.MeshStandardMaterial({ color: 0x6d6f73, metalness: 0.7, roughness: 0.5 });
const caliperMat = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.75 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.6, metalness: 0.2 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.9, roughness: 0.1 });

/** ハンドルの回転角 [rad]（右に切ると正）。実際の前輪の切れ角の平均 × ステアリングギア比 */
export function steeringWheelAngle(v: Vehicle) {
  return ((v.wheels[0].steer + v.wheels[1].steer) / 2) * v.p.steer.ratio;
}

function paintMaterial(color: string) {
  if (quality.level === 'low') return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.4, roughness: 0.4 });
  return new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), metalness: 0.45, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 });
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

/** ホイール：リム、5 本のスポーク、中心（外側の面が side の向き） */
function rimGeometry(r: number, w: number, side: number) {
  const rr = r * 0.65;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(rr, rr, w * 0.96, 24, 1, true).rotateZ(Math.PI / 2));
  const face = side * (w / 2 - 0.012);
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * Math.PI * 2;
    parts.push(new THREE.BoxGeometry(0.022, rr * 0.95, 0.045).translate(0, rr * 0.48, 0).rotateX(a).translate(face, 0, 0));
  }
  parts.push(new THREE.CylinderGeometry(rr * 0.22, rr * 0.25, 0.04, 12).rotateZ(Math.PI / 2).translate(face, 0, 0));
  // 合わせる前に索引の有無をそろえる
  return mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)))!;
}

export class CarMesh {
  readonly group = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  private readonly steeringWheel: THREE.Object3D;
  private readonly brakeMat: THREE.MeshStandardMaterial;
  private readonly paint: THREE.Material;
  private readonly glass: THREE.Material;

  constructor(readonly p: CarParams) {
    const g = carGeometry(p);
    const b = p.body;
    this.paint = paintMaterial(p.color);
    this.glass = glassMaterial();
    const add = <T extends THREE.Object3D>(m: T, shadow = true) => {
      m.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = shadow; o.receiveShadow = true; } });
      this.group.add(m);
      return m;
    };

    // 車体
    const body = buildBody(p, g);
    const pr = body.profile;
    add(new THREE.Mesh(body.paint, this.paint));
    add(new THREE.Mesh(body.glass, this.glass));
    add(new THREE.Mesh(body.pillars, this.paint));

    const zf = pr.zf, zr = pr.zr;
    // 前：ライト、グリル
    const zl = zf + 0.1;
    const yl = pr.top(zl) - 0.05;
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), headMat);
      l.scale.set(0.17, 0.05, 0.09);
      l.position.set(s * pr.halfWidth(zl) * 0.66, yl, zl - 0.01);
      add(l, false);
    }
    const zg = zf + 0.05;
    const gh = Math.max(0.06, (pr.top(zg) - pr.bottom(zg)) * 0.35);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(pr.halfWidth(zg) * 1.1, gh, 0.03), trimMat);
    grille.position.set(0, (pr.bottom(zg) + pr.top(zg)) / 2 - 0.03, zf + 0.025);
    add(grille, false);
    // 後ろ：灯火、排気管
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xff1a1a, emissiveIntensity: 0.25, roughness: 0.2 });
    const zt = zr - 0.03;
    const yt = pr.top(zt - 0.05) - 0.07;
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(pr.halfWidth(zt) * 0.5, 0.07, 0.04), this.brakeMat);
      t.position.set(s * pr.halfWidth(zt) * 0.62, yt, zt);
      add(t, false);
    }
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12).rotateX(Math.PI / 2), rimMat);
      e.position.set(s * b.width * 0.28, pr.bottom(zr - 0.1) + 0.05, zr - 0.02);
      add(e, false);
    }
    // ミラー
    const zm = g.cabinFrontZ + 0.22;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.15), this.paint);
      m.position.set(s * (pr.halfWidth(zm) * 0.93 + 0.08), pr.belt + 0.08, zm);
      add(m, false);
    }
    // 羽根
    if (pr.st.wing) {
      const zw = zr - 0.22;
      const yw = pr.top(zw) + 0.2;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.86, 0.025, 0.26), this.paint);
      wing.position.set(0, yw, zw);
      wing.rotation.x = 0.08;
      add(wing);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.08), trimMat);
        post.position.set(s * b.width * 0.3, yw - 0.1, zw);
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
    this.glass.dispose();
    this.brakeMat.dispose();
  }
}
