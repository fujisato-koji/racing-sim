// 実在のコースすべてで AI だけのレースを 1 周走らせ、完走と戻した回数をまとめる（確認用）
import RAPIER from '@dimforge/rapier3d-compat';
import { Session } from '../src/game/session';
import { REAL_COURSES } from '../src/sim/tracks';
import { CAR_PRESETS } from '../src/sim/presets';
await RAPIER.init();
const only = process.argv.slice(2);
for (const course of REAL_COURSES) {
  if (only.length && !only.includes(course.id)) continue;
  const t0 = Date.now();
  const s = new Session(RAPIER, { course, player: null, opponents: CAR_PRESETS, laps: 1 }, () => ({ steer: 0, throttle: 0, brake: 0 }));
  const build = Date.now() - t0;
  const counts = new Map<string, number>();
  const orig = s.respawn.bind(s);
  s.respawn = (r) => { counts.set(r.name, (counts.get(r.name) ?? 0) + 1); orig(r); };
  const limit = Math.max(240, (course.lengthOfficial ?? 4000) / 10);
  while (s.race.time < limit && s.racers.some((r) => !r.finished)) s.step(s.pw.dt);
  const fin = s.racers.filter((r) => r.finished);
  const best = fin.length ? Math.min(...fin.map((r) => r.finishTime)) : NaN;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const worst = s.racers.filter((r) => !r.finished).map((r) => r.vehicle.p.id).join(',');
  console.log(`${course.name.padEnd(12)} 構築 ${build} ms、完走 ${fin.length}/6、最速 ${best.toFixed(1)} s（平均 ${((course.lengthOfficial ?? 0) / best * 3.6).toFixed(0)} km/h）、戻した回数 ${total}${worst ? `、未完 ${worst}` : ''}`);
  s.dispose();
}
