// スマホの傾きで直線を走るときの、ふらつきの大きさを比べる（確認用）。
// 人の操作は「15 m 先の点が中央に来るように、0.25 s 遅れて傾ける」と置き、
// そこへ手のゆっくりしたぶれ（2°、0.5 s で入れ替わる揺れ）、センサーの揺れ（0.4°）、手の震え（8 Hz、0.3°）を足す。
// 実行: npx tsx test/tilt-wobble.ts [車 id]
import RAPIER from '@dimforge/rapier3d-compat';
import { TiltSteering } from '../src/game/tilt';
import { YawSteer } from '../src/game/steer-assist';
import { CAR_PRESETS } from '../src/sim/presets';
import { cloneParams } from '../src/sim/params';
import { SURFACES } from '../src/sim/surfaces';
import { Vehicle } from '../src/sim/vehicle';
import { PhysicsWorld } from '../src/sim/world';
import { gridMesh } from './grid';

await RAPIER.init();

function gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

/** 今の作り：遊び 1.5°、直線、0.05 s の一次遅れ */
class OldTilt {
  private f = 0;
  private a = 0;
  push(a: number) { this.a = a; }
  update(dt: number) {
    const x = Math.sign(this.a) * Math.max(0, Math.abs(this.a) - 1.5) / (45 - 1.5);
    this.f += (Math.max(-1, Math.min(1, x)) - this.f) * Math.min(1, dt / 0.05);
    return this.f;
  }
}

function run(carId: string, kmh: number, mode: 'old' | 'new', driver: boolean) {
  const pw = new PhysicsWorld(RAPIER);
  const g = gridMesh(-60, 60, -1500, 100, 5, () => 0);
  pw.addStaticMesh(g.v, g.i, SURFACES.asphalt);
  const v = new Vehicle(pw, cloneParams(CAR_PRESETS.find((c) => c.id === carId)!), { x: 0, y: 0, z: 50, yaw: 0 });
  pw.vehicles.push(v);
  // 目標の速さまで真っすぐ加速
  for (let i = 0; i < 240 * 30 && v.speed * 3.6 < kmh; i++) { v.controls = { steer: 0, throttle: 1, brake: 0 }; pw.step(); }
  const oldT = new OldTilt(), newT = new TiltSteering();
  const yaw = new YawSteer();
  let sway = 0;
  const delay: number[] = [];
  let t = 0, nextSensor = 0, sumY = 0, sumR = 0, sumA = 0, n = 0, maxY = 0;
  const x0 = v.pos.x;
  for (let i = 0; i < 240 * 20; i++) {
    t += pw.dt;
    if (t >= nextSensor) {
      nextSensor += 1 / 60;
      // 人の操作：15 m 先の点のずれに比例して傾ける（0.25 s 遅れ）
      const heading = Math.atan2(v.fwd.x, -v.fwd.z);
      const e = (v.pos.x - x0) + 15 * heading;
      delay.push(driver ? -4 * e : 0);
      const cmd = delay.length > 15 ? delay[delay.length - 16] : 0;
      // 0.5 s で入れ替わる揺れ（標準偏差 2°）
      const k = 1 / 60 / 0.5;
      sway += -k * sway + 2 * Math.sqrt(2 * k) * gauss();
      const a = Math.max(-45, Math.min(45, cmd)) + sway + 0.4 * gauss() + 0.3 * Math.sin(2 * Math.PI * 8 * t);
      if (mode === 'old') oldT.push(a); else newT.push(a, t);
    }
    const raw = mode === 'old' ? oldT.update(pw.dt) : newT.steer(v.speed * 3.6);
    // ASSIST=1 のときは、新しい方を曲がり具合の補助に通す（今の作りと比べる）
    const steer = mode === 'new' && assist ? yaw.update(pw.dt, raw, v) : raw;
    const err = kmh / 3.6 - v.speed;
    v.controls = { steer, throttle: Math.max(0, Math.min(1, err * 0.4 + 0.3)), brake: 0 };
    pw.step();
    if (t > 4) {
      const y = v.pos.x - x0;
      sumY += y * y; sumR += v.angvel.y ** 2; sumA += (v.speed * v.angvel.y) ** 2; n++;
      maxY = Math.max(maxY, Math.abs(y));
    }
  }
  pw.free();
  return { rmsY: Math.sqrt(sumY / n), rmsYawDeg: (Math.sqrt(sumR / n) * 180) / Math.PI, rmsG: Math.sqrt(sumA / n) / 9.81, maxY };
}

const car = process.argv[2] ?? 'fr-sport';
const assist = process.env.ASSIST === '1';
for (const kmh of [60, 100, 140]) {
  for (const driver of [false, true]) {
    const label = `${kmh} km/h ${driver ? '人が修正する' : 'ぶれだけ'}`.padEnd(18);
    const o = run(car, kmh, 'old', driver);
    const m = run(car, kmh, 'new', driver);
    console.log(`${label} 横 G RMS 今 ${o.rmsG.toFixed(3)} g（ずれ ${o.rmsY.toFixed(2)} m） → 新 ${m.rmsG.toFixed(3)} g（ずれ ${m.rmsY.toFixed(2)} m）`);
  }
}
