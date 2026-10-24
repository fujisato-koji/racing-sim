// キーボードで走らせたときの滑り方を測る。
// 実行: npx tsx test/keyboard-feel.ts [車 id]
import RAPIER from '@dimforge/rapier3d-compat';
import { KeyboardInput } from '../src/game/input';
import { CAR_PRESETS } from '../src/sim/presets';
import { DEG, cloneParams } from '../src/sim/params';
import { SURFACES } from '../src/sim/surfaces';
import { Vehicle } from '../src/sim/vehicle';
import { PhysicsWorld } from '../src/sim/world';
import { gridMesh } from './grid';

await RAPIER.init();

// window の代わり：キーを押す、離すを直接呼ぶ
class FakeWindow {
  private l = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(t: string, f: (e: unknown) => void) { (this.l.get(t) ?? this.l.set(t, []).get(t)!).push(f); }
  key(type: 'keydown' | 'keyup', code: string) { for (const f of this.l.get(type) ?? []) f({ code, repeat: false, preventDefault() {} }); }
}

interface Step { t: number; down?: string[]; up?: string[] }

function run(carId: string, kmh: number, script: Step[], duration: number, label: string) {
  const pw = new PhysicsWorld(RAPIER);
  const g = gridMesh(-600, 600, -900, 100, 5, () => 0);
  pw.addStaticMesh(g.v, g.i, SURFACES.asphalt);
  const p = cloneParams(CAR_PRESETS.find((c) => c.id === carId)!);
  const v = new Vehicle(pw, p, { x: 0, y: 0, z: 50, yaw: 0 });
  pw.vehicles.push(v);
  const win = new FakeWindow();
  const kb = new KeyboardInput(win as unknown as Window);
  // 目標の速さまでは真っすぐ一定速で走らせる（ここは人の操作ではない）
  for (let i = 0; i < 240 * 30 && v.speed * 3.6 < kmh; i++) { v.controls = { steer: 0, throttle: 1, brake: 0 }; pw.step(); }
  for (let i = 0; i < 240; i++) { v.controls = { steer: 0, throttle: Math.max(0, Math.min(1, (kmh / 3.6 - v.speed) * 0.4 + 0.25)), brake: 0 }; pw.step(); }
  let maxBeta = 0, maxAf = 0, maxAr = 0, maxLat = 0, maxSteerDeg = 0, minTcs = 1, spun = false;
  let t = 0, si = 0;
  let prevV = v.linvel.clone(), sumA = 0, nA = 0, maxA = 0;
  const peak = p.tire.peakAngleDeg;
  while (t < duration) {
    while (si < script.length && script[si].t <= t) {
      for (const k of script[si].down ?? []) win.key('keydown', k);
      for (const k of script[si].up ?? []) win.key('keyup', k);
      si++;
    }
    v.controls = kb.update(pw.dt, v.speed);
    pw.step();
    t += pw.dt;
    const vf = v.linvel.dot(v.fwd), vr = v.linvel.dot(v.right);
    const beta = Math.abs(Math.atan2(vr, Math.abs(vf))) / DEG;
    maxBeta = Math.max(maxBeta, beta);
    if (beta > 25) spun = true;
    const w = v.wheels;
    maxAf = Math.max(maxAf, Math.abs(Math.atan(w[0].tanAlpha)) / DEG, Math.abs(Math.atan(w[1].tanAlpha)) / DEG);
    maxAr = Math.max(maxAr, Math.abs(Math.atan(w[2].tanAlpha)) / DEG, Math.abs(Math.atan(w[3].tanAlpha)) / DEG);
    maxLat = Math.max(maxLat, Math.abs(v.speed * v.angvel.y) / 9.81);
    // 速度の変化から求めた、進む向きに直角な加速度（向心加速度）
    const acc = v.linvel.clone().sub(prevV).divideScalar(pw.dt);
    prevV = v.linvel.clone();
    const dir = v.linvel.clone().setY(0).normalize();
    const cent = Math.abs(acc.x * -dir.z + acc.z * dir.x) / 9.81;
    maxA = Math.max(maxA, cent);
    if (t > 1.0 && t < 1.5) { sumA += cent; nA++; }
    maxSteerDeg = Math.max(maxSteerDeg, Math.abs(v.controls.steer) * v.steerLimit / DEG);
    minTcs = Math.min(minTcs, v.throttleOut / Math.max(0.01, v.controls.throttle));
  }
  console.log(`${label.padEnd(26)} 横滑り角 最大 ${maxBeta.toFixed(1).padStart(5)}°${spun ? '（スピン）' : ''}  前の滑り角 ${maxAf.toFixed(1)}° 後 ${maxAr.toFixed(1)}°（最大摩擦は ${peak}°）  切れ角 ${maxSteerDeg.toFixed(1)}°  速さ×ヨーレート ${maxLat.toFixed(2)} g  向心加速度 最大 ${maxA.toFixed(2)} g、1.0〜1.5 秒の平均 ${(sumA / Math.max(1, nA)).toFixed(2)} g`);
  pw.free();
}

const car = process.argv[2] ?? 'fr-sport';
console.log(`== ${CAR_PRESETS.find((c) => c.id === car)!.name}`);
for (const kmh of [60, 100]) {
  run(car, kmh, [{ t: 0, down: ['ArrowUp', 'ArrowRight'] }, { t: 0.6, up: ['ArrowRight'] }], 3, `${kmh} km/h アクセル踏んだまま 0.6 秒切る`);
  run(car, kmh, [{ t: 0, down: ['ArrowRight'] }, { t: 0.6, up: ['ArrowRight'] }], 3, `${kmh} km/h アクセル離して 0.6 秒切る`);
  run(car, kmh, [{ t: 0, down: ['ArrowUp', 'ArrowRight'] }, { t: 1.5, up: ['ArrowRight'] }], 3, `${kmh} km/h アクセル踏んだまま 1.5 秒切る`);
  run(car, kmh, [{ t: 0, down: ['ArrowUp'] }, { t: 0, down: ['ArrowRight'] }, { t: 0.4, up: ['ArrowRight'], down: ['ArrowLeft'] }, { t: 0.8, up: ['ArrowLeft'] }], 3, `${kmh} km/h 右左と切り返す`);
}
