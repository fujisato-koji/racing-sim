// 車の見た目。諸元の寸法から箱を組み合わせて作る（衝突形状と同じ寸法）。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CarParams } from '../sim/params';
import { DEG, carGeometry } from '../sim/params';
import type { Vehicle } from '../sim/vehicle';

const tireMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.35 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2633, metalness: 0.6, roughness: 0.15 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.8 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.6 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, round = 0.04) {
  if (w <= 0.01 || h <= 0.01 || d <= 0.01) return null;
  const g = round > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(round, w / 2, h / 2, d / 2) * 0.99) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 下が広く上が狭い台形の箱（窓まわり） */
function cabinGeometry(wb: number, wt: number, y0: number, y1: number, zf: number, zr: number, slopeF: number, slopeR: number) {
  const tf = zf + slopeF, tr = zr - slopeR;
  const v = [
    -wb / 2, y0, zf, wb / 2, y0, zf, wb / 2, y0, zr, -wb / 2, y0, zr,
    -wt / 2, y1, tf, wt / 2, y1, tf, wt / 2, y1, tr, -wt / 2, y1, tr,
  ];
  // 外向きの面（内側からは見えないので、運転席の視点では窓の外が見える）
  const idx = [0, 5, 1, 0, 4, 5, 1, 6, 2, 1, 5, 6, 2, 7, 3, 2, 6, 7, 3, 4, 0, 3, 7, 4, 4, 6, 5, 4, 7, 6];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  // 面ごとに法線が分かれるよう、頂点を分けてから法線を出す
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

function beam(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export class CarMesh {
  readonly group = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  private readonly steeringWheel: THREE.Object3D;
  private readonly brakeMat: THREE.MeshStandardMaterial;
  private readonly bodyMat: THREE.MeshStandardMaterial;

  constructor(readonly p: CarParams) {
    const g = carGeometry(p);
    const b = p.body;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), metalness: 0.35, roughness: 0.4 });
    const add = (m: THREE.Object3D | null) => { if (m) this.group.add(m); };

    // 車体の下半分：前後のバンパー、車輪の上のフェンダー、ドアの部分、車輪のあいだの芯
    const W = b.width, y0 = g.bodyBottomY, y1 = g.beltY;
    const fr = p.front.tireRadius, rr = p.rear.tireRadius;
    const fA = g.frontAxleZ, rA = g.rearAxleZ;
    const archF = [fA - fr - 0.06, fA + fr + 0.06], archR = [rA - rr - 0.06, rA + rr + 0.06];
    const seg = (z0: number, z1: number, yb: number, w = W) => add(box(w, y1 - yb, z1 - z0, this.bodyMat, 0, (yb + y1) / 2, (z0 + z1) / 2));
    seg(g.bodyFrontZ, archF[0], y0);
    seg(archF[1], archR[0], y0);
    seg(archR[1], g.bodyRearZ, y0);
    const fTop = g.groundY + 2 * fr + 0.03, rTop = g.groundY + 2 * rr + 0.03;
    if (fTop < y1) seg(archF[0], archF[1], fTop);
    if (rTop < y1) seg(archR[0], archR[1], rTop);
    const coreW = Math.min(p.front.track - p.front.tireWidth, p.rear.track - p.rear.tireWidth) - 0.06;
    seg(archF[0], archF[1], y0, coreW);
    seg(archR[0], archR[1], y0, coreW);

    // 窓まわりと屋根
    const cabH = g.bodyTopY - g.beltY;
    const cabin = new THREE.Mesh(cabinGeometry(W * 0.9, W * 0.78, g.beltY, g.bodyTopY - 0.03, g.cabinFrontZ, g.cabinRearZ, cabH * 1.1, cabH * 0.8), glassMat);
    cabin.castShadow = true;
    add(cabin);
    const roofZ0 = g.cabinFrontZ + cabH * 1.1, roofZ1 = g.cabinRearZ - cabH * 0.8;
    add(box(W * 0.78, 0.04, Math.max(0.1, roofZ1 - roofZ0), this.bodyMat, 0, g.bodyTopY - 0.02, (roofZ0 + roofZ1) / 2, 0.02));
    // 柱（運転席から見える前の柱と屋根の縁）
    for (const s of [-1, 1]) {
      add(beam(new THREE.Vector3((s * W * 0.9) / 2, g.beltY, g.cabinFrontZ), new THREE.Vector3((s * W * 0.78) / 2, g.bodyTopY - 0.03, roofZ0), 0.035, this.bodyMat));
    }
    add(beam(new THREE.Vector3((-W * 0.78) / 2, g.bodyTopY - 0.04, roofZ0), new THREE.Vector3((W * 0.78) / 2, g.bodyTopY - 0.04, roofZ0), 0.04, this.bodyMat));

    // 灯火
    const lightY = y0 + (y1 - y0) * 0.7;
    for (const s of [-1, 1]) {
      add(box(0.28, 0.09, 0.04, headMat, s * W * 0.33, lightY, g.bodyFrontZ - 0.005, 0.01));
    }
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xff1a1a, emissiveIntensity: 0.2 });
    for (const s of [-1, 1]) add(box(0.3, 0.08, 0.04, this.brakeMat, s * W * 0.34, lightY, g.bodyRearZ + 0.005, 0.01));

    // 運転席：計器盤とハンドル
    const [ex, ey, ez] = g.eye;
    add(box(W * 0.82, 0.12, 0.35, darkMat, 0, g.beltY + 0.03, g.cabinFrontZ + 0.32, 0.03));
    const sw = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 24), darkMat);
    sw.add(rim);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.015), darkMat);
    sw.add(spoke);
    const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.015), darkMat);
    spoke2.position.y = -0.085;
    sw.add(spoke2);
    const swHolder = new THREE.Group();
    swHolder.position.set(ex, ey - 0.27, ez - 0.42);
    swHolder.rotation.x = -0.35;
    swHolder.add(sw);
    this.group.add(swHolder);
    this.steeringWheel = sw;

    // 車輪
    for (let k = 0; k < 4; k++) {
      const front = k < 2;
      const ax = front ? p.front : p.rear;
      const wg = new THREE.Group();
      wg.rotation.order = 'YXZ';
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(ax.tireRadius, ax.tireRadius, ax.tireWidth, 24), tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      spin.add(tire);
      const side = k % 2 === 0 ? -1 : 1;
      const rimM = new THREE.Mesh(new THREE.CylinderGeometry(ax.tireRadius * 0.62, ax.tireRadius * 0.62, ax.tireWidth + 0.01, 16), rimMat);
      rimM.rotation.z = Math.PI / 2;
      spin.add(rimM);
      for (let s = 0; s < 5; s++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, ax.tireRadius * 1.2, 0.05), darkMat);
        sp.position.x = side * (ax.tireWidth / 2 + 0.012);
        sp.rotation.x = (s / 5) * Math.PI;
        spin.add(sp);
      }
      wg.add(spin);
      wg.userData.spin = spin;
      this.wheels.push(wg);
      this.group.add(wg);
    }
    // 走る前は静止位置に置く
    for (let k = 0; k < 4; k++) {
      const front = k < 2, side = k % 2 === 0 ? -1 : 1;
      const ax = front ? p.front : p.rear;
      this.wheels[k].position.set((side * ax.track) / 2, g.groundY + ax.tireRadius, front ? fA : rA);
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
    this.steeringWheel.rotation.z = -v.controls.steer * this.p.steer.maxAngleDeg * DEG * 14;
    this.brakeMat.emissiveIntensity = v.brakeOut > 0.05 ? 1.6 : 0.2;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.bodyMat.dispose();
    this.brakeMat.dispose();
  }
}
