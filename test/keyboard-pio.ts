// キーボードの操縦の揺れ（ジグザグ）の検算。人の操作を「この先の点が左にずれていたら左キーを押し、戻ったら離す（0.2 秒遅れて）」と置き、
// 速さは AI に任せて、オリジナルの舗装サーキットを 1 周走らせる。切れ角を直接動かす作りと、曲がり具合で操る作り（補助）を比べる。
// 実行: npx tsx test/keyboard-pio.ts [車 id] [コース id]
import RAPIER from '@dimforge/rapier3d-compat';
import { KeyboardInput } from '../src/game/input';
import { YawSteer } from '../src/game/steer-assist';
import { Session } from '../src/game/session';
import { AiDriver } from '../src/sim/ai';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
import type { Controls } from '../src/sim/vehicle';

await RAPIER.init();
class FakeWindow {
  private l = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(t: string, f: (e: unknown) => void) { (this.l.get(t) ?? this.l.set(t, []).get(t)!).push(f); }
  key(type: 'keydown' | 'keyup', code: string) { for (const f of this.l.get(type) ?? []) f({ code, repeat: false, preventDefault() {} }); }
}
const carId = process.argv[2] ?? 'fr-sport', courseId = process.argv[3] ?? 'circuit';
const course = COURSES.find((c) => c.id === courseId)!;
const car = CAR_PRESETS.find((c) => c.id === carId)!;

function run(assisted: boolean, delay: number, ramp?: [number, number], curve?: number, carP = car) {
  const win = new FakeWindow();
  const kb = new KeyboardInput(win as unknown as Window);
  kb.assisted = assisted;
  if (ramp) kb.assistRamp = ramp;
  if (curve) kb.assistCurve = curve;
  const yaw = new YawSteer();
  let ai: AiDriver | null = null;
  let left = false, right = false;
  const hist: number[] = [];
  let switches = 0, sumLat = 0, n = 0, maxLat = 0, off = 0, wasOff = false;
  const s: Session = new Session(RAPIER, { course, player: carP, opponents: [], laps: 1, mode: 'race' }, (dt, v): Controls => {
    ai ??= new AiDriver(s.course, v, 0.85, 0);
    const auto = ai.update(dt, s.pw.vehicles);
    // 人：先の点への向きのずれ（左が正）を、delay 秒遅れで見てキーを押す、離す
    const path = s.course.path, N = path.length, r = s.player!;
    const look = Math.max(10, v.speed * 0.9);
    const q = path[(r.idx + Math.round(look / (s.course.length / N))) % N];
    const dx = q.x - v.pos.x, dz = q.z - v.pos.z;
    const ang = Math.atan2(-(dx * v.right.x + dz * v.right.z), dx * v.fwd.x + dz * v.fwd.z) * 180 / Math.PI;
    hist.push(ang);
    const seen = hist.length > delay / dt ? hist[hist.length - 1 - Math.round(delay / dt)] : 0;
    // HUMAN=0 のときは人がキーを押さない
    const on = process.env.HUMAN === '0' ? 1e9 : 2.5, offTh = 0.6;
    const wantL = left ? seen > offTh : seen > on, wantR = right ? seen < -offTh : seen < -on;
    if (wantL !== left) { win.key(wantL ? 'keydown' : 'keyup', 'ArrowLeft'); left = wantL; switches++; }
    if (wantR !== right) { win.key(wantR ? 'keydown' : 'keyup', 'ArrowRight'); right = wantR; switches++; }
    const k = kb.update(dt, v.speed);
    const steer = assisted ? yaw.update(dt, k.steer, v) : k.steer;
    // 道からの横のずれ
    const p = path[r.idx];
    const lat = (v.pos.x - p.x) * p.lx + (v.pos.z - p.z) * p.lz;
    if (s.race.state === 'running') {
      sumLat += lat * lat; n++; maxLat = Math.max(maxLat, Math.abs(lat));
      const isOff = Math.abs(lat) > s.course.width / 2 + 1;
      if (isOff && !wasOff) off++;
      wasOff = isOff;
    }
    return { steer, throttle: auto.throttle, brake: auto.brake };
  });
  const dt = s.pw.dt;
  let steps = 0;
  while (s.player!.laps < 1 && steps < 240 * 400) { s.step(dt); steps++; }
  const time = s.player!.laps >= 1 ? s.player!.lastLap : NaN;
  s.dispose();
  return { rms: Math.sqrt(sumLat / Math.max(1, n)), maxLat, off, switches, time };
}

if (process.env.DETAIL) {
  const cars = ['hatch', 'fr-sport', 'mr-super'].map((id) => CAR_PRESETS.find((c) => c.id === id)!);
  for (const cp of cars) for (const delay of [0.15, 0.25, 0.35]) {
    const r = run(process.env.DETAIL !== 'direct', delay, [0.25, 0.7], 1.5, cp);
    console.log(`${cp.id.padEnd(9)} 遅れ ${delay}  コース外 ${r.off}、横のずれ RMS ${r.rms.toFixed(2)} m、最大 ${r.maxLat.toFixed(1)} m、押し離し ${r.switches}、周 ${isFinite(r.time) ? r.time.toFixed(1) : '走りきれない'}`);
    if (process.env.HUMAN === '0') break;
  }
  process.exit(0);
}
if (process.env.SWEEP) {
  // 補助ありの立ち上がりと曲線を変えて、遅れ 3 通り × 車 3 台のコース外の合計と横のずれを比べる
  const cars = ['hatch', 'fr-sport', 'mr-super'].map((id) => CAR_PRESETS.find((c) => c.id === id)!);
  const sets: [[number, number], number][] = [[[0.25, 0.7], 1.5], [[0.35, 1.0], 1.5], [[0.4, 1.3], 1.6], [[0.5, 1.6], 1.8]];
  for (const [ramp, curve] of sets) {
    let off = 0, rms = 0, unfinished = 0;
    for (const cp of cars) for (const delay of [0.15, 0.25, 0.35]) {
      const r = run(true, delay, ramp, curve, cp);
      off += r.off; rms += r.rms / 9; if (!isFinite(r.time)) unfinished++;
    }
    console.log(`いっぱいまで ${ramp[0]}〜${ramp[1]} 秒、曲線 ${curve}：コース外 ${off} 回、横のずれ RMS 平均 ${rms.toFixed(2)} m、走りきれない ${unfinished}`);
  }
  let off = 0, rms = 0, unfinished = 0;
  for (const cp of cars) for (const delay of [0.15, 0.25, 0.35]) { const r = run(false, delay, undefined, undefined, cp); off += r.off; rms += r.rms / 9; if (!isFinite(r.time)) unfinished++; }
  console.log(`補助なし（今の切れ角）：コース外 ${off} 回、横のずれ RMS 平均 ${rms.toFixed(2)} m、走りきれない ${unfinished}`);
  process.exit(0);
}
console.log(`== ${car.name}、${course.name}`);
for (const delay of [0.15, 0.25, 0.35]) for (const assisted of [false, true]) {
  const r = run(assisted, delay);
  console.log(`遅れ ${delay.toFixed(2)} 秒  ${assisted ? '補助あり（曲がり具合）' : '補助なし（切れ角）  '}  横のずれ RMS ${r.rms.toFixed(2)} m、最大 ${r.maxLat.toFixed(1)} m、コース外 ${r.off} 回、キーの押し離し ${r.switches} 回、周 ${isFinite(r.time) ? r.time.toFixed(1) + ' 秒' : '走りきれない'}`);
}
