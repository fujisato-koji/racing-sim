// 1 回のレース（または自由走行）。物理、車、AI、周回をまとめ、固定刻みで進める。
// 画面に依らないので Node でも動く。
import { AiDriver } from '../sim/ai';
import type { CourseData, CourseDef } from '../sim/course';
import { buildCourse, pathUp, populate, yawFromDir } from '../sim/course';
import type { CarParams } from '../sim/params';
import { cloneParams } from '../sim/params';
import type { Racer } from '../sim/race';
import { Race, makeRacer } from '../sim/race';
import type { Controls } from '../sim/vehicle';
import { Vehicle } from '../sim/vehicle';
import type { Rapier } from '../sim/world';
import { PhysicsWorld } from '../sim/world';
import type { TerrainSampler } from '../sim/terrain-sampler';
import type { RealBuilding } from '../sim/osm-buildings';
import { TimeAttack, carKeyOf } from './timeattack';

/** 実況に渡す出来事。hit はプレイヤーの車がぶつかったとき（force は接触の力 [N]） */
export type RaceEvent =
  | { type: 'respawn'; racer: Racer }
  | { type: 'hit'; force: number; other: Racer | null; prop: string | null };

export interface SessionConfig {
  course: CourseDef;
  player: CarParams | null;
  opponents: CarParams[];
  laps: number;
  /** race は AI と競う。attack は 1 台で周回し、最速の周をゴーストとして残す */
  mode?: 'race' | 'attack';
  /** 実在のコースのまわりの標高（遠景のデータ）。無ければコースの標高から作る */
  terrain?: TerrainSampler;
  /** 実在の建物（OpenStreetMap） */
  buildings?: RealBuilding[];
}

/** タイムアタックは終わりを決めず、やめるまで周回する */
const ATTACK_LAPS = 999;

const lapText = (t: number) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`; };

const AI_NAMES = ['Akagi', 'Haruna', 'Myogi', 'Tsukuba', 'Hakone', 'Usui', 'Rokko'];

export class Session {
  readonly pw: PhysicsWorld;
  readonly course: CourseData;
  readonly racers: Racer[] = [];
  readonly race: Race;
  readonly player: Racer | null;
  /** タイムアタックのときだけ */
  readonly attack: TimeAttack | null;
  private acc = 0;
  /** 描画の補間に使う、最後のステップからの経過の割合 */
  alpha = 0;
  paused = false;
  /** 実況に渡す出来事（読んだ側が空にする） */
  readonly events: RaceEvent[] = [];
  /** 画面に出す短い知らせ（文と、いつまで出すか） */
  notice: { text: string; until: number } | null = null;

  constructor(R: Rapier, readonly cfg: SessionConfig, readonly playerInput: (dt: number, v: Vehicle) => Controls) {
    this.pw = new PhysicsWorld(R);
    this.course = buildCourse(cfg.course, cfg.terrain, cfg.buildings);
    populate(this.pw, this.course);
    const grid = this.course.grid;
    const hasTrack = this.course.path.length > 0;
    let slot = 0;
    const cars: { p: CarParams; isPlayer: boolean }[] = [];
    if (cfg.player) cars.push({ p: cfg.player, isPlayer: true });
    const attackMode = cfg.mode === 'attack' && hasTrack && !!cfg.player;
    if (hasTrack && !attackMode) for (const p of cfg.opponents) cars.push({ p, isPlayer: false });
    // プレイヤーは列の後ろから（追い抜く楽しみのため）
    const order = cars.length > 1 && cfg.player ? [...cars.slice(1), cars[0]] : cars;
    for (const c of order) {
      const g = grid[Math.min(slot++, grid.length - 1)];
      const v = new Vehicle(this.pw, cloneParams(c.p), { x: g.x, y: g.y, z: g.z, yaw: g.yaw, up: g.up });
      this.pw.vehicles.push(v);
      const lane = ((this.racers.length % 3) - 1) * 1.5;
      const ai = !c.isPlayer && hasTrack ? new AiDriver(this.course, v, 0.86 + ((this.racers.length * 37) % 10) / 100, lane) : null;
      const name = c.isPlayer ? 'You' : AI_NAMES[this.racers.length % AI_NAMES.length];
      this.racers.push(makeRacer(name, c.p.color, v, c.isPlayer, ai));
    }
    this.player = this.racers.find((r) => r.isPlayer) ?? null;
    this.race = new Race(this.course, this.racers, hasTrack ? (attackMode ? ATTACK_LAPS : cfg.laps) : 0);
    if (this.race.free) for (const r of this.racers) r.vehicle.hold = false;
    this.attack = attackMode && this.player ? new TimeAttack(this.race, this.player, cfg.course.id, carKeyOf(cfg.player!), cfg.player!.name) : null;
  }

  /** 1 フレームぶん進める */
  update(frameDt: number) {
    if (this.paused) return;
    const dt = this.pw.dt;
    this.acc += Math.min(frameDt, 0.1);
    let steps = 0;
    while (this.acc >= dt && steps < 30) {
      this.step(dt);
      this.acc -= dt;
      steps++;
    }
    this.alpha = this.acc / dt;
  }

  step(dt: number) {
    const vehicles = this.pw.vehicles;
    for (const r of this.racers) {
      if (r.isPlayer) r.vehicle.controls = this.playerInput(dt, r.vehicle);
      else if (r.ai) r.vehicle.controls = r.ai.update(dt, vehicles);
    }
    const n0 = this.pw.impacts.length;
    this.pw.step();
    // プレイヤーの車の接触を拾う（音が読む前の、このステップで増えた分）
    const me = this.player?.vehicle;
    if (me) {
      let best: (typeof this.pw.impacts)[number] | null = null;
      for (let k = n0; k < this.pw.impacts.length; k++) {
        const h = this.pw.impacts[k];
        if ((h.vehicle === me || h.other === me) && (!best || h.force > best.force)) best = h;
      }
      if (best) {
        const otherCar = best.vehicle === me ? best.other : best.vehicle;
        this.events.push({ type: 'hit', force: best.force, other: this.racers.find((r) => r.vehicle === otherCar) ?? null, prop: best.prop });
      }
    }
    // 音を鳴らしていないとき（Node での検算）も溜まりすぎないように
    if (this.pw.impacts.length > 48) this.pw.impacts.splice(0, this.pw.impacts.length - 48);
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
    this.race.update(dt);
    if (this.attack) {
      const before = this.attack.laps.length;
      this.attack.step();
      const l = this.attack.laps[before];
      if (l) this.say(l.best ? `New best lap ${lapText(l.time)}` : l.valid ? `Lap ${lapText(l.time)}` : `Lap ${lapText(l.time)} (no time)`, 3);
    }
    for (const r of this.racers) this.watch(r, dt);
  }

  /** 引っくり返ったまま、コースから大きく外れた、動けなくなった車を戻す（プレイヤーは R キー） */
  private watch(r: Racer, dt: number) {
    const v = r.vehicle;
    r.upsideDown = v.up.y < 0.3 && v.linvel.length() < 3 ? r.upsideDown + dt : 0;
    if (r.ai && this.race.state !== 'countdown') {
      const d = r.ai.track();
      r.offTrack = d > this.course.width / 2 + 25 ? r.offTrack + dt : 0;
      r.ai.stuckTime = Math.abs(v.speed) < 1.5 ? r.ai.stuckTime + dt : 0;
      if (r.upsideDown > 2 || r.offTrack > 3 || r.ai.stuckTime > 4) this.respawn(r);
    } else if (r.isPlayer) {
      // アクセルかブレーキを踏んでいるのに動けない（障害物に挟まった、砂にはまった）
      const trying = v.controls.throttle > 0.3 || v.controls.brake > 0.3;
      const still = Math.abs(v.speed) < 1 && v.linvel.length() < 1.2;
      r.stuck = trying && still && !this.paused && this.race.state !== 'countdown' ? r.stuck + dt : 0;
      if (r.stuck > 1.5 && r.stuck - dt <= 1.5) this.say('Stuck? Press R (or tap Reset) to get back on track', 3);
      if (r.upsideDown > 4 || r.stuck > 4) {
        this.respawn(r);
        this.say(this.attack ? 'Moved you back to the track. This lap is invalid' : 'Moved you back to the track', 2.5);
      }
    }
  }

  say(text: string, seconds: number) {
    this.notice = { text, until: this.pw.time + seconds };
  }

  /** 経路の近くの、少し手前に置き直す */
  respawn(r: Racer) {
    const v = r.vehicle;
    this.events.push({ type: 'respawn', racer: r });
    if (r.isPlayer && this.attack && this.race.state === 'running') {
      this.attack.markInvalid();
      this.say('Lap invalid: you were reset to the track', 2.5);
    }
    const path = this.course.path;
    if (path.length === 0) {
      const g = this.course.grid[0];
      v.place(g.x, g.y, g.z, g.yaw);
    } else {
      const n = path.length;
      let i = (this.race.free ? this.nearestIndex(v) : r.idx) - 8;
      // 戻す先に他の車がいたら、さらに手前へ
      for (let tries = 0; tries < 4; tries++) {
        const p = path[((i % n) + n) % n];
        const busy = this.pw.vehicles.some((o) => o !== v && (o.pos.x - p.x) ** 2 + (o.pos.z - p.z) ** 2 < 49);
        if (!busy) break;
        i -= 10;
      }
      const k = ((i % n) + n) % n;
      const p = path[k];
      v.place(p.x, p.y, p.z, yawFromDir(p.tx, p.tz), pathUp(path, k));
      if (r.ai) { r.ai.idx = k; r.ai.stuckTime = 0; }
    }
    r.upsideDown = 0;
    r.offTrack = 0;
    r.stuck = 0;
  }

  private nearestIndex(v: Vehicle) {
    let best = Infinity, bi = 0;
    this.course.path.forEach((p, i) => {
      const d = (p.x - v.pos.x) ** 2 + (p.z - v.pos.z) ** 2;
      if (d < best) { best = d; bi = i; }
    });
    return bi;
  }

  dispose() {
    this.pw.free();
  }
}
