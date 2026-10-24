// 車両。車体は物理エンジンの剛体で、サス、タイヤ、駆動系、空力の力をここで計算して加える。
// 車体座標は重心が原点、右 +x、上 +y、前 -z。
import { Quaternion, Vector3 } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CarGeometry, CarParams } from './params';
import { DEG, G, RHO, carGeometry, drivenAxles, engineTorque, peakValues } from './params';
import { CF, CR, Drivetrain, ENGINE, PROP, WHEELS } from './drivetrain';
import type { Surface } from './surfaces';
import { SURFACES, surfaceBump } from './surfaces';
import type { TireOut } from './tire';
import { deflectionLimits, tireForce } from './tire';
import type { PhysicsWorld } from './world';
import { GROUPS } from './world';

export interface Controls {
  /** -1（左）〜 1（右） */
  steer: number;
  throttle: number;
  brake: number;
}

export interface WheelState {
  front: boolean;
  side: 1 | -1;
  radius: number;
  width: number;
  /** サスの取付点（車体座標） */
  mount: Vector3;
  travel: number;
  /** サスが伸び切ったときの取付点から車輪中心までの距離 */
  dMax: number;
  spring: number;
  bump: number;
  rebound: number;
  antiRoll: number;
  rollCenter: number;
  brakeTorque: number;
  shape: RAPIER.Shape;
  // ---- 状態
  contact: boolean;
  /** 取付点から車輪中心までの距離 */
  dist: number;
  compression: number;
  fz: number;
  surface: Surface;
  /** 緩和長の変形（前後、横） [m] */
  u: number;
  v: number;
  kappa: number;
  tanAlpha: number;
  fx: number;
  fy: number;
  /** 接地面の滑りの速さ [m/s]（音や煙に使う） */
  slipSpeed: number;
  steer: number;
  spin: number;
  absFactor: number;
  /** 前のステップの凹凸の高さ */
  bump0: number;
  point: Vector3;
  normal: Vector3;
}

const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3();
const _q1 = new Quaternion(), _q2 = new Quaternion();
const Y = new Vector3(0, 1, 0);
const ROT_Z90 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
const tireOut: TireOut = { fx: 0, fy: 0, limit: 0, sx: 0, sy: 0 };

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const RPM = 60 / (2 * Math.PI);

export class Vehicle {
  readonly geom: CarGeometry;
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelState[];
  readonly dt: Drivetrain;
  controls: Controls = { steer: 0, throttle: 0, brake: 0 };
  /** true のあいだはブレーキを踏んだままにする（スタート前） */
  hold = false;

  // 姿勢（描画の補間用に一つ前も持つ）
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  readonly prevPos = new Vector3();
  readonly prevQuat = new Quaternion();
  readonly linvel = new Vector3();
  readonly angvel = new Vector3();
  readonly right = new Vector3();
  readonly up = new Vector3();
  readonly fwd = new Vector3();

  gear = 1;
  shifting = 0;
  private nextGear = 1;
  private sinceShift = 0;
  private reverseTimer = 0;
  private forwardTimer = 0;
  private limiter = false;
  private tcsFactor = 1;
  /** 前向きの速さ [m/s] */
  speed = 0;
  rpm = 0;
  airborne = false;
  airTime = 0;
  /** いま切れる最大の角度 [rad]（補助で速さに応じて絞った後） */
  steerLimit = 0.5;
  /** 実際に使ったアクセル（補助で絞った後） */
  throttleOut = 0;
  brakeOut = 0;

  private readonly fz0: number;
  private readonly clutchMax: number;
  private readonly launchRpm: number;
  private readonly peakTorqueRpm: number;
  private readonly cdSide: number;
  private readonly cdTop: number;
  private readonly cornerMass: number[];
  private readonly brakeCap = [0, 0, 0, 0];

  constructor(readonly pw: PhysicsWorld, readonly p: CarParams, spawn: { x: number; y: number; z: number; yaw: number }) {
    const R = pw.R;
    const g = (this.geom = carGeometry(p));
    const bd = p.body;
    const desc = R.RigidBodyDesc.dynamic()
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAngularDamping(0.1)
      .setAdditionalMassProperties(bd.mass, { x: 0, y: 0, z: 0 }, { x: g.inertia[0], y: g.inertia[1], z: g.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
    this.body = pw.world.createRigidBody(desc);

    // 衝突形状：車体の下半分、窓より上、車輪（小物と他車を押す用）
    const rad = 0.04;
    const box = (hx: number, hy: number, hz: number, cx: number, cy: number, cz: number) => {
      const c = R.ColliderDesc.roundCuboid(Math.max(0.01, hx - rad), Math.max(0.01, hy - rad), Math.max(0.01, hz - rad), rad)
        .setTranslation(cx, cy, cz).setDensity(0).setFriction(0.4).setRestitution(0.1)
        .setCollisionGroups(GROUPS.chassis);
      pw.world.createCollider(c, this.body);
    };
    box(bd.width / 2, (g.beltY - g.bodyBottomY) / 2, bd.length / 2, 0, (g.beltY + g.bodyBottomY) / 2, (g.bodyFrontZ + g.bodyRearZ) / 2);
    box(bd.width * 0.43, (g.bodyTopY - g.beltY) / 2, (g.cabinRearZ - g.cabinFrontZ) / 2, 0, (g.bodyTopY + g.beltY) / 2, (g.cabinFrontZ + g.cabinRearZ) / 2);

    this.fz0 = (bd.mass * G) / 4;
    this.cornerMass = [];
    const inertias: number[] = [];
    this.wheels = [];
    for (let k = 0; k < 4; k++) {
      const front = k < 2;
      const side = k % 2 === 0 ? -1 : 1;
      const ax = front ? p.front : p.rear;
      const load = (bd.mass * G * (front ? bd.weightFront : 1 - bd.weightFront)) / 2;
      this.cornerMass.push(load / G);
      const sag = load / ax.spring;
      const z = front ? g.frontAxleZ : g.rearAxleZ;
      const mount = new Vector3((side * ax.track) / 2, g.groundY + ax.tireRadius + ax.travel, z);
      inertias.push(Math.max(0.3, 0.7 * ax.wheelMass * ax.tireRadius * ax.tireRadius));
      const wc = R.ColliderDesc.cylinder(ax.tireWidth / 2, ax.tireRadius)
        .setTranslation(mount.x, g.groundY + ax.tireRadius, z)
        .setRotation({ x: ROT_Z90.x, y: ROT_Z90.y, z: ROT_Z90.z, w: ROT_Z90.w })
        .setDensity(0).setFriction(0.8).setRestitution(0.1)
        .setCollisionGroups(GROUPS.wheel);
      pw.world.createCollider(wc, this.body);
      this.wheels.push({
        front, side, radius: ax.tireRadius, width: ax.tireWidth, mount, travel: ax.travel,
        dMax: ax.travel + sag, spring: ax.spring, bump: ax.damperBump, rebound: ax.damperRebound,
        antiRoll: ax.antiRoll, rollCenter: ax.rollCenter, brakeTorque: ax.brakeTorque,
        shape: new R.Cylinder(ax.tireWidth / 2, ax.tireRadius),
        contact: false, dist: ax.travel + sag, compression: 0, fz: 0, surface: SURFACES.asphalt,
        u: 0, v: 0, kappa: 0, tanAlpha: 0, fx: 0, fy: 0, slipSpeed: 0, steer: 0, spin: 0, absFactor: 1, bump0: 0,
        point: new Vector3(), normal: new Vector3(0, 1, 0),
      });
    }
    this.dt = new Drivetrain(p, inertias);
    this.dt.setGearRatio(p.gearbox.ratios[0]);

    const pk = peakValues(p);
    this.peakTorqueRpm = pk.peakTorqueRpm;
    this.clutchMax = 1.6 * pk.peakTorque;
    this.launchRpm = p.engine.idleRpm + 0.25 * (p.engine.redlineRpm - p.engine.idleRpm);
    this.cdSide = 1.0 * bd.length * (bd.height - bd.groundClearance) * 0.85;
    this.cdTop = 1.1 * bd.length * bd.width * 0.8;

    this.place(spawn.x, spawn.y, spawn.z, spawn.yaw);
  }

  /** 地面の点（x, y, z）に、向き yaw（0 で -z 向き、正で左回り）で置き直す */
  place(x: number, y: number, z: number, yaw: number) {
    // 重心の高さに置けば、各輪はちょうど静的に縮んだ位置で接地する
    const h = -this.geom.groundY + 0.02;
    _q1.setFromAxisAngle(Y, yaw);
    this.body.setTranslation({ x, y: y + h, z }, true);
    this.body.setRotation({ x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.dt.reset();
    this.dt.w[ENGINE] = this.p.engine.idleRpm / RPM;
    for (const w of this.wheels) {
      w.u = 0; w.v = 0; w.contact = false; w.compression = 0; w.fz = 0; w.absFactor = 1;
    }
    this.gear = 1;
    this.shifting = 0;
    this.dt.setGearRatio(this.p.gearbox.ratios[0]);
    this.readState();
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  private readState() {
    const t = this.body.translation(), q = this.body.rotation(), lv = this.body.linvel(), av = this.body.angvel();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(q.x, q.y, q.z, q.w);
    this.linvel.set(lv.x, lv.y, lv.z);
    this.angvel.set(av.x, av.y, av.z);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
  }

  /** 物理エンジンが進んだ後の姿勢を読む */
  afterStep() {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.readState();
  }

  step(dt: number) {
    const p = this.p;
    const { pos, linvel, angvel, right, up, fwd } = this;
    const vf = linvel.dot(fwd);
    this.speed = vf;

    // ---------------------------------------------------- 入力と変速
    const raw = this.controls;
    this.selectDirection(dt, raw, vf);
    let throttle = this.gear < 0 ? raw.brake : raw.throttle;
    let brake = this.gear < 0 ? raw.throttle : raw.brake;
    if (this.hold) brake = 1;
    this.autoShift(dt, throttle, brake);

    // ---------------------------------------------------- 操舵
    const front = this.wheels[0];
    const muFront = p.tire.mu * front.surface.mu;
    const maxSteer = p.steer.maxAngleDeg * DEG;
    let lim = maxSteer;
    if (p.assists.steerAssist) {
      const v = Math.max(Math.abs(vf), 1);
      lim = Math.min(maxSteer, (p.wheelbase * muFront * G) / (v * v) + p.tire.peakAngleDeg * DEG * front.surface.slipScale * 1.25);
    }
    this.steerLimit = lim;
    const delta = raw.steer * lim;
    const steerAngles = [delta, delta];
    if (Math.abs(delta) > 1e-4) {
      const L = p.wheelbase, t = p.front.track;
      const Rt = L / Math.tan(Math.abs(delta));
      const inner = Math.atan(L / Math.max(0.5, Rt - t / 2)), outer = Math.atan(L / (Rt + t / 2));
      const s = Math.sign(delta), ack = p.steer.ackermann;
      // 右に切るときは右輪（index 1）が内側
      const innerIdx = delta > 0 ? 1 : 0;
      steerAngles[innerIdx] = s * lerp(Math.abs(delta), inner, ack);
      steerAngles[1 - innerIdx] = s * lerp(Math.abs(delta), outer, ack);
    }

    // ---------------------------------------------------- サス
    const world = this.pw.world;
    const down = _v4.copy(up).negate();
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      w.steer = k < 2 ? steerAngles[k] : 0;
      const mountW = _v1.copy(w.mount).applyQuaternion(this.quat).add(pos);
      _q2.setFromAxisAngle(Y, -w.steer);
      _q1.copy(this.quat).multiply(_q2).multiply(ROT_Z90);
      const hit = world.castShape(mountW, _q1, down, w.shape, 0, w.dMax + 0.05, true, undefined, GROUPS.suspension, undefined, this.body);
      const prevContact = w.contact;
      const prevX = w.compression;
      w.contact = false;
      if (hit) {
        const surf = this.pw.surfaceOf.get(hit.collider.handle) ?? SURFACES.asphalt;
        // 円柱と面の接触は幅方向のどこが返るか定まらないので、接地点は車輪の中心面の上にとる
        w.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
        w.point.copy(mountW).addScaledVector(down, hit.time_of_impact).addScaledVector(w.normal, -w.radius);
        const d = hit.time_of_impact + surf.sink - surfaceBump(surf, w.point.x, w.point.z);
        if (d < w.dMax) {
          w.contact = true;
          w.surface = surf;
          w.dist = Math.max(0, d);
          w.compression = w.dMax - w.dist;
        }
      }
      if (!w.contact) {
        w.dist = w.dMax;
        w.compression = 0;
        w.fz = 0;
        continue;
      }
      // 縮む速さ：取付点の速度と接地面の傾きから求め、細かい凹凸のぶんだけ差分で足す
      // （縮み量の差分だけで求めると、形状を当てる計算の誤差を拾って振れる）
      _v2.copy(mountW).sub(pos);
      _v3.copy(angvel).cross(_v2).add(linvel);
      const dn = down.dot(w.normal);
      const bump = w.surface.roughness > 0 ? surfaceBump(w.surface, w.point.x, w.point.z) : 0;
      let xdot = Math.abs(dn) > 0.3 ? _v3.dot(w.normal) / dn : (w.compression - prevX) / dt;
      if (prevContact) xdot += (bump - w.bump0) / dt;
      else xdot = Math.max(0, xdot);
      w.bump0 = bump;
      xdot = Math.max(-10, Math.min(10, xdot));
      let f = w.spring * w.compression + (xdot > 0 ? w.bump : w.rebound) * xdot;
      const over = w.compression - w.travel;
      if (over > 0) f += (w.spring * 10 + 2e5) * over + (xdot > 0 ? w.bump * 3 * xdot : 0);
      w.fz = f;
    }
    // スタビライザー
    for (const [l, r] of [[0, 1], [2, 3]]) {
      const wl = this.wheels[l], wr = this.wheels[r];
      const df = wl.antiRoll * (wl.compression - wr.compression);
      if (wl.contact) wl.fz += df;
      if (wr.contact) wr.fz -= df;
    }
    // ロールセンターを通る荷重移動（ばねを介さず、横力から直接移る分）。横力は一つ前のステップの値
    for (const [l, r] of [[0, 1], [2, 3]]) {
      const wl = this.wheels[l], wr = this.wheels[r];
      if (!wl.contact || !wr.contact) continue;
      const track = l === 0 ? p.front.track : p.rear.track;
      const df = ((wl.fy + wr.fy) * wl.rollCenter) / track;
      wl.fz += df;
      wr.fz -= df;
    }
    let anyContact = false;
    for (const w of this.wheels) {
      if (w.contact) { w.fz = Math.max(0, w.fz); anyContact = true; }
    }
    this.airborne = !anyContact;
    this.airTime = this.airborne ? this.airTime + dt : 0;

    // ---------------------------------------------------- タイヤ
    const drt = this.dt;
    const force = new Vector3();
    const torque = new Vector3();
    const sigY = p.tire.relaxLength, sigX = sigY * 0.5;
    const axles: Vector3[] = [];
    let maxSpin = 0;
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      // 車輪の軸（右向き）
      const axle = new Vector3().copy(right).multiplyScalar(cs).addScaledVector(fwd, -sn);
      axles.push(axle);
      const omega = drt.w[WHEELS[k]];
      drt.ext[WHEELS[k]] = 0;
      if (!w.contact || w.fz <= 0) {
        w.u = 0; w.v = 0; w.kappa = 0; w.tanAlpha = 0; w.fx = 0; w.fy = 0; w.slipSpeed = 0;
        this.brakeCap[k] = 0;
        continue;
      }
      const n = w.normal;
      const tf = _v1.copy(n).cross(axle).normalize();
      const tr = _v2.copy(tf).cross(n);
      const rel = _v3.copy(w.point).sub(pos);
      const vc = new Vector3().copy(angvel).cross(rel).add(linvel);
      const vx = vc.dot(tf), vy = vc.dot(tr);
      const R = w.radius;
      const vsx = omega * R - vx, vsy = -vy;
      const lim = deflectionLimits(p, w.surface);
      const avx = Math.abs(vx);
      // 緩和長：du/dt = vsx - |vx| u / σ を厳密に積分
      if (avx > 1e-3) {
        const ex = Math.exp((-avx * dt) / sigX), ey = Math.exp((-avx * dt) / sigY);
        w.u = w.u * ex + (vsx * sigX * (1 - ex)) / avx;
        w.v = w.v * ey + (vsy * sigY * (1 - ey)) / avx;
      } else {
        w.u += vsx * dt;
        w.v += vsy * dt;
      }
      w.u = Math.max(-sigX * lim.kappaMax, Math.min(sigX * lim.kappaMax, w.u));
      w.v = Math.max(-sigY * lim.tanAlphaMax, Math.min(sigY * lim.tanAlphaMax, w.v));
      w.kappa = w.u / sigX;
      w.tanAlpha = w.v / sigY;
      tireForce(p, w.surface, w.kappa, w.tanAlpha, w.fz, this.fz0, tireOut);
      let fx = tireOut.fx, fy = tireOut.fy;
      // 低速では変形がばねのように振れるので減衰を足す
      const vt = Math.hypot(vx, vy);
      const blend = Math.max(0, 1 - vt / 3);
      if (blend > 0) {
        const kp = p.tire.peakSlip * w.surface.slipScale, ap = p.tire.peakAngleDeg * DEG * w.surface.slipScale;
        const kx = ((Math.PI / 2) * tireOut.limit) / kp / sigX;
        const ky = ((Math.PI / 2) * tireOut.limit) / ap / sigY;
        const Iw = drt.I[WHEELS[k]];
        const cx = 2 * 0.5 * Math.sqrt((kx * Iw) / (R * R));
        const cy = 2 * 0.6 * Math.sqrt(ky * this.cornerMass[k]);
        fx += blend * cx * vsx;
        fy += blend * cy * vsy;
      }
      const mag = Math.hypot(fx, fy);
      if (mag > tireOut.limit) { fx *= tireOut.limit / mag; fy *= tireOut.limit / mag; }
      w.fx = fx;
      w.fy = fy;
      w.slipSpeed = Math.hypot(vsx, vsy);
      drt.ext[WHEELS[k]] = -fx * R;

      // ABS とトラクションコントロール
      const dir = vx >= 0 ? 1 : -1;
      const kpS = p.tire.peakSlip * w.surface.slipScale;
      if (p.assists.abs && brake > 0.05 && avx > 2 && w.kappa * dir < -1.2 * kpS) w.absFactor = Math.max(0.25, w.absFactor - 12 * dt);
      else w.absFactor = Math.min(1, w.absFactor + 6 * dt);
      const driven = w.front ? drivenAxles(p.drive.layout).front : drivenAxles(p.drive.layout).rear;
      if (driven) maxSpin = Math.max(maxSpin, (w.kappa * dir) / kpS);

      this.brakeCap[k] = brake * w.brakeTorque * w.absFactor + w.surface.rolling * w.fz * R;

      // 力を重心まわりに集める：縦と横は接地点、前後は車輪中心（車輪を回す反トルクは駆動系から別に返す）
      const center = _v3.copy(w.point).addScaledVector(n, R);
      const fSus = _v4.copy(up).multiplyScalar(w.fz);
      this.addForce(force, torque, fSus, w.point);
      this.addForce(force, torque, new Vector3().copy(tf).multiplyScalar(fx), center);
      this.addForce(force, torque, new Vector3().copy(tr).multiplyScalar(fy), w.point);
    }

    // ---------------------------------------------------- エンジンと駆動系
    if (p.assists.tcs && maxSpin > 1.3) this.tcsFactor = Math.max(0.15, this.tcsFactor - 5 * dt);
    else this.tcsFactor = Math.min(1, this.tcsFactor + 2 * dt);
    let thr = throttle * (p.assists.tcs ? this.tcsFactor : 1);
    if (this.shifting > 0) thr = 0;
    const rpm = drt.w[ENGINE] * RPM;
    if (rpm > p.engine.redlineRpm) this.limiter = true;
    else if (rpm < p.engine.redlineRpm - 300) this.limiter = false;
    if (this.limiter) thr = 0;
    thr = Math.max(thr, Math.max(0, Math.min(1, (p.engine.idleRpm - rpm) / 250)) * 0.6);
    this.throttleOut = thr;
    this.brakeOut = brake;
    drt.ext[ENGINE] = thr * engineTorque(p, rpm) * p.gearbox.efficiency
      - (1 - thr) * p.engine.engineBrake * Math.min(1, rpm / p.engine.redlineRpm)
      - 0.02 * p.engine.engineBrake;
    drt.ext[PROP] = 0; drt.ext[CF] = 0; drt.ext[CR] = 0;
    const clutchCap = this.shifting > 0 ? 0 : this.clutchMax * smoothstep(p.engine.idleRpm + 100, this.launchRpm, rpm);
    // 浮いた車輪にも転がり抵抗のぶんだけ軸受の摩擦を残す
    for (let k = 0; k < 4; k++) {
      if (!this.wheels[k].contact) this.brakeCap[k] = brake * this.wheels[k].brakeTorque + 2;
    }
    drt.solve(dt, clutchCap, this.brakeCap);
    this.rpm = drt.w[ENGINE] * RPM;

    // 駆動系の角運動量の変化のうち、路面から来たぶん以外は車体が受け持つ（反トルク）
    const engineAxis = p.engine.orientation === 'longitudinal' ? new Vector3().copy(fwd).negate() : new Vector3().copy(right).negate();
    const reaction = new Vector3();
    for (let k = 0; k < 4; k++) {
      const i = WHEELS[k];
      const a = axles[k]; // 前に転がる回転は -axle 向き
      const dl = drt.I[i] * (drt.w[i] - drt.w0[i]) - drt.ext[i] * dt;
      reaction.addScaledVector(a, dl);
      this.wheels[k].spin += drt.w[i] * dt;
    }
    for (const i of [ENGINE, PROP]) reaction.addScaledVector(engineAxis, -drt.I[i] * (drt.w[i] - drt.w0[i]));
    for (const i of [CF, CR]) reaction.addScaledVector(fwd, drt.I[i] * (drt.w[i] - drt.w0[i]));

    // ---------------------------------------------------- 空力
    const spd = linvel.length();
    if (spd > 0.1) {
      const vr = linvel.dot(right), vu = linvel.dot(up);
      const k = -0.5 * RHO * spd;
      const fa = new Vector3()
        .addScaledVector(right, k * this.cdSide * vr)
        .addScaledVector(up, k * this.cdTop * vu)
        .addScaledVector(fwd, k * p.aero.cd * p.aero.frontalArea * vf);
      this.addForce(force, torque, fa, new Vector3().copy(pos).addScaledVector(fwd, p.aero.centerOffset));
      if (vf > 0) {
        const q = 0.5 * RHO * vf * vf * p.aero.frontalArea;
        this.addForce(force, torque, new Vector3().copy(up).multiplyScalar(-q * p.aero.clFront),
          new Vector3().copy(pos).addScaledVector(fwd, -this.geom.frontAxleZ));
        this.addForce(force, torque, new Vector3().copy(up).multiplyScalar(-q * p.aero.clRear),
          new Vector3().copy(pos).addScaledVector(fwd, -this.geom.rearAxleZ));
      }
    }

    this.body.applyImpulse({ x: force.x * dt, y: force.y * dt, z: force.z * dt }, true);
    this.body.applyTorqueImpulse({ x: torque.x * dt + reaction.x, y: torque.y * dt + reaction.y, z: torque.z * dt + reaction.z }, true);
  }

  private addForce(force: Vector3, torque: Vector3, f: Vector3, at: Vector3) {
    force.add(f);
    const r = new Vector3().copy(at).sub(this.pos);
    torque.add(r.cross(f));
  }

  /** 止まりかけでブレーキを踏み続けると後退、アクセルで前進に戻す */
  private selectDirection(dt: number, raw: Controls, vf: number) {
    const slow = Math.abs(vf) < 1.0;
    if (this.gear > 0) {
      this.reverseTimer = slow && raw.brake > 0.5 && raw.throttle < 0.05 && !this.hold ? this.reverseTimer + dt : 0;
      if (this.reverseTimer > 0.35) {
        this.gear = -1;
        this.shifting = 0;
        this.dt.setGearRatio(-this.p.gearbox.reverse);
        this.reverseTimer = 0;
      }
    } else {
      this.forwardTimer = slow && raw.throttle > 0.1 ? this.forwardTimer + dt : 0;
      if (this.forwardTimer > 0.1) {
        this.gear = 1;
        this.shifting = 0;
        this.dt.setGearRatio(this.p.gearbox.ratios[0]);
        this.forwardTimer = 0;
      }
    }
  }

  private autoShift(dt: number, throttle: number, brake: number) {
    const p = this.p;
    const ratios = p.gearbox.ratios;
    this.sinceShift += dt;
    if (this.shifting > 0) {
      this.shifting -= dt;
      if (this.shifting <= 0) {
        this.shifting = 0;
        this.gear = this.nextGear;
        this.dt.setGearRatio(ratios[this.gear - 1]);
        this.sinceShift = 0;
      }
      return;
    }
    if (this.gear < 1 || this.sinceShift < 0.6) return;
    const g = ratios[this.gear - 1];
    const rpmLock = Math.abs(this.dt.w[PROP]) * g * RPM;
    const red = p.engine.redlineRpm, idle = p.engine.idleRpm;
    if (this.gear < ratios.length) {
      const g2 = ratios[this.gear];
      let up = rpmLock > red * 0.97;
      if (!up && throttle > 0.85 && rpmLock > this.peakTorqueRpm) {
        up = engineTorque(p, (rpmLock * g2) / g) * g2 >= engineTorque(p, rpmLock) * g;
      }
      if (!up && throttle <= 0.85) up = rpmLock > lerp(idle + 1600, red * 0.9, throttle);
      if (up) { this.startShift(this.gear + 1); return; }
    }
    if (this.gear > 1) {
      const gl = ratios[this.gear - 2];
      let downAt = lerp(idle + 700, this.peakTorqueRpm, throttle);
      if (brake > 0.3) downAt = Math.max(downAt, red * 0.5);
      if (rpmLock < downAt && (rpmLock * gl) / g < red * 0.9) this.startShift(this.gear - 1);
    }
  }

  private startShift(to: number) {
    this.nextGear = to;
    this.shifting = this.p.gearbox.shiftTime;
  }
}
