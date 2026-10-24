// 副操縦士（コ・ドライバー）の声：この先の曲がりを、ラリーのペースノートのように知らせる（"Left three, 150"）。
// 曲がりはコースの経路の曲率から先に見つけておき、向き、きつさ（1 がいちばんきつく 6 はほぼ全開）、ヘアピン、長い曲がりを決める。
// 読み上げには依らない（言うことを決めて say に渡すだけ）。
import type { CourseData } from '../sim/course';
import type { Session } from './session';
import type { Say } from './commentary';

export interface Corner {
  /** 経路の点の番号（入口、いちばんきつい所、出口） */
  start: number;
  apex: number;
  end: number;
  dir: 'left' | 'right';
  /** 1（いちばんきつい）〜 6（ほぼ全開） */
  grade: number;
  hairpin: boolean;
  long: boolean;
  /** 曲がる角度 [度] と、いちばんきつい所の半径 [m] */
  angle: number;
  minR: number;
}

const GRADE_WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

/** 半径からきつさを決める（ラリーのペースノートの 1〜6 に合わせた目安） */
function gradeOf(r: number) {
  return r < 30 ? 1 : r < 55 ? 2 : r < 90 ? 3 : r < 140 ? 4 : r < 220 ? 5 : 6;
}

/** コースの曲がりを見つける。曲率を前後 10 m でならし、半径 300 m より小さい所を曲がりとする */
export function findCorners(c: CourseData): Corner[] {
  const p = c.path, n = p.length;
  if (n === 0) return [];
  const ds = c.length / n;
  const w = Math.max(1, Math.round(10 / ds));
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -w; j <= w; j++) s += p[(i + j + n) % n].k;
    k[i] = s / (2 * w + 1);
  }
  const TH = 1 / 300;
  // 曲がりの外から数え始める（周回の始まりが曲がりの途中でも切れないように）
  let i0 = 0;
  while (i0 < n && Math.abs(k[i0]) > TH) i0++;
  if (i0 >= n) return [];
  const segs: { a: number; b: number; sign: number }[] = [];
  for (let m = 0; m < n; m++) {
    const i = (i0 + m) % n;
    const sg = Math.abs(k[i]) > TH ? Math.sign(k[i]) : 0;
    const last = segs[segs.length - 1];
    if (sg === 0) continue;
    if (last && last.sign === sg && ((i - last.b + n) % n) * ds < 25) last.b = i;
    else segs.push({ a: i, b: i, sign: sg });
  }
  const out: Corner[] = [];
  for (const sgm of segs) {
    const len = ((sgm.b - sgm.a + n) % n) + 1;
    let ang = 0, kmax = 0, apex = sgm.a;
    for (let m = 0; m < len; m++) {
      const i = (sgm.a + m) % n;
      ang += Math.abs(k[i]) * ds;
      if (Math.abs(k[i]) > kmax) { kmax = Math.abs(k[i]); apex = i; }
    }
    const angle = (ang * 180) / Math.PI;
    if (angle < 12) continue;
    const minR = 1 / kmax;
    // 経路の曲率は左に曲がると正
    out.push({
      start: sgm.a, apex, end: sgm.b, dir: sgm.sign > 0 ? 'left' : 'right',
      grade: gradeOf(minR), hairpin: angle > 120 && minR < 25, long: angle > 100 && len * ds > 80,
      angle, minR,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 曲がりの呼び方："Left three, long"、"Hairpin right" */
export function cornerName(c: Corner) {
  const D = c.dir === 'left' ? 'Left' : 'Right';
  if (c.hairpin) return `Hairpin ${c.dir}`;
  return `${D} ${GRADE_WORD[c.grade]}${c.long ? ', long' : ''}`;
}

/** 距離の言い方：100 m 以上は 50 m 刻み、それより近ければ 10 m 刻み */
export function spokenDistance(d: number) {
  return d >= 100 ? Math.round(d / 50) * 50 : Math.max(30, Math.round(d / 10) * 10);
}

export class CoDriver {
  readonly corners: Corner[];
  private readonly ds: number;
  /** 曲がりごとに、最後に知らせた周 */
  private readonly called = new Map<number, number>();
  private readonly braked = new Map<number, number>();
  private readonly oval: boolean;

  constructor(private readonly s: Session, private readonly say: Say) {
    this.corners = findCorners(s.course);
    this.ds = s.course.length / Math.max(1, s.course.path.length);
    this.oval = s.course.def.track?.auto === 'oval';
  }

  /** 曲がりの手前で、無理なく曲がれる速さ [m/s]（摩擦だけで見積もる。ダウンフォースを見ないので控えめ） */
  private cornerSpeed(c: Corner) {
    const mu = this.s.player!.vehicle.p.tire.mu;
    return Math.sqrt(0.85 * mu * 9.81 * c.minR);
  }

  /** 毎フレーム呼ぶ（一時停止中は呼ばない） */
  update() {
    const s = this.s, me = s.player;
    if (!me || s.race.state !== 'running' || me.finished || this.corners.length === 0) return;
    const v = me.vehicle;
    const speed = v.linvel.dot(v.fwd);
    if (speed < 8) return;
    const n = s.course.path.length;
    const lap = me.laps;
    // この先 400 m までの曲がり
    for (let ci = 0; ci < this.corners.length; ci++) {
      const c = this.corners[ci];
      const d = ((c.start - me.idx + n) % n) * this.ds;
      if (d > 400) continue;
      const key = lap * 10000 + ci;
      const vc = this.cornerSpeed(c);
      const fast = speed > vc * 1.04;
      // 知らせる距離：約 3 秒先（近すぎず遠すぎず）
      const callAt = Math.max(60, Math.min(300, speed * 3.2 + 30));
      if (d <= callAt && d > 25 && !this.called.has(key)) {
        this.called.set(key, 1);
        // オーバルは、減速が要る曲がりだけ。そうでなければ 6 は言わない
        if ((this.oval && !fast) || (!this.oval && c.grade >= 6 && !fast)) continue;
        let text = `${cornerName(c)}, ${spokenDistance(d)}.`;
        // すぐ後に続く曲がりは "into" でつなぐ
        const nx = this.corners[(ci + 1) % this.corners.length];
        const gap = ((nx.start - c.end + n) % n) * this.ds;
        if (nx !== c && gap < 60 && (!this.oval || speed > this.cornerSpeed(nx) * 1.04)) {
          text = `${cornerName(c)} into ${cornerName(nx).replace(', long', '').toLowerCase()}, ${spokenDistance(d)}.`;
          this.called.set(lap * 10000 + ((ci + 1) % this.corners.length) + (nx.start < c.start ? 10000 : 0), 1);
        }
        this.say(text, 3.5);
      }
      // ブレーキ：止まりきれる距離に近づいたら
      if (fast && !this.braked.has(key) && d > 5) {
        const need = (speed * speed - vc * vc) / (2 * 0.8 * v.p.tire.mu * 9.81) + speed * 0.4;
        if (d <= need && speed - vc > 25 / 3.6) {
          this.braked.set(key, 1);
          this.say(this.oval ? 'Lift!' : 'Brake!', 3.8);
        }
      }
    }
    // 古い印を捨てる
    if (this.called.size > 400) { this.called.clear(); this.braked.clear(); }
  }
}
