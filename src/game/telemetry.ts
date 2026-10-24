// テレメトリ：1 周をコースの上の位置 5 m ごとに区切り、速さ、アクセル、ブレーキ、ハンドル、横 G、ギア、経過時間を記録する。
import type { Vehicle } from '../sim/vehicle';

export const BIN = 5;

export interface LapTrace {
  lapTime: number;
  /** 区切りの数（コースの長さ ÷ 5 m） */
  bins: number;
  speed: Float32Array;
  throttle: Float32Array;
  brake: Float32Array;
  steer: Float32Array;
  latG: Float32Array;
  gear: Int8Array;
  /** その区切りを通った、周の始まりからの時刻 [s] */
  time: Float32Array;
}

export class TraceRecorder {
  private t: LapTrace;

  constructor(private readonly length: number) {
    this.t = this.fresh();
  }

  private fresh(): LapTrace {
    const n = Math.max(1, Math.ceil(this.length / BIN));
    return {
      lapTime: NaN, bins: n,
      speed: new Float32Array(n).fill(NaN), throttle: new Float32Array(n), brake: new Float32Array(n), steer: new Float32Array(n),
      latG: new Float32Array(n), gear: new Int8Array(n), time: new Float32Array(n).fill(NaN),
    };
  }

  start() { this.t = this.fresh(); }

  /** s はコースの上の位置 [m]、lapT は周の始まりからの時刻 */
  push(s: number, lapT: number, v: Vehicle) {
    const i = Math.floor(s / BIN);
    if (i < 0 || i >= this.t.bins || !isNaN(this.t.speed[i])) return;
    this.t.speed[i] = Math.abs(v.speed) * 3.6;
    this.t.throttle[i] = v.throttleOut;
    this.t.brake[i] = v.brakeOut;
    this.t.steer[i] = v.controls.steer;
    this.t.latG[i] = (v.speed * -v.angvel.dot(v.up)) / 9.81;
    this.t.gear[i] = v.gear;
    this.t.time[i] = lapT;
  }

  finish(lapTime: number): LapTrace {
    const t = this.t;
    t.lapTime = lapTime;
    // 取りこぼした区切りは前後から埋める
    for (const a of [t.speed, t.time]) {
      for (let i = 0; i < t.bins; i++) if (isNaN(a[i])) a[i] = i > 0 ? a[i - 1] : 0;
    }
    this.t = this.fresh();
    return t;
  }

  /** いまの区切り s での、比べる周との差 [s]（正なら遅れている） */
  delta(s: number, lapT: number, ref: LapTrace | null) {
    if (!ref) return NaN;
    const i = Math.floor(s / BIN);
    if (i < 0 || i >= ref.bins || isNaN(ref.time[i])) return NaN;
    return lapT - ref.time[i];
  }
}

/** 2 つの周を重ねて描く（速さ、アクセルとブレーキ、差） */
export function drawTraces(cv: HTMLCanvasElement, best: LapTrace | null, last: LapTrace | null) {
  const g = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W, H);
  const ref = best ?? last;
  if (!ref) return;
  const n = ref.bins;
  const padL = 46, padR = 10;
  const x = (i: number) => padL + ((W - padL - padR) * i) / Math.max(1, n - 1);
  const band = (y0: number, h: number, label: string) => {
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(padL, y0, W - padL - padR, h);
    g.fillStyle = '#9aa4b2'; g.font = '12px sans-serif'; g.fillText(label, 4, y0 + 14);
  };
  // 速さ
  const hs = H * 0.5, ys = 8;
  band(ys, hs, 'km/h');
  let vmax = 50;
  for (const t of [best, last]) if (t) for (let i = 0; i < t.bins; i++) vmax = Math.max(vmax, t.speed[i]);
  vmax = Math.ceil(vmax / 50) * 50;
  const line = (t: LapTrace, f: (i: number) => number, y0: number, h: number, color: string, max: number, min = 0) => {
    g.strokeStyle = color; g.lineWidth = 1.6; g.beginPath();
    for (let i = 0; i < t.bins; i++) {
      const y = y0 + h - ((f(i) - min) / (max - min)) * h;
      if (i === 0) g.moveTo(x(i), y); else g.lineTo(x(i), y);
    }
    g.stroke();
  };
  if (best) line(best, (i) => best.speed[i], ys, hs, '#5ab0ff', vmax);
  if (last && last !== best) line(last, (i) => last.speed[i], ys, hs, '#ffb000', vmax);
  g.fillStyle = '#9aa4b2'; g.fillText(String(vmax), 4, ys + 28);
  // アクセルとブレーキ（いちばん新しい周）
  const yt = ys + hs + 8, ht = H * 0.18;
  band(yt, ht, '踏み');
  const t = last ?? best!;
  line(t, (i) => t.throttle[i], yt, ht, '#3fd06a', 1);
  line(t, (i) => t.brake[i], yt, ht, '#ff5a5a', 1);
  // 差（いちばん新しい周 − 最速の周）
  const yd = yt + ht + 8, hd = H - yd - 8;
  band(yd, hd, '差 s');
  if (best && last && last !== best) {
    let dmax = 0.5;
    const d = (i: number) => last.time[i] - best.time[i];
    for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.abs(d(i)));
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.moveTo(padL, yd + hd / 2); g.lineTo(W - padR, yd + hd / 2); g.stroke();
    line(last, d, yd, hd, '#e8ecf2', dmax, -dmax);
    g.fillStyle = '#9aa4b2'; g.fillText(`±${dmax.toFixed(1)}`, 4, yd + 28);
  }
}
