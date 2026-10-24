// AI だけでレースを走らせ、周回できるか、タイム、戻された回数を見る。
// 実行: npx tsx test/ai-race.ts [コース id] [周回数]
import RAPIER from '@dimforge/rapier3d-compat';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
import { Session } from '../src/game/session';

await RAPIER.init();
const id = process.argv[2] ?? 'circuit';
const laps = Number(process.argv[3] ?? 2);
const course = COURSES.find((c) => c.id === id)!;
const t0 = Date.now();
const s = new Session(RAPIER, { course, player: null, opponents: CAR_PRESETS, laps }, () => ({ steer: 0, throttle: 0, brake: 0 }));
console.log(`構築 ${(Date.now() - t0)} ms、全長 ${s.course.length.toFixed(0)} m`);
const respawns = new Map<string, number>();
const orig = s.respawn.bind(s);
s.respawn = (r) => {
  respawns.set(r.name, (respawns.get(r.name) ?? 0) + 1);
  const why = r.upsideDown > 2 ? '転倒' : r.offTrack > 3 ? 'コース外' : '停止';
  if (process.env.VERBOSE) console.log(`  戻す ${r.name} t=${s.race.time.toFixed(1)} 位置 ${(r.idx / s.course.path.length).toFixed(3)} 理由 ${why} 速さ ${r.vehicle.speed.toFixed(1)} 上向き ${r.vehicle.up.y.toFixed(2)}`);
  orig(r);
};
// コースから外れた場所を記録
const offLog = new Map<string, number>();
const step0 = s.step.bind(s);
s.step = (dt) => {
  step0(dt);
  for (const r of s.racers) {
    const p = s.course.path[r.idx];
    const lat = (r.vehicle.pos.x - p.x) * p.lx + (r.vehicle.pos.z - p.z) * p.lz;
    const key = r.name;
    if (Math.abs(lat) > s.course.width / 2 + 1 && !offLog.has(key + Math.floor(r.idx / 20))) {
      offLog.set(key + Math.floor(r.idx / 20), 1);
      if (process.env.VERBOSE) console.log(`  はみ出し ${r.name} t=${s.race.time.toFixed(1)} 位置 ${(r.idx / s.course.path.length).toFixed(3)} 横 ${lat.toFixed(1)} m 速さ ${(r.vehicle.speed * 3.6).toFixed(0)} km/h 目標 ${(r.ai!.target[r.idx] * 3.6).toFixed(0)} 曲率半径 ${(1 / Math.abs(p.k)).toFixed(0)} m 空中 ${r.vehicle.airborne}`);
    }
  }
};
const t1 = Date.now();
let steps = 0;
const limit = 60 * 8 * laps;
const only = process.env.ONLY;
if (only) s.racers.splice(0, s.racers.length, ...s.racers.filter((r) => r.vehicle.p.id === only));
while (s.race.time < limit && s.racers.some((r) => !r.finished)) { s.step(s.pw.dt); steps++; }
const wall = (Date.now() - t1) / 1000;
console.log(`模擬 ${s.race.time.toFixed(0)} s を ${wall.toFixed(1)} s で計算（1 ステップ ${(wall / steps * 1e6).toFixed(0)} µs、${s.racers.length} 台）`);
for (const r of s.race.standings()) {
  console.log(`${r.name}（${r.vehicle.p.name}）: ${r.finished ? `完走 ${r.finishTime.toFixed(1)} s` : `未完 ${r.laps} 周`}、最速周 ${isFinite(r.bestLap) ? r.bestLap.toFixed(1) : '-'} s、戻した回数 ${respawns.get(r.name) ?? 0}`);
}
