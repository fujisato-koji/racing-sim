// キーボードで短く押したとき、長く押したときに、どれだけ曲がり、どれだけ速さが落ち、横滑り防止と空転防止がどれだけ働くかを測る。
// 実行: npx tsx test/keyboard-tap.ts [車 id ...]
import RAPIER from '@dimforge/rapier3d-compat';
import { KeyboardInput } from '../src/game/input';
import { CAR_PRESETS } from '../src/sim/presets';
import { DEG, cloneParams } from '../src/sim/params';
import { SURFACES } from '../src/sim/surfaces';
import { Vehicle } from '../src/sim/vehicle';
import { PhysicsWorld } from '../src/sim/world';
import { gridMesh } from './grid';

await RAPIER.init();

class FakeWindow {
  private l = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(t: string, f: (e: unknown) => void) { (this.l.get(t) ?? this.l.set(t, []).get(t)!).push(f); }
  key(type: 'keydown' | 'keyup', code: string) { for (const f of this.l.get(type) ?? []) f({ code, repeat: false, preventDefault() {} }); }
}

export interface TapResult { yawDeg: number; dKmh: number; escTime: number; tcsMin: number; maxLatG: number; maxSteerDeg: number; maxDecelG: number }

/** kmh で真っすぐ走り、アクセルを踏んだまま右を hold 秒押して離し、合わせて 2 秒見る */
export function tap(carId: string, kmh: number, hold: number): TapResult {
  const pw = new PhysicsWorld(RAPIER);
  const g = gridMesh(-1500, 1500, -2500, 100, 5, () => 0);
  pw.addStaticMesh(g.v, g.i, SURFACES.asphalt);
  const p = cloneParams(CAR_PRESETS.find((c) => c.id === carId)!);
  const v = new Vehicle(pw, p, { x: 0, y: 0, z: 50, yaw: 0 });
  pw.vehicles.push(v);
  const win = new FakeWindow();
  const kb = new KeyboardInput(win as unknown as Window);
  for (let i = 0; i < 240 * 40 && v.speed * 3.6 < kmh; i++) { v.controls = { steer: 0, throttle: 1, brake: 0 }; pw.step(); }
  // 一定速にそろえる（アクセルは押したまま扱いにして、速さを保つ分だけ）
  for (let i = 0; i < 240; i++) { v.controls = { steer: 0, throttle: Math.max(0, Math.min(1, (kmh / 3.6 - v.speed) * 0.4 + 0.3)), brake: 0 }; pw.step(); }
  const thr = Math.max(0.2, Math.min(1, v.controls.throttle));
  const yaw0 = Math.atan2(-v.fwd.x, -v.fwd.z), v0 = v.speed;
  win.key('keydown', 'ArrowRight');
  let t = 0, released = false, escTime = 0, tcsMin = 1, maxLat = 0, maxSteer = 0, maxDec = 0, prev = v.speed;
  while (t < 2) {
    if (!released && t >= hold) { win.key('keyup', 'ArrowRight'); released = true; }
    const k = kb.update(pw.dt, v.speed);
    v.controls = { steer: k.steer, throttle: thr, brake: 0 };
    pw.step();
    t += pw.dt;
    if (v.escActive) escTime += pw.dt;
    tcsMin = Math.min(tcsMin, v.throttleOut / thr);
    maxLat = Math.max(maxLat, Math.abs(v.speed * v.angvel.y) / 9.81);
    maxSteer = Math.max(maxSteer, Math.abs(v.controls.steer) * v.steerLimit / DEG);
    maxDec = Math.max(maxDec, -(v.speed - prev) / pw.dt / 9.81);
    prev = v.speed;
  }
  let dyaw = Math.atan2(-v.fwd.x, -v.fwd.z) - yaw0;
  while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  pw.free();
  return { yawDeg: Math.abs(dyaw) / DEG, dKmh: (v.speed - v0) * 3.6, escTime, tcsMin, maxLatG: maxLat, maxSteerDeg: maxSteer, maxDecelG: maxDec };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('keyboard-tap.ts')) {
  const cars = process.argv.slice(2).length ? process.argv.slice(2) : ['hatch', 'fr-sport', 'mr-super'];
  for (const car of cars) {
    console.log(`== ${CAR_PRESETS.find((c) => c.id === car)!.name}`);
    for (const kmh of [80, 150]) for (const hold of [0.12, 0.3, 1.0]) {
      const r = tap(car, kmh, hold);
      console.log(`${String(kmh).padStart(4)} km/h ${hold.toFixed(2)} 秒  向き ${r.yawDeg.toFixed(1).padStart(5)}°  速さ ${r.dKmh.toFixed(1).padStart(6)} km/h  減速 最大 ${r.maxDecelG.toFixed(2)} g  横 G ${r.maxLatG.toFixed(2)}  切れ角 ${r.maxSteerDeg.toFixed(1)}°  ESC ${r.escTime.toFixed(2)} 秒  アクセルの絞り ${(r.tcsMin * 100).toFixed(0)}%`);
    }
  }
}
