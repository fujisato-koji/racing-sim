// レースの実況。レースの様子（順位、差、周回、スピン、コース外、接触、ゴール）から、英語の一言を選ぶ。
// 読み上げには依らない（言うことを決めて say に渡すだけ）ので、Node でも検算できる。
import type { Racer } from '../sim/race';
import type { Session } from './session';

/** 優先度：1 ふつう、2 順位や周回、3 ファイナルラップ、4 ゴール（voice.ts と同じ） */
export type Say = (text: string, priority: number) => void;

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ord = (n: number) => ORD[n] ?? `${n}th`;

/** 読み上げやすいタイム（1:05.3 は "1 oh 5 point 3"、58.2 は "58 point 2"） */
export function spokenTime(t: number) {
  if (!isFinite(t)) return '';
  const m = Math.floor(t / 60), s = t - m * 60;
  const whole = Math.floor(s), tenth = Math.floor((s - whole) * 10);
  if (m === 0) return `${whole} point ${tenth}`;
  return `${m} ${whole < 10 ? `oh ${whole}` : whole} point ${tenth}`;
}

const LOOSE = new Set(['gravel', 'sand', 'grass', 'rock']);

export class Commentator {
  private t = 0;
  private lastLine = -99;
  private readonly cool = new Map<string, number>();
  private introDone = false;
  private wasRunning = false;
  private announcedPos = 0;
  private candPos = 0;
  private candTime = 0;
  private lapsSeen = 0;
  private finalLapSaid = false;
  private finishSaid = false;
  private aiWinSaid = false;
  private leader: Racer | null = null;
  private fastest = Infinity;
  private closeAhead = 0;
  private closeBehind = 0;
  private spinTime = 0;
  private offTime = 0;
  private airTime = 0;
  private maxKmh = 0;
  private attackLaps = 0;
  private splitLap = -1;
  private rnd: () => number;

  constructor(private readonly s: Session, private readonly say: Say, seed = 1) {
    let x = seed * 9301 + 49297;
    this.rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  }

  private pick<T>(list: T[]): T { return list[Math.floor(this.rnd() * list.length) % list.length]; }

  /** 言う。key ごとに cooldown 秒は同じ話をしない。ふつうの話は前の話から 2.5 秒あける */
  private line(text: string, priority: number, key: string, cooldown = 0) {
    if ((this.cool.get(key) ?? -99) > this.t) return false;
    if (priority <= 1 && this.t - this.lastLine < 2.5) return false;
    if (priority === 2 && this.t - this.lastLine < 1.2) return false;
    this.cool.set(key, this.t + cooldown);
    this.lastLine = this.t;
    this.say(text, priority);
    return true;
  }

  /** 毎フレーム呼ぶ（一時停止中は呼ばない） */
  update(dt: number) {
    const s = this.s, race = s.race, me = s.player;
    this.t += dt;
    const events = s.events.splice(0, s.events.length);
    if (!me) return;
    const v = me.vehicle;
    const name = s.course.def.name;
    const field = s.racers.length;

    // 始まり
    if (!this.introDone && race.state === 'countdown') {
      this.introDone = true;
      if (s.attack) this.line(this.pick([`Time attack at ${name}. Let's see a fast lap!`, `${name}, time attack. The clock is running soon.`]), 2, 'intro');
      else if (race.free) this.line(`Free practice at ${name}. Enjoy the drive!`, 2, 'intro');
      else this.line(this.pick([
        `Welcome to ${name}! ${field} cars on the grid, ${race.laps} ${race.laps === 1 ? 'lap' : 'laps'} to go.`,
        `It's race day at ${name}. ${field} cars, ${race.laps} ${race.laps === 1 ? 'lap' : 'laps'}.`,
      ]), 2, 'intro');
    }
    if (race.state === 'running' && !this.wasRunning) {
      this.wasRunning = true;
      if (s.attack) this.line(this.pick(['Go! The clock is running.', 'And the lap begins. Go!']), 3, 'go');
      else if (!race.free) this.line(this.pick(['Lights out, and away we go!', "And they're off!", 'Green flag! Here we go!']), 3, 'go');
    }
    if (race.state === 'countdown') return;

    // 出来事（接触、コースに戻した）
    for (const e of events) {
      if (e.type === 'hit' && e.force > 60000) {
        if (e.other) this.line(this.pick([`Contact with ${e.other.name}!`, `Ooh, you and ${e.other.name} trade paint!`, `A bump from ${e.other.name}!`]), 1, 'hit', 6);
        else if (e.force > 150000 && !e.prop) this.line(this.pick(['Ouch! Into the wall!', 'Big impact!', "That's going to hurt!"]), 1, 'hit', 6);
      }
      if (e.type === 'respawn' && e.racer === me) this.line(this.pick(['Back on track. Keep pushing!', "Reset, and we're going again."]), 1, 'respawn', 8);
    }

    // スピン、コース外、ジャンプ、速さ
    const vf = v.linvel.dot(v.fwd), vr = v.linvel.dot(v.right);
    const speed = Math.hypot(vf, vr);
    const beta = Math.abs(Math.atan2(vr, Math.abs(vf))) * 180 / Math.PI;
    this.spinTime = speed > 6 && (beta > 60 || vf < -2) ? this.spinTime + dt : 0;
    if (this.spinTime > 0.35) this.line(this.pick(['Oh! A big spin!', 'Around you go!', 'Whoa, that was a spin!']), 2, 'spin', 10);
    const loose = v.wheels.filter((w) => w.contact && LOOSE.has(w.surface.id)).length >= 2;
    this.offTime = loose && speed > 11 ? this.offTime + dt : 0;
    if (this.offTime > 0.8) {
      const grass = v.wheels.some((w) => w.contact && w.surface.id === 'grass');
      this.line(grass ? this.pick(['Onto the grass!', 'A little wide there, onto the grass.']) : this.pick(['Off the track!', "That's a trip through the gravel!"]), 1, 'off', 12);
    }
    this.airTime = v.airborne ? this.airTime + dt : 0;
    if (this.airTime > 0.6) this.line(this.pick(['Huge air!', 'Look at that jump!']), 1, 'air', 8);
    const kmh = speed * 3.6;
    for (const mark of [300, 250, 200]) {
      if (kmh > mark && this.maxKmh <= mark) { this.line(`Over ${mark} kilometres an hour!`, 1, `speed${mark}`, 9999); break; }
    }
    this.maxKmh = Math.max(this.maxKmh, kmh);

    if (s.attack) { this.attackCalls(); return; }
    if (race.free) return;

    // 順位：1 秒変わらなければ言う
    const st = race.standings();
    const pos = st.indexOf(me) + 1;
    if (this.announcedPos === 0) this.announcedPos = pos;
    if (pos !== this.candPos) { this.candPos = pos; this.candTime = 0; } else this.candTime += dt;
    if (!me.finished && this.candTime > 1 && pos !== this.announcedPos && race.time > 3) {
      const gained = pos < this.announcedPos;
      const other = gained ? st[pos] : st[pos - 2];
      if (gained && pos === 1) this.line(this.pick(['Into the lead! Brilliant!', 'You take the lead!', `Past ${other?.name ?? 'them'}, and into first place!`]), 2, 'pos');
      else if (gained) this.line(this.pick([`Up to ${ord(pos)}!`, `A great move on ${other?.name ?? 'them'}, up to ${ord(pos)}.`, `Through into ${ord(pos)} place.`]), 2, 'pos');
      else this.line(this.pick([`Down to ${ord(pos)}.`, `${other?.name ?? 'Someone'} gets through. You're ${ord(pos)} now.`]), 2, 'pos');
      this.announcedPos = pos;
    }

    // 先頭が入れ替わった（プレイヤーではない車どうし）
    const lead = st[0];
    if (this.leader && lead !== this.leader && lead !== me && this.leader !== me && !lead.finished && race.time > 8) {
      this.line(`${lead.name} takes the lead!`, 1, 'leader', 25);
    }
    this.leader = lead;

    // 前と後ろとの差（経路の上の進み具合の差を、今の速さで割った秒）
    const step = s.course.length / Math.max(1, s.course.path.length);
    const gap = (r: Racer) => ((race.progress(r) - race.progress(me)) * step) / Math.max(12, speed);
    const ahead = pos > 1 ? st[pos - 2] : null, behind = pos < st.length ? st[pos] : null;
    this.closeAhead = ahead && !ahead.finished && gap(ahead) < 0.7 ? this.closeAhead + dt : 0;
    this.closeBehind = behind && !behind.finished && -gap(behind) < 0.5 ? this.closeBehind + dt : 0;
    if (ahead && this.closeAhead > 4) this.line(this.pick([`You're closing in on ${ahead.name}.`, `${ahead.name} is just ahead. Look for a gap!`, `Right on the gearbox of ${ahead.name}!`]), 1, 'ahead', 25);
    if (behind && this.closeBehind > 4) this.line(this.pick([`${behind.name} is right on your tail!`, `Pressure from ${behind.name} behind!`, `Watch your mirrors, ${behind.name} is close.`]), 1, 'behind', 25);

    // 周回。ファイナルラップに入ったときは、周のタイムと続けて 1 つの話にする
    if (me.laps > this.lapsSeen) {
      this.lapsSeen = me.laps;
      const best = Math.min(...s.racers.map((r) => r.bestLap));
      const isFastest = me.lastLap <= best + 1e-6 && me.lastLap < this.fastest;
      this.fastest = Math.min(this.fastest, best);
      if (!me.finished) {
        const lapText = isFastest && me.laps > 1 ? `${spokenTime(me.lastLap)}. That's the fastest lap of the race!` : this.pick([`Lap ${me.laps} done, ${spokenTime(me.lastLap)}.`, `${spokenTime(me.lastLap)} for that lap.`]);
        if (!this.finalLapSaid && race.laps > 1 && me.laps === race.laps - 1) {
          this.finalLapSaid = true;
          this.line(`${lapText} ${this.pick(['Final lap! Bring it home!', "Last lap! It's now or never!", 'The final lap begins!'])}`, 3, 'final');
        } else this.line(lapText, isFastest ? 2 : 1, 'lap');
      }
    }
    // しばらく黙っていたら、前や後ろとの差を言う
    if (this.t - this.lastLine > 15 && race.time > 20 && !me.finished) {
      if (pos === 1 && behind) {
        const g = -gap(behind);
        if (g > 1) this.line(this.pick([`You lead by ${g.toFixed(1)} seconds.`, `A gap of ${g.toFixed(1)} seconds back to ${behind.name}.`]), 1, 'gap', 30);
      } else if (ahead) {
        const g = gap(ahead);
        if (g > 1 && g < 30) this.line(this.pick([`${g.toFixed(1)} seconds behind ${ahead.name}.`, `The gap to ${ahead.name} is ${g.toFixed(1)} seconds.`]), 1, 'gap', 30);
      }
    }

    // ゴール
    const first = race.finishOrder[0];
    if (first && first !== me && !this.aiWinSaid && !me.finished) {
      this.aiWinSaid = true;
      this.line(`${first.name} takes the chequered flag and the win!`, 2, 'aiwin');
    }
    if (me.finished && !this.finishSaid) {
      this.finishSaid = true;
      const p = race.finishOrder.indexOf(me) + 1;
      if (p === 1) this.line(this.pick(['Chequered flag! And it is a win! What a drive!', 'Victory! You win at ' + name + '!']), 4, 'finish');
      else if (p <= 3) this.line(`Chequered flag! ${ord(p)} place, on the podium!`, 4, 'finish');
      else this.line(`Across the line in ${ord(p)} place.`, 4, 'finish');
    }
  }

  /** タイムアタック：最速の周を更新したか、最速からどれだけ遅れたか */
  private attackCalls() {
    const a = this.s.attack!, r = this.s.player!;
    // 周の半ばで、最速の周との差を言う
    const n = this.s.course.path.length;
    if (a.best && r.idx > n * 0.5 && r.idx < n * 0.6 && this.splitLap !== a.laps.length && isFinite(a.delta)) {
      this.splitLap = a.laps.length;
      const d = a.delta, ad = Math.abs(d);
      const amount = ad < 0.1 ? 'less than a tenth' : ad < 1 ? `${Math.round(ad * 10)} ${Math.round(ad * 10) === 1 ? 'tenth' : 'tenths'}` : `${ad.toFixed(1)} seconds`;
      this.line(d < 0 ? this.pick([`Halfway, ${amount} up on your best!`, `Green sector! ${amount} faster than your best.`]) : `Halfway, ${amount} down on your best.`, 1, 'split');
    }
    if (a.laps.length > this.attackLaps) {
      this.attackLaps = a.laps.length;
      const l = a.laps[a.laps.length - 1];
      if (!l.valid) this.line('That one will not count.', 1, 'alap');
      else if (l.best) this.line(this.pick([`New best lap! ${spokenTime(l.time)}!`, `${spokenTime(l.time)}! A new personal best!`]), 2, 'alap');
      else if (a.best) {
        const d = l.time - a.best.time;
        const off = d < 0.1 ? 'Less than a tenth off your best!' : d < 1 ? `Just ${Math.round(d * 10)} ${Math.round(d * 10) === 1 ? 'tenth' : 'tenths'} off your best.` : `${d.toFixed(1)} seconds off your best.`;
        this.line(`${spokenTime(l.time)}. ${off}`, 1, 'alap');
      }
    }
  }
}
