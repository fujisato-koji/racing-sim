// 1 回のレース（または自由走行）。物理、車、AI、周回をまとめ、固定刻みで進める。
// 画面に依らないので Node でも動く。
import { AiDriver } from '../sim/ai';
import type { CourseData, CourseDef } from '../sim/course';
import { buildCourse, populate, yawFromDir } from '../sim/course';
import type { CarParams } from '../sim/params';
import { cloneParams } from '../sim/params';
import type { Racer } from '../sim/race';
import { Race, makeRacer } from '../sim/race';
import type { Controls } from '../sim/vehicle';
import { Vehicle } from '../sim/vehicle';
import type { Rapier } from '../sim/world';
import { PhysicsWorld } from '../sim/world';

export interface SessionConfig {
  course: CourseDef;
  player: CarParams | null;
  opponents: CarParams[];
  laps: number;
}

const AI_NAMES = ['赤城', '榛名', '妙義', '筑波', '箱根', '碓氷', '六甲'];

export class Session {
  readonly pw: PhysicsWorld;
  readonly course: CourseData;
  readonly racers: Racer[] = [];
  readonly race: Race;
  readonly player: Racer | null;
  private acc = 0;
  /** 描画の補間に使う、最後のステップからの経過の割合 */
  alpha = 0;
  paused = false;

  constructor(R: Rapier, readonly cfg: SessionConfig, readonly playerInput: (dt: number, v: Vehicle) => Controls) {
    this.pw = new PhysicsWorld(R);
    this.course = buildCourse(cfg.course);
    populate(this.pw, this.course);
    const grid = this.course.grid;
    const hasTrack = this.course.path.length > 0;
    let slot = 0;
    const cars: { p: CarParams; isPlayer: boolean }[] = [];
    if (cfg.player) cars.push({ p: cfg.player, isPlayer: true });
    if (hasTrack) for (const p of cfg.opponents) cars.push({ p, isPlayer: false });
    // プレイヤーは列の後ろから（追い抜く楽しみのため）
    const order = cars.length > 1 && cfg.player ? [...cars.slice(1), cars[0]] : cars;
    for (const c of order) {
      const g = grid[Math.min(slot++, grid.length - 1)];
      const v = new Vehicle(this.pw, cloneParams(c.p), { x: g.x, y: g.y, z: g.z, yaw: g.yaw });
      this.pw.vehicles.push(v);
      const lane = ((this.racers.length % 3) - 1) * 1.5;
      const ai = !c.isPlayer && hasTrack ? new AiDriver(this.course, v, 0.86 + ((this.racers.length * 37) % 10) / 100, lane) : null;
      const name = c.isPlayer ? 'あなた' : AI_NAMES[this.racers.length % AI_NAMES.length];
      this.racers.push(makeRacer(name, c.p.color, v, c.isPlayer, ai));
    }
    this.player = this.racers.find((r) => r.isPlayer) ?? null;
    this.race = new Race(this.course, this.racers, hasTrack ? cfg.laps : 0);
    if (this.race.free) for (const r of this.racers) r.vehicle.hold = false;
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
    this.pw.step();
    this.race.update(dt);
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
    } else if (r.isPlayer && r.upsideDown > 4) {
      this.respawn(r);
    }
  }

  /** 経路の近くの、少し手前に置き直す */
  respawn(r: Racer) {
    const v = r.vehicle;
    const path = this.course.path;
    if (path.length === 0) {
      const g = this.course.grid[0];
      v.place(g.x, g.y, g.z, g.yaw);
    } else {
      const n = path.length;
      const i = (this.race.free ? this.nearestIndex(v) : r.idx) - 8;
      const p = path[(i + n) % n];
      v.place(p.x, p.y, p.z, yawFromDir(p.tx, p.tz));
      if (r.ai) { r.ai.idx = (i + n) % n; r.ai.stuckTime = 0; }
    }
    r.upsideDown = 0;
    r.offTrack = 0;
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
