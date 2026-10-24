// AI の運転手。プレイヤーと同じ車を、同じ入力（ハンドル、アクセル、ブレーキ）で動かす。
// 曲率と路面の摩擦から速さの上限を出し、手前から減速が間に合うように均した目標速度に合わせる。
import type { CourseData } from './course';
import { G, estimateTopSpeed } from './params';
import { SURFACES } from './surfaces';
import type { Controls, Vehicle } from './vehicle';

export class AiDriver {
  readonly target: Float32Array;
  idx = 0;
  /** 好みの横位置 [m]（左が正） */
  lane: number;
  private avoid = 0;
  stuckTime = 0;

  constructor(readonly course: CourseData, readonly vehicle: Vehicle, readonly skill: number, lane: number) {
    this.lane = lane;
    const path = course.path, n = path.length;
    const ds = course.length / n;
    const p = vehicle.p;
    const top = estimateTopSpeed(p) * 0.98;
    const v = new Float32Array(n);
    const span = Math.round(6 / ds);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = -span; j <= span; j++) k = Math.max(k, Math.abs(path[(i + j + n) % n].k));
      // 横の摩擦は 85% まで（ブレーキとアクセルに残す）
      const mu = p.tire.mu * SURFACES[path[i].surface].mu * skill * 0.85;
      // ダウンフォースのぶんだけ速く曲がれる（速さに依る式を 1 回だけ回して近似）
      let vmax = Math.sqrt((mu * G) / Math.max(k, 1e-5));
      const df = (0.5 * 1.225 * p.aero.frontalArea * (p.aero.clFront + p.aero.clRear)) / p.body.mass;
      if (df > 0 && k > 1e-5) vmax = Math.sqrt((mu * G) / Math.max(k - mu * df, k * 0.3));
      v[i] = Math.min(top, vmax);
    }
    // 後ろ向きに、減速が間に合う速さへ均す（周回なので 2 周回す）
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = v[(i + 1) % n];
        const a = p.tire.mu * SURFACES[path[i].surface].mu * G * skill * 0.7;
        v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * a * ds));
      }
    }
    this.target = v;
  }

  /** 経路上のいちばん近い点を、前の位置の近くで探す */
  track(): number {
    const path = this.course.path, n = path.length;
    const { x, z } = this.vehicle.pos;
    let best = Infinity, bi = this.idx;
    for (let j = -30; j <= 60; j++) {
      const i = (this.idx + j + n) % n;
      const d = (path[i].x - x) ** 2 + (path[i].z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    this.idx = bi;
    return Math.sqrt(best);
  }

  update(dt: number, others: Vehicle[]): Controls {
    const car = this.vehicle, path = this.course.path, n = path.length;
    const ds = this.course.length / n;
    this.track();
    const v = Math.max(0, car.speed);

    // 前の車をよける
    let want = this.lane;
    for (const o of others) {
      if (o === car) continue;
      const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
      const ahead = dx * car.fwd.x + dz * car.fwd.z;
      const side = dx * car.right.x + dz * car.right.z;
      if (ahead > 0 && ahead < 14 + v * 0.4 && Math.abs(side) < 2.4) {
        want = side > 0 ? this.lane + 2.8 : this.lane - 2.8;
      }
    }
    const half = this.course.width / 2 - 1.3;
    want = Math.max(-half, Math.min(half, want));
    this.avoid += (want - this.avoid) * Math.min(1, dt * 1.5);

    // ハンドル：先の点を追う
    const look = Math.max(7, Math.min(32, 5 + v * 0.5));
    const tp = path[(this.idx + Math.round(look / ds)) % n];
    const px = tp.x + tp.lx * this.avoid - car.pos.x, pz = tp.z + tp.lz * this.avoid - car.pos.z;
    const lx = px * car.right.x + pz * car.right.z;
    const lz = px * car.fwd.x + pz * car.fwd.z;
    const alpha = Math.atan2(lx, Math.max(0.1, lz));
    const L = Math.hypot(lx, lz);
    // 先の点を通る円の曲率（右が正）から目標のヨーレートを出し、今のヨーレートとの差で切り足す。
    // 後ろが滑って回りすぎれば切り戻し（当て舵）、曲がり足りなければ切り増す
    const curv = (2 * Math.sin(alpha)) / Math.max(L, 1);
    const rDes = v * curv;
    const rNow = -car.angvel.dot(car.up);
    const delta = Math.atan(car.p.wheelbase * curv) + 0.25 * (rDes - rNow);
    let steer = Math.max(-1, Math.min(1, delta / Math.max(car.steerLimit, 0.02)));
    const vfw = car.linvel.dot(car.fwd), vri = car.linvel.dot(car.right);
    const beta = v > 3 ? Math.atan2(vri, Math.max(1, Math.abs(vfw))) : 0;

    // アクセルとブレーキ：少し先までの目標速度のいちばん低い値に合わせる
    let vt = Infinity;
    const reach = Math.max(4, v * 0.35);
    for (let s = 0; s <= reach; s += ds) vt = Math.min(vt, this.target[(this.idx + Math.round(s / ds)) % n]);
    const err = vt - v;
    let throttle = 0, brake = 0;
    if (err > 0) throttle = Math.min(1, 0.35 + err * 0.3);
    else if (err < -1.2) brake = Math.min(1, -err * 0.18);
    else throttle = 0.15;
    if (Math.abs(beta) > 0.15) { throttle = Math.min(throttle, 0.2); brake = Math.min(brake, 0.2); }
    if (car.airborne) { throttle = 0.4; steer = 0; brake = 0; }
    if (car.gear < 0) { throttle = 1; brake = 0; } // 後退から前進に戻す
    return { steer, throttle, brake };
  }
}
