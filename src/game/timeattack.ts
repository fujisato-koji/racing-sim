// タイムアタック：1 台だけで周回し、周ごとにゴーストとテレメトリを記録する。
// 最速の周（コースに戻さずに走りきった周だけ）をブラウザに残し、次からはゴーストとして並べて走り、差を出す。
import type { CarParams } from '../sim/params';
import type { Race, Racer } from '../sim/race';
import type { GhostLap } from './ghost';
import { GhostRecorder, loadBestGhost, saveBestGhost } from './ghost';
import type { LapTrace } from './telemetry';
import { TraceRecorder } from './telemetry';

const traceKey = (course: string, car: string) => `racing-sim.trace.v1.${course}.${car}`;

function saveTrace(course: string, car: string, t: LapTrace) {
  try {
    const o = { ...t, speed: [...t.speed], throttle: [...t.throttle], brake: [...t.brake], steer: [...t.steer], latG: [...t.latG], gear: [...t.gear], time: [...t.time] };
    localStorage.setItem(traceKey(course, car), JSON.stringify(o, (_k, v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
  } catch { /* 保存できなくても走れる */ }
}

function loadTrace(course: string, car: string): LapTrace | null {
  try {
    const s = localStorage.getItem(traceKey(course, car));
    if (!s) return null;
    const o = JSON.parse(s) as Record<string, number[]> & { lapTime: number; bins: number };
    return {
      lapTime: o.lapTime, bins: o.bins,
      speed: Float32Array.from(o.speed), throttle: Float32Array.from(o.throttle), brake: Float32Array.from(o.brake), steer: Float32Array.from(o.steer),
      latG: Float32Array.from(o.latG), gear: Int8Array.from(o.gear), time: Float32Array.from(o.time),
    };
  } catch {
    return null;
  }
}

export interface LapResult { time: number; valid: boolean; best: boolean }

export class TimeAttack {
  private readonly ghostRec = new GhostRecorder();
  private readonly traceRec: TraceRecorder;
  /** 残っている最速の周（ゴーストとして並べて走る） */
  best: GhostLap | null;
  bestTrace: LapTrace | null;
  /** いちばん新しく走りきった周 */
  lastTrace: LapTrace | null = null;
  /** この周の途中でコースに戻した（記録にしない） */
  invalid = false;
  /** 最速の周との差 [s]（正なら遅れている） */
  delta = NaN;
  laps: LapResult[] = [];
  private seenLaps = 0;

  constructor(private readonly race: Race, private readonly racer: Racer, readonly courseId: string, readonly carKey: string, private readonly carName: string) {
    this.traceRec = new TraceRecorder(race.course.length);
    this.best = loadBestGhost(courseId, carKey);
    this.bestTrace = this.best ? loadTrace(courseId, carKey) : null;
    if (this.bestTrace && this.bestTrace.bins !== Math.max(1, Math.ceil(race.course.length / 5))) this.bestTrace = null;
  }

  /** 周の始まりからの時刻 */
  get lapTime() { return this.race.time - this.racer.lapStart; }

  /** 物理の 1 ステップごとに、周回を数えたあとで呼ぶ */
  step() {
    const race = this.race, r = this.racer;
    if (race.state !== 'running') return;
    if (r.laps !== this.seenLaps) {
      this.seenLaps = r.laps;
      this.finishLap(r.lastLap);
    }
    const t = this.lapTime;
    const n = race.course.path.length;
    const s = (r.idx / n) * race.course.length;
    this.ghostRec.push(t, r.vehicle);
    // 最初の周はスタートラインの手前から走り出すので、線を越えるまでは数えない
    if (r.laps === 0 && r.checkpoints === 0 && r.idx > n * 0.5) return;
    this.traceRec.push(s, t, r.vehicle);
    this.delta = this.traceRec.delta(s, t, this.bestTrace);
  }

  /** コースに戻したら、その周は記録にしない */
  markInvalid() { this.invalid = true; }

  private finishLap(time: number) {
    const trace = this.traceRec.finish(time);
    this.lastTrace = trace;
    const valid = !this.invalid;
    const isBest = valid && (!this.best || time < this.best.time);
    if (isBest) {
      this.best = this.ghostRec.finish({ course: this.courseId, car: this.carKey, carName: this.carName, color: this.racer.color, time });
      this.bestTrace = trace;
      saveBestGhost(this.best);
      saveTrace(this.courseId, this.carKey, trace);
    }
    this.laps.push({ time, valid, best: isBest });
    this.invalid = false;
    this.ghostRec.start();
    this.traceRec.start();
  }
}

/**
 * 車の識別：id と、走りに効く設定の要約。設定を変えた車は別の記録になる（色と名前は含めない）
 */
export function carKeyOf(p: CarParams) {
  const { color: _c, name: _n, ...rest } = p;
  const s = JSON.stringify(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `${p.id}.${(h >>> 0).toString(36)}`;
}
