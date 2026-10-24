// ある区間を通る車の様子を 0.1 秒ごとに出す（確認用）。実行: npx tsx test/debug-trace.ts コース 車 開始 終了
import RAPIER from '@dimforge/rapier3d-compat';
import { Session } from '../src/game/session';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
await RAPIER.init();
const course = COURSES.find((c) => c.id === process.argv[2])!;
const car = CAR_PRESETS.find((c) => c.id === process.argv[3])!;
const f0 = Number(process.argv[4]), f1 = Number(process.argv[5]);
const s = new Session(RAPIER, { course, player: null, opponents: [car], laps: 1 }, () => ({ steer: 0, throttle: 0, brake: 0 }));
const r = s.racers[0], v = r.vehicle, n = s.course.path.length;
let last = -1, done = false;
for (let i = 0; i < 240 * 400 && !done; i++) {
  s.step(s.pw.dt);
  const f = r.idx / n;
  if (f > f1 && last > 0) done = true;
  if (f < f0 || f > f1 || s.race.time - last < 0.1) continue;
  last = s.race.time;
  const p = s.course.path[r.idx];
  const lat = (v.pos.x - p.x) * p.lx + (v.pos.z - p.z) * p.lz;
  const w = v.wheels;
  console.log(`t ${s.race.time.toFixed(1)} f ${f.toFixed(4)} v ${(v.speed * 3.6).toFixed(0)} 目標 ${(r.ai!.target[r.idx] * 3.6).toFixed(0)} 横 ${lat.toFixed(1)} 半径 ${(1 / Math.abs(p.k)).toFixed(0)} 操作 ${v.controls.steer.toFixed(2)}/${v.controls.throttle.toFixed(2)}/${v.controls.brake.toFixed(2)} ギア ${v.gear} 接地 ${w.map((x) => (x.contact ? x.surface.id[0] : '-')).join('')} fz ${w.map((x) => (x.fz / 1000).toFixed(1)).join(',')} κ ${w.map((x) => x.kappa.toFixed(2)).join(',')} ABS ${w.map((x) => x.absFactor.toFixed(1)).join(',')} 上 ${v.up.y.toFixed(2)} 勾配 ${(v.fwd.y * 100).toFixed(0)}%`);
}
