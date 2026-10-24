import RAPIER from '@dimforge/rapier3d-compat';
import { Session } from '../src/game/session';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
await RAPIER.init();
const course = COURSES.find((c) => c.id === (process.argv[2] ?? 'monaco'))!;
const car = CAR_PRESETS.find((c) => c.id === (process.argv[3] ?? 'mr-super'))!;
// ALL=1 のときは test/ai-race.ts と同じく 6 台を作り、1 台だけ走らせる（ほかはスタート位置に止めたまま）
const all = process.env.ALL === '1';
const s = new Session(RAPIER, { course, player: null, opponents: all ? CAR_PRESETS : [car], laps: 1 }, () => ({ steer: 0, throttle: 0, brake: 0 }));
if (all) s.racers.splice(0, s.racers.length, ...s.racers.filter((x) => x.vehicle.p.id === car.id));
const r = s.racers[0], v = r.vehicle;
const trail: string[] = [];
let slow = 0, printed = 0;
for (let i = 0; i < 240 * 120 && printed < 3; i++) {
  s.step(s.pw.dt);
  if (s.race.state === 'countdown') continue;
  if (i % 60 === 0) {
    const n0 = s.course.path.length, p0 = s.course.path[r.idx];
    const lat0 = (v.pos.x - p0.x) * p0.lx + (v.pos.z - p0.z) * p0.lz;
    trail.push(`  t=${s.race.time.toFixed(2)} 位置 ${(r.idx / n0).toFixed(4)} 横 ${lat0.toFixed(2)} 速さ ${(v.speed * 3.6).toFixed(0)} 目標 ${(r.ai!.target[r.idx] * 3.6).toFixed(0)} 操作 ${v.controls.steer.toFixed(2)}/${v.controls.throttle.toFixed(2)}/${v.controls.brake.toFixed(2)} 接地 ${v.wheels.map((w) => (w.contact ? w.surface.id[0] : '-')).join('')} 上 ${v.up.y.toFixed(2)}`);
    if (trail.length > Number(process.env.TRAIL ?? 14)) trail.shift();
  }
  slow = Math.abs(v.speed) < 1.5 ? slow + s.pw.dt : 0;
  if (slow > 3) {
    printed++; slow = -5;
    console.log(trail.join('\n'));
    const n = s.course.path.length, p = s.course.path[r.idx];
    const lat = (v.pos.x - p.x) * p.lx + (v.pos.z - p.z) * p.lz;
    console.log(`t=${s.race.time.toFixed(1)} 位置 ${(r.idx / n).toFixed(3)} 横 ${lat.toFixed(2)} m 半径 ${(1 / Math.abs(p.k)).toFixed(1)} m 向きの差 ${(Math.acos(Math.max(-1, Math.min(1, v.fwd.x * p.tx + v.fwd.z * p.tz))) * 57.3).toFixed(0)}° 操作 ${JSON.stringify(v.controls)} ギア ${v.gear} rpm ${v.rpm.toFixed(0)} 接地 ${v.wheels.map((w) => (w.contact ? w.surface.id : '-')).join(',')}`);
    const near = s.course.walls.filter((w) => Math.hypot(w.cx - v.pos.x, w.cz - v.pos.z) < 6);
    console.log(`  近くの壁 ${near.length}: ${near.slice(0, 6).map((w) => `(${(w.cx - v.pos.x).toFixed(1)},${(w.cz - v.pos.z).toFixed(1)}) 長さ ${(w.half[2] * 2).toFixed(1)}`).join(' ')}`);
    const vv = v as unknown as { tcsFactor: number };
    console.log(`  アクセル出力 ${v.throttleOut.toFixed(2)} TCS ${vv.tcsFactor.toFixed(2)} ESC ${v.escActive} クラッチ ${v.dt.clutchTorque(s.pw.dt).toFixed(0)} N·m 車輪 ω ${v.dt.w.slice(2, 6).map((x) => x.toFixed(1)).join(',')} fz ${v.wheels.map((w) => w.fz.toFixed(0)).join(',')} κ ${v.wheels.map((w) => w.kappa.toFixed(2)).join(',')} 縮み ${v.wheels.map((w) => w.compression.toFixed(3)).join(',')} 上向き ${v.up.toArray().map((x) => x.toFixed(2)).join(',')} 前向き ${v.fwd.toArray().map((x) => x.toFixed(2)).join(',')} 標高 ${p.y.toFixed(1)} 次 ${s.course.path[(r.idx + 20) % n].y.toFixed(1)}`);
    console.log(`  AI の目標速度 ${(r.ai!.target[r.idx] * 3.6).toFixed(0)} km/h、AI の位置 ${(r.ai!.idx / n).toFixed(3)}`);
  }
}
