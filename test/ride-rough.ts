// 走ったときの車のがたつきを測る：AI に 1 台で 1 周走らせ、車体の上下の加速度（重力を除く）と、ロールとピッチの角速度、
// サスペンションの縮む速さを、毎ステップ記録して RMS を出す。がたつきの大きい所（コースの上の位置）も出す。
// 実行: npx tsx test/ride-rough.ts [id ...]
import RAPIER from '@dimforge/rapier3d-compat';
import { Session } from '../src/game/session';
import { AiDriver } from '../src/sim/ai';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
import type { Controls } from '../src/sim/vehicle';

await RAPIER.init();
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['indianapolis', 'daytona', 'talladega', 'charlotte', 'bristol', 'suzuka', 'silverstone'];
for (const spec of ids) {
  const [id, variant] = spec.split(':');
  const base = COURSES.find((c) => c.id === id)!;
  // :flat はバンクなし、:const はどこも曲がりと同じバンク、:s120 はバンクを前後 120 m でならす、:p25 は中心線を前後 25 m でならす
  const t0 = base.track;
  const course = !t0 || !variant ? base
    : variant === 'flat' ? { ...base, track: { ...t0, banking: undefined } }
    : variant === 'const' ? { ...base, track: { ...t0, banking: { turns: t0.banking!.turns, straights: t0.banking!.turns } } }
    : variant.startsWith('p') ? { ...base, track: { ...t0, pathSmooth: Number(variant.slice(1)) } }
    : { ...base, track: { ...t0, bankSmooth: Number(variant.slice(1)) } };
  let ai: AiDriver | null = null;
  const s: Session = new Session(RAPIER, { course, player: CAR_PRESETS[2], opponents: [], laps: 2, mode: 'attack' }, (dt, v): Controls => {
    ai ??= new AiDriver(s.course, v, 0.88, 0);
    return ai.update(dt, s.pw.vehicles);
  });
  const v = s.player!.vehicle, dt = s.pw.dt, n = s.course.path.length;
  let prevVy = 0, prevDist = v.wheels.map((w) => w.dist);
  let sA = 0, sR = 0, sS = 0, cnt = 0;
  const bins = new Float64Array(50), bc = new Float64Array(50);
  for (let k = 0; k < 240 * 200; k++) {
    s.step(dt);
    if (s.race.state !== 'running' || s.race.time < 8) { prevVy = v.linvel.y; prevDist = v.wheels.map((w) => w.dist); continue; }
    // 上下の加速度（車体の上の向き）。重力の分（9.81 × up.y）を引く
    const ay = (v.linvel.y - prevVy) / dt;
    prevVy = v.linvel.y;
    const aUp = ay + 9.81 * (1 - v.up.y);
    const roll = v.angvel.dot(v.fwd), pitch = v.angvel.dot(v.right);
    let sv = 0;
    v.wheels.forEach((w, i) => { sv += ((w.dist - prevDist[i]) / dt) ** 2; });
    prevDist = v.wheels.map((w) => w.dist);
    sA += aUp * aUp; sR += roll * roll + pitch * pitch; sS += sv / 4; cnt++;
    const b = Math.floor((s.player!.idx / n) * 50) % 50;
    bins[b] += aUp * aUp; bc[b]++;
    if (s.attack!.laps.length >= 2) break;
  }
  const worst = [...bins].map((x, i) => [i, Math.sqrt(x / Math.max(1, bc[i]))]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`${spec.padEnd(18)} 上下の加速度 RMS ${(Math.sqrt(sA / cnt) / 9.81).toFixed(3)} g  ロールとピッチ ${(Math.sqrt(sR / cnt) * 180 / Math.PI).toFixed(1)}°/s  サスの速さ ${Math.sqrt(sS / cnt).toFixed(3)} m/s  大きい所 ${worst.map(([i, g]) => `${(i as number) * 2}%（${((g as number) / 9.81).toFixed(2)} g）`).join('、')}`);
  s.dispose();
}
