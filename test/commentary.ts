// 実況の検算：プレイヤーの車も AI に運転させてレースを走らせ、実況が言ったことを時刻と並べて出す。
// 始まり、スタート、ファイナルラップ、ゴールを言うこと、ふつうの話が 2.5 秒より詰まらないことを確かめる。
// 実行: npx tsx test/commentary.ts [コース id] [周回数] [attack]
import RAPIER from '@dimforge/rapier3d-compat';
import { Commentator } from '../src/game/commentary';
import { Session } from '../src/game/session';
import { AiDriver } from '../src/sim/ai';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
import type { Controls } from '../src/sim/vehicle';

await RAPIER.init();
const course = COURSES.find((c) => c.id === (process.argv[2] ?? 'circuit'))!;
const laps = Number(process.argv[3] ?? 3);
const attack = process.argv[4] === 'attack';
let ai: AiDriver | null = null;
// プレイヤーは少し遅めの AI（順位が動くように）
const s: Session = new Session(RAPIER, { course, player: CAR_PRESETS[2], opponents: CAR_PRESETS.slice(0, 5), laps, mode: attack ? 'attack' : 'race' }, (dt, v): Controls => {
  ai ??= new AiDriver(s.course, v, 0.84, 0);
  return ai.update(dt, s.pw.vehicles);
});
const said: { t: number; p: number; text: string }[] = [];
const c = new Commentator(s, (text, p) => said.push({ t: s.race.time, p, text }), 7);
const dt = s.pw.dt;
let steps = 0;
const limit = 240 * (attack ? 60 * 4 : 90 * laps + 30);
while (steps < limit) {
  s.step(dt);
  steps++;
  if (steps % 4 === 0) c.update(dt * 4);
  if (!attack && s.race.state === 'finished') { for (let k = 0; k < 240 * 3; k++) { s.step(dt); if (k % 4 === 0) c.update(dt * 4); } break; }
  if (attack && s.attack!.laps.length >= 3) { for (let k = 0; k < 120; k++) c.update(dt); break; }
}
for (const l of said) console.log(`${l.t.toFixed(1).padStart(7)} s  [${l.p}] ${l.text}`);
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'OK  ' : 'NG  '} ${msg}`); if (!ok) fail++; };
const has = (re: RegExp) => said.some((l) => re.test(l.text));
check(has(/Welcome|race day|Time attack|time attack/), '始まりを言う');
if (!attack) {
  check(has(/away we go|they're off|Green flag/), 'スタートを言う');
  if (laps > 1) check(has(/Final lap|Last lap|final lap/), 'ファイナルラップを言う');
  check(has(/Chequered flag|Victory|Across the line/), 'ゴールを言う');
} else {
  check(has(/best/), '周のタイムと最速の周の話をする');
}
const normal = said.filter((l) => l.p <= 1);
let tight = 0;
for (let i = 1; i < said.length; i++) if (said[i].p <= 1 && said[i].t - said[i - 1].t < 2.4) tight++;
check(tight === 0, `ふつうの話が前の話から 2.5 秒あいている（詰まった数 ${tight}、ふつうの話 ${normal.length} 件）`);
console.log(fail === 0 ? 'すべて通過' : `${fail} 件の失敗`);
process.exit(fail === 0 ? 0 : 1);
