// タイムアタックの記録の検算：AI にプレイヤーの車を運転させて 3 周し、周のタイム、ゴースト、差、テレメトリを確かめる。
// 実行: npx tsx test/attack.ts [コース id] [車 id]
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { sampleGhost } from '../src/game/ghost';
import { Session } from '../src/game/session';
import type { Controls } from '../src/sim/vehicle';
import { AiDriver } from '../src/sim/ai';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';

await RAPIER.init();
const course = COURSES.find((c) => c.id === (process.argv[2] ?? 'circuit'))!;
const car = CAR_PRESETS.find((c) => c.id === (process.argv[3] ?? 'fr-sport'))!;
let ai: AiDriver | null = null;
const s: Session = new Session(RAPIER, { course, player: car, opponents: CAR_PRESETS, laps: 3, mode: 'attack' }, (dt, v): Controls => {
  ai ??= new AiDriver(s.course, v, 0.9, 0);
  return ai.update(dt, s.pw.vehicles);
});
const a = s.attack!;
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'OK  ' : 'NG  '} ${msg}`); if (!ok) fail++; };
check(s.racers.length === 1, `車は 1 台（${s.racers.length}）`);
check(s.race.laps > 100, `終わりを決めない周回（${s.race.laps}）`);

const dt = s.pw.dt;
const deltas: number[] = [];
let steps = 0;
while (a.laps.length < 3 && steps < 240 * 60 * 15) {
  s.step(dt);
  steps++;
  if (a.laps.length >= 1 && steps % 240 === 0 && isFinite(a.delta)) deltas.push(a.delta);
}
check(a.laps.length === 3, `3 周を走りきった（${a.laps.map((l) => `${l.time.toFixed(2)} s${l.best ? ' 最速' : ''}${l.valid ? '' : ' 無効'}`).join('、')}）`);
const best = Math.min(...a.laps.filter((l) => l.valid).map((l) => l.time));
check(!!a.best && Math.abs(a.best.time - best) < 1e-6, `残した最速の周 ${a.best?.time.toFixed(2)} s = 周のうち最速 ${best.toFixed(2)} s`);
const frames = a.best ? a.best.frames.length / 7 : 0;
check(Math.abs(frames - best * 20) <= 2, `ゴーストのコマ数 ${frames}（20 回／秒 × ${best.toFixed(2)} s）`);
// ゴーストの最初と最後のコマは、スタートラインの近く
if (a.best) {
  const p = new Vector3(), q = new Quaternion();
  const p0 = s.course.path[0];
  const ends = [0, a.best.time].map((t) => { sampleGhost(a.best!, t, p, q); return Math.hypot(p.x - p0.x, p.z - p0.z); });
  check(ends.every((d) => d < 60), `ゴーストの始まりと終わりはスタートラインの近く（${ends.map((d) => d.toFixed(1)).join('、')} m）`);
}
check(deltas.length > 10, `差を出せた回数 ${deltas.length}`);
// 2 周目以降の差は、その周と最速の周のタイム差より大きく外れない
const spread = Math.max(...a.laps.map((l) => l.time)) - Math.min(...a.laps.map((l) => l.time));
const dmax = Math.max(...deltas.map(Math.abs));
check(dmax < spread + 3, `差の大きさ ${dmax.toFixed(2)} s（周のタイムのばらつき ${spread.toFixed(2)} s、最初の周はスタートの分だけ遅い）`);
const tr = a.lastTrace!;
const filled = [...tr.speed].filter((x) => x > 1).length / tr.bins;
check(filled > 0.97, `テレメトリの区切りが埋まっている（${(filled * 100).toFixed(1)}%）`);
const mono = [...tr.time].every((t, i, arr) => i === 0 || t >= arr[i - 1] - 1e-3);
check(mono, '区切りの時刻は進む向きに並ぶ');
console.log(fail === 0 ? 'すべて通過' : `${fail} 件の失敗`);
process.exit(fail === 0 ? 0 : 1);
