// ハンドルの補助（曲がり具合で操る）。入力 −1〜1 を「どれだけ回るか（ヨーレート）」の求めとして受け、
// それを出すハンドルの角度を車の状態から決める。キーやスマホの傾きで切れ角を直接動かすと、
// 切ってから車が向きを変えるまでの遅れに人が合わせきれず、切りすぎと戻しすぎで揺れが大きくなる（キーボードのジグザグ）。
// 求めを曲がり具合にすると、離したときは「まっすぐ」を求めることになり、車の回りを自分で止める（後ろが流れたときの逆ハンドルも）。
import type { CourseData } from '../sim/course';
import type { Vehicle } from '../sim/vehicle';

const DEG = Math.PI / 180;

/** 道に沿う補助に渡す、道の様子（プレイヤーの近くの経路から） */
export interface RoadInfo {
  /** 先の曲率 [1/m]（左が正） */
  k: number;
  /** 道の向き（水平の単位ベクトル） */
  tx: number;
  tz: number;
  /** 道の中心からの横の位置 [m]（左が正）と、道の幅の半分 */
  lat: number;
  half: number;
}

export class YawSteer {
  /** 前のハンドル（急に動かしすぎないため） */
  private out = 0;

  /**
   * u は −1〜1（右が正）。戻り値は vehicle.controls.steer に入れる値（−1〜1）。
   * road があれば道に沿う：道の曲がりに合わせて回り、入力が小さいときは車の向きを道の向きにそろえ、縁に近づいたら押し戻す。
   * 入力は道の上での位置と向きを変える（入力が大きいほど補助は退く）
   * 遅いとき（3 m/s 未満）は、そのまま切れ角にする（車庫入れのような動き）
   */
  update(dt: number, u: number, v: Vehicle, road: RoadInfo | null = null): number {
    const p = v.p;
    const vx = v.linvel.dot(v.fwd);
    const lim = Math.max(1e-3, v.steerLimit);
    if (Math.abs(vx) < 3) { this.out = u; return u; }
    const speed = Math.abs(vx);
    const L = p.wheelbase;
    const maxSteer = p.steer.maxAngleDeg * DEG;
    // 出せるヨーレート：タイヤの摩擦の 9 割で曲がれる分と、いっぱいに切ったときの分の小さい方
    const rMax = Math.min((0.9 * p.tire.mu * 9.81) / speed, (speed * Math.tan(maxSteer)) / L);
    // 右が正（車の上の向きの回りの反対）
    let rDes = u * rMax;
    if (road) {
      const free = 1 - Math.min(1, Math.abs(u));
      // 道の曲がりの分（曲率は左が正、ヨーレートは右が正）
      rDes -= road.k * speed;
      // 向きのずれ（右へ向ければよいとき正）を 0.7 秒で戻す
      const fx = v.fwd.x, fz = v.fwd.z, rx = v.right.x, rz = v.right.z;
      const psi = Math.atan2(road.tx * rx + road.tz * rz, road.tx * fx + road.tz * fz);
      rDes += free * Math.max(-0.5 * rMax, Math.min(0.5 * rMax, psi / 0.7));
      // 縁から 1.5 m より外へ出かけたら押し戻す（左にずれていれば右へ）
      const over = Math.abs(road.lat) - (road.half - 1.5);
      if (over > 0) rDes += free * Math.sign(road.lat) * Math.min(1, over / 1.5) * 0.35 * rMax;
    }
    rDes = Math.max(-rMax, Math.min(rMax, rDes));
    const rNow = -v.angvel.dot(v.up);
    // 前もって：その曲がり具合を幾何学的に出す切れ角。後から：求めとの差で足し引き（回りすぎなら戻し、足りなければ足す）
    const ff = Math.atan((L * rDes) / speed);
    const fb = 0.22 * (rDes - rNow);
    let delta = (ff + fb) * Math.sign(vx);
    delta = Math.max(-maxSteer, Math.min(maxSteer, delta));
    // 1 秒で 3 倍の切れ角の幅までしか動かさない（ステアリングを回す速さの限り）
    const want = Math.max(-1, Math.min(1, delta / lim));
    const rate = 3 * dt;
    this.out += Math.max(-rate, Math.min(rate, want - this.out));
    return this.out;
  }

  reset() { this.out = 0; }
}

/** プレイヤーの近く（経路の点 idx）の道の様子。曲率は 0.4 秒先の前後 15 m でならす */
export function roadInfo(c: CourseData, idx: number, v: Vehicle): RoadInfo | null {
  const path = c.path, n = path.length;
  if (n === 0) return null;
  const ds = c.length / n;
  const ahead = Math.round((Math.abs(v.speed) * 0.4) / ds), w = Math.max(1, Math.round(15 / ds));
  let k = 0;
  for (let j = -w; j <= w; j++) k += path[(idx + ahead + j + n) % n].k;
  const p = path[idx];
  return { k: k / (2 * w + 1), tx: p.tx, tz: p.tz, lat: (v.pos.x - p.x) * p.lx + (v.pos.z - p.z) * p.lz, half: c.width / 2 };
}
