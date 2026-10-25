// ハンドルの補助（曲がり具合で操る）。入力 −1〜1 を「どれだけ回るか（ヨーレート）」の求めとして受け、
// それを出すハンドルの角度を車の状態から決める。キーやスマホの傾きで切れ角を直接動かすと、
// 切ってから車が向きを変えるまでの遅れに人が合わせきれず、切りすぎと戻しすぎで揺れが大きくなる（キーボードのジグザグ）。
// 求めを曲がり具合にすると、離したときは「まっすぐ」を求めることになり、車の回りを自分で止める（後ろが流れたときの逆ハンドルも）。
import type { Vehicle } from '../sim/vehicle';

const DEG = Math.PI / 180;

export class YawSteer {
  /** 前のハンドル（急に動かしすぎないため） */
  private out = 0;

  /**
   * u は −1〜1（右が正）。戻り値は vehicle.controls.steer に入れる値（−1〜1）。
   * 遅いとき（3 m/s 未満）は、そのまま切れ角にする（車庫入れのような動き）
   */
  update(dt: number, u: number, v: Vehicle): number {
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
    const rDes = u * rMax;
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
