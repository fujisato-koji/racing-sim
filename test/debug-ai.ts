import RAPIER from '@dimforge/rapier3d-compat';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
import { Session } from '../src/game/session';
await RAPIER.init();
const course = COURSES.find((c) => c.id === (process.argv[2] ?? 'circuit'))!;
const car = CAR_PRESETS.find((c) => c.id === (process.argv[3] ?? 'fr-sport'))!;
const t0 = Number(process.argv[4] ?? 10), t1 = Number(process.argv[5] ?? 24);
const s = new Session(RAPIER, { course, player: null, opponents: [car], laps: 1 }, () => ({ steer: 0, throttle: 0, brake: 0 }));
const r = s.racers[0], v = r.vehicle;
let next = t0;
while (s.race.time < t1) {
  s.step(s.pw.dt);
  if (s.race.time >= next) {
    next += 0.25;
    const p = s.course.path[r.idx];
    const lat = (v.pos.x - p.x) * p.lx + (v.pos.z - p.z) * p.lz;
    const beta = Math.atan2(v.linvel.dot(v.right), v.linvel.dot(v.fwd)) * 180 / Math.PI;
    const w = v.wheels;
    console.log(`t ${s.race.time.toFixed(2)} f ${(r.idx / s.course.path.length).toFixed(3)} v ${(v.speed * 3.6).toFixed(0)} tgt ${(r.ai!.target[r.idx] * 3.6).toFixed(0)} lat ${lat.toFixed(2)} beta ${beta.toFixed(1)} yawr ${v.angvel.y.toFixed(2)} st ${v.controls.steer.toFixed(2)} thr ${v.controls.throttle.toFixed(2)}/${v.throttleOut.toFixed(2)} br ${v.controls.brake.toFixed(2)} g ${v.gear} rpm ${v.rpm.toFixed(0)} | ta ${w.map((x) => (Math.atan(x.tanAlpha) * 57.3).toFixed(1)).join(',')} | k ${w.map((x) => x.kappa.toFixed(2)).join(',')} | fz ${w.map((x) => x.fz.toFixed(0)).join(',')}`);
  }
}
