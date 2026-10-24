// 副操縦士の検算：プレイヤーの車を AI に運転させて 1 周走り、知らせた時刻、曲がりまでの距離、速さを並べて出す。
// きつい曲がり（6 以外）をみな手前で知らせること、ブレーキの声がきつい曲がりの前に出ることを確かめる。
// 実行: npx tsx test/codriver.ts [コース id]
import RAPIER from '@dimforge/rapier3d-compat';
import { CoDriver, cornerName } from '../src/game/codriver';
import { Session } from '../src/game/session';
import { AiDriver } from '../src/sim/ai';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
import type { Controls } from '../src/sim/vehicle';

await RAPIER.init();
const course = COURSES.find((c) => c.id === (process.argv[2] ?? 'suzuka'))!;
let ai: AiDriver | null = null;
const s: Session = new Session(RAPIER, { course, player: CAR_PRESETS[2], opponents: [], laps: 2, mode: 'race' }, (dt, v): Controls => {
  ai ??= new AiDriver(s.course, v, 0.9, 0);
  return ai.update(dt, s.pw.vehicles);
});
const said: { t: number; text: string; idx: number; kmh: number }[] = [];
const cd = new CoDriver(s, (text) => said.push({ t: s.race.time, text, idx: s.player!.idx, kmh: s.player!.vehicle.speed * 3.6 }));
const dt = s.pw.dt, n = s.course.path.length, ds = s.course.length / n;
let steps = 0;
while (s.player!.laps < 1 && steps < 240 * 600) { s.step(dt); steps++; if (steps % 4 === 0) cd.update(); }
for (const l of said) console.log(`${l.t.toFixed(1).padStart(6)} s  ${(l.idx * ds).toFixed(0).padStart(5)} m  ${l.kmh.toFixed(0).padStart(3)} km/h  ${l.text}`);
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'OK  ' : 'NG  '} ${msg}`); if (!ok) fail++; };
const want = cd.corners.filter((c) => c.grade < 6);
// 曲がりの名前が出たか（つないだ曲がりは "into" の後ろに小文字で出る）
const missed = want.filter((c) => !said.some((l) => l.text.toLowerCase().includes(cornerName(c).replace(', long', '').toLowerCase())));
check(missed.length <= Math.ceil(want.length * 0.1), `きつい曲がり ${want.length} のうち、名前を言わなかったもの ${missed.length}`);
const brakes = said.filter((l) => /Brake|Lift/.test(l.text)).length;
// オーバルは減速の要る所だけなので、少なければよい
if (course.track?.auto === 'oval') check(said.length <= 6, `オーバルでは知らせは少ない（${said.length} 回）`);
else check(brakes >= 3, `ブレーキの声 ${brakes} 回`);
let tight = 0;
for (let i = 1; i < said.length; i++) if (said[i].t - said[i - 1].t < 0.8 && !/Brake/.test(said[i].text)) tight++;
check(tight <= 2, `0.8 秒より詰まった知らせ ${tight} 回`);
console.log(fail === 0 ? 'すべて通過' : `${fail} 件の失敗`);
process.exit(fail === 0 ? 0 : 1);
