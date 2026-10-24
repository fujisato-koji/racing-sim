// スマホの傾きからハンドルの入力を出す（画面に依らないので Node で試せる）。
// 1. One Euro フィルター：ゆっくりした動きでは揺れを強く均し、速い動きでは遅らせない
// 2. 中央付近ほど効きを弱くする曲線。速いほど強く弱める（実車の中立付近の手応えに近づける）
// 3. ごく小さな遊び

/** 1 次の低域通過 */
class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number) {
    this.y = this.y === null ? x : this.y + alpha * (x - this.y);
    return this.y;
  }
  get value() { return this.y; }
  reset() { this.y = null; }
}

export class OneEuro {
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  private last: number | null = null;

  /**
   * @param minCutoff 止まっているときの遮断周波数 [Hz]（小さいほど揺れが減る）
   * @param beta 動く速さ [単位/s] に応じて遮断周波数を上げる割合（大きいほど速い動きに遅れない）
   */
  constructor(private readonly minCutoff = 1.2, private readonly beta = 0.06, private readonly dCutoff = 1.5) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, t: number) {
    const prev = this.x.value;
    const dt = this.last === null ? 1 / 60 : Math.max(1e-3, t - this.last);
    this.last = t;
    const d = prev === null ? 0 : (value - prev) / dt;
    const ed = this.dx.filter(d, OneEuro.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(value, OneEuro.alpha(cutoff, dt));
  }

  reset() { this.x.reset(); this.dx.reset(); this.last = null; }
}

export interface TiltOptions {
  /** いっぱいに切ったことになる傾き [度] */
  range: number;
  /** 中央付近の効きを弱める度合い 0（まっすぐ）〜 1（速さに合わせた標準） */
  centerSoft: number;
  /** 遊び [度] */
  dead: number;
  /** 揺れを均すか（比べるときに切る） */
  smooth: boolean;
}

export const DEFAULT_TILT: TiltOptions = { range: 40, centerSoft: 1, dead: 0.8, smooth: true };

/**
 * 速さ [km/h] に応じた中央付近の効きの弱さ（曲線の 3 次の項の割合）。
 * 速いほど少しの切れ角で大きく曲がるので、中央をより鈍くする。
 * 人が 0.25 s 遅れて修正する模擬で、60〜140 km/h の横揺れが 0.1 g 未満になる値（test/tilt-wobble.ts）
 */
export function centerExpo(kmh: number) {
  return Math.max(0.78, Math.min(0.92, 0.78 + (kmh - 60) * 0.0018));
}

/** 傾き [度]（中央からの差、右が正）からハンドルの入力 -1〜1 を出す */
export class TiltSteering {
  private readonly euro = new OneEuro();
  private angle = 0;

  constructor(public opt: TiltOptions = { ...DEFAULT_TILT }) {}

  /** センサーの値が届くたびに呼ぶ。t は秒 */
  push(angleDeg: number, t: number) {
    this.angle = this.opt.smooth ? this.euro.filter(angleDeg, t) : angleDeg;
  }

  /** 今の速さ [km/h] でのハンドルの入力 */
  steer(kmh: number) {
    const a = this.angle;
    const { range, centerSoft, dead } = this.opt;
    const x = Math.min(1, Math.max(0, Math.abs(a) - dead) / Math.max(1, range - dead));
    const e = Math.min(0.95, centerExpo(Math.abs(kmh)) * centerSoft);
    return Math.sign(a) * ((1 - e) * x + e * x * x * x);
  }

  reset() { this.euro.reset(); this.angle = 0; }
}
