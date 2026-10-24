// 周回、順位、タイム。経路の上の位置で進み具合を数え、途中の3か所を通らないと周回にしない。
import type { CourseData } from './course';
import type { AiDriver } from './ai';
import type { Vehicle } from './vehicle';

export interface Racer {
  name: string;
  color: string;
  vehicle: Vehicle;
  isPlayer: boolean;
  ai: AiDriver | null;
  idx: number;
  /** 終えた周回の数 */
  laps: number;
  checkpoints: number;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  finished: boolean;
  finishTime: number;
  offTrack: number;
  upsideDown: number;
  /** アクセルかブレーキを踏んでいるのに動けない時間 [s] */
  stuck: number;
}

export type RaceState = 'countdown' | 'running' | 'finished';

const COUNTDOWN = 3.5;

export class Race {
  state: RaceState = 'countdown';
  /** スタートからの時間（負のあいだはカウントダウン） */
  time = -COUNTDOWN;
  finishOrder: Racer[] = [];

  constructor(readonly course: CourseData, readonly racers: Racer[], readonly laps: number) {
    for (const r of racers) {
      r.vehicle.hold = true;
      r.idx = this.nearest(r, true);
    }
  }

  get free() { return this.laps === 0 || this.course.path.length === 0; }

  private nearest(r: Racer, global = false): number {
    const path = this.course.path, n = path.length;
    if (n === 0) return 0;
    const { x, z } = r.vehicle.pos;
    let best = Infinity, bi = r.idx;
    const lo = global ? 0 : -40, hi = global ? n - 1 : 80;
    for (let j = lo; j <= hi; j++) {
      const i = global ? j : (r.idx + j + n) % n;
      const d = (path[i].x - x) ** 2 + (path[i].z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  }

  /** 物理の 1 ステップごとに呼ぶ */
  update(dt: number) {
    this.time += dt;
    if (this.state === 'countdown' && this.time >= 0) {
      this.state = 'running';
      for (const r of this.racers) { r.vehicle.hold = false; r.lapStart = 0; }
    }
    if (this.free) return;
    const n = this.course.path.length;
    for (const r of this.racers) {
      const prev = r.idx;
      r.idx = this.nearest(r);
      for (let c = 0; c < 3; c++) {
        const at = Math.floor(((c + 1) / 4) * n);
        if (r.idx >= at && r.idx < at + 40) r.checkpoints |= 1 << c;
      }
      // スタートラインをまたいだ
      if (prev > n * 0.9 && r.idx < n * 0.1) {
        if (r.checkpoints === 7 && this.state !== 'countdown') {
          r.laps++;
          r.checkpoints = 0;
          const lap = this.time - r.lapStart;
          r.lastLap = lap;
          r.bestLap = Math.min(r.bestLap, lap);
          r.lapStart = this.time;
          if (r.laps >= this.laps && !r.finished) {
            r.finished = true;
            r.finishTime = this.time;
            this.finishOrder.push(r);
            if (r.isPlayer) this.state = 'finished';
          }
        }
      }
    }
  }

  /** 進み具合（周回 × 経路の長さ + 位置）。スタート前の位置は負にする */
  progress(r: Racer): number {
    const n = this.course.path.length;
    if (n === 0) return 0;
    let idx = r.idx;
    if (r.laps === 0 && r.checkpoints === 0 && idx > n * 0.5) idx -= n;
    return r.laps * n + idx;
  }

  standings(): Racer[] {
    const done = this.finishOrder;
    const rest = this.racers.filter((r) => !r.finished).sort((a, b) => this.progress(b) - this.progress(a));
    return [...done, ...rest];
  }
}

export function makeRacer(name: string, color: string, vehicle: Vehicle, isPlayer: boolean, ai: AiDriver | null): Racer {
  return { name, color, vehicle, isPlayer, ai, idx: 0, laps: 0, checkpoints: 0, lapStart: 0, lastLap: NaN, bestLap: Infinity, finished: false, finishTime: NaN, offTrack: 0, upsideDown: 0, stuck: 0 };
}
