// 駆動系。エンジン、変速機の出力軸、デフ、車輪を回転体として持ち、
// ギアとデフは速度の拘束、クラッチ、LSD、ブレーキ、転がり抵抗は上限付きの拘束として、
// 逐次インパルス法で解く。上限付きの拘束は、上限を超えると滑る摩擦の要素になる。
import type { CarParams, DiffParams } from './params';
import { drivenAxles } from './params';

export const ENGINE = 0, PROP = 1, FL = 2, FR = 3, RL = 4, RR = 5, CF = 6, CR = 7;
export const WHEELS = [FL, FR, RL, RR] as const;

interface Constraint {
  idx: number[];
  j: number[];
  /** 1 ステップあたりのインパルスの上限 */
  cap: number;
  lambda: number;
  meff: number;
}

interface Lsd {
  c: Constraint;
  diff: Constraint;
  params: DiffParams;
  /** 入力軸のトルクを車輪側に直す倍率 */
  ratio: number;
}

const ITERATIONS = 20;

export class Drivetrain {
  readonly I: number[];
  readonly inv: number[];
  readonly w: number[];
  readonly ext: number[];
  readonly clutch: Constraint;
  readonly brakes: Constraint[];
  private readonly constraints: Constraint[] = [];
  private readonly lsds: Lsd[] = [];
  private readonly diffs: Constraint[] = [];
  /** 解く前の角速度（車体への反トルクの計算に使う） */
  readonly w0: number[];

  constructor(p: CarParams, wheelInertia: number[]) {
    const n = 8;
    this.I = new Array(n).fill(0.03);
    this.I[ENGINE] = p.engine.inertia;
    this.I[PROP] = 0.05;
    for (let k = 0; k < 4; k++) this.I[WHEELS[k]] = wheelInertia[k];
    this.inv = this.I.map((v) => 1 / v);
    this.w = new Array(n).fill(0);
    this.w0 = new Array(n).fill(0);
    this.ext = new Array(n).fill(0);

    this.clutch = this.make([ENGINE, PROP], [1, -p.gearbox.ratios[0]]);
    this.constraints.push(this.clutch);

    const fd = p.gearbox.finalDrive;
    const driven = drivenAxles(p.drive.layout);
    const addAxle = (input: number, left: number, right: number, dp: DiffParams) => {
      const diff = this.make([input, left, right], [1, -fd / 2, -fd / 2]);
      this.constraints.push(diff);
      this.diffs.push(diff);
      this.addLsd(left, right, diff, dp, fd);
    };
    if (driven.front && driven.rear) {
      const a = p.drive.frontShare;
      const center = this.make([PROP, CF, CR], [1, -a, -(1 - a)]);
      this.constraints.push(center);
      this.diffs.push(center);
      this.addLsd(CF, CR, center, p.drive.centerDiff, 1);
      addAxle(CF, FL, FR, p.drive.frontDiff);
      addAxle(CR, RL, RR, p.drive.rearDiff);
    } else if (driven.front) {
      addAxle(PROP, FL, FR, p.drive.frontDiff);
    } else {
      addAxle(PROP, RL, RR, p.drive.rearDiff);
    }
    this.brakes = WHEELS.map((i) => this.make([i], [1]));
    this.constraints.push(...this.brakes);
  }

  private make(idx: number[], j: number[]): Constraint {
    const c: Constraint = { idx, j, cap: Infinity, lambda: 0, meff: 0 };
    this.updateMass(c);
    return c;
  }

  private updateMass(c: Constraint) {
    let k = 0;
    for (let n = 0; n < c.idx.length; n++) k += c.j[n] * c.j[n] * this.inv[c.idx[n]];
    c.meff = 1 / k;
  }

  private addLsd(left: number, right: number, diff: Constraint, dp: DiffParams, ratio: number) {
    if (dp.type === 'open') return;
    const c = this.make([left, right], [1, -1]);
    this.constraints.push(c);
    this.lsds.push({ c, diff, params: dp, ratio });
  }

  /** 変速機の比（後退は負）を変える */
  setGearRatio(ratio: number) {
    this.clutch.j[1] = -ratio;
    this.updateMass(this.clutch);
    this.clutch.lambda = 0;
  }

  /** クラッチを通るトルク [N·m]（直前のステップ） */
  clutchTorque(dt: number) { return this.clutch.lambda / dt; }

  /**
   * 外からのトルク（ext）を積分してから拘束を解く。
   * @param clutchCap クラッチが伝えられる最大トルク [N·m]
   * @param brakeCap 各輪のブレーキと転がり抵抗の最大トルク [N·m]
   */
  solve(dt: number, clutchCap: number, brakeCap: number[]) {
    const { w, inv, ext } = this;
    for (let i = 0; i < w.length; i++) {
      this.w0[i] = w[i];
      w[i] += ext[i] * inv[i] * dt;
    }
    this.clutch.cap = clutchCap * dt;
    for (let k = 0; k < 4; k++) this.brakes[k].cap = brakeCap[k] * dt;
    for (const l of this.lsds) {
      if (l.params.type === 'locked') { l.c.cap = Infinity; continue; }
      const tin = Math.abs(l.diff.lambda) / dt;
      l.c.cap = (l.params.preload + l.params.lock * l.ratio * tin) * dt;
    }
    // 前のステップのインパルスから始める（収束が速くなる）
    for (const c of this.constraints) {
      c.lambda = Math.max(-c.cap, Math.min(c.cap, c.lambda));
      this.apply(c, c.lambda);
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (const c of this.constraints) {
        let jw = 0;
        for (let n = 0; n < c.idx.length; n++) jw += c.j[n] * w[c.idx[n]];
        let next = c.lambda - jw * c.meff;
        if (next > c.cap) next = c.cap; else if (next < -c.cap) next = -c.cap;
        const d = next - c.lambda;
        if (d !== 0) { c.lambda = next; this.apply(c, d); }
      }
    }
    if (w[ENGINE] < 0) w[ENGINE] = 0;
  }

  private apply(c: Constraint, impulse: number) {
    for (let n = 0; n < c.idx.length; n++) this.w[c.idx[n]] += this.inv[c.idx[n]] * c.j[n] * impulse;
  }

  reset() {
    this.w.fill(0);
    this.w0.fill(0);
    for (const c of this.constraints) c.lambda = 0;
  }
}
