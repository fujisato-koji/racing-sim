// 一定の速さでハンドルを少しずつ切り、横加速度の最大を測る
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_PRESETS } from '../src/sim/presets';
import { cloneParams } from '../src/sim/params';
import { SURFACES } from '../src/sim/surfaces';
import { Vehicle } from '../src/sim/vehicle';
import { PhysicsWorld } from '../src/sim/world';
import { gridMesh } from './grid';
await RAPIER.init();
const speed = Number(process.argv[2] ?? 25);
for (const preset of CAR_PRESETS) {
  const pw = new PhysicsWorld(RAPIER);
  const g = gridMesh(-400, 400, -400, 400, 5, () => 0);
  pw.addStaticMesh(g.v, g.i, SURFACES.asphalt);
  const p = cloneParams(preset);
  p.assists.steerAssist = false;
  const v = new Vehicle(pw, p, { x: 0, y: 0, z: 300, yaw: 0 });
  pw.vehicles.push(v);
  let best = 0, bestSteer = 0, info = '';
  const T = 30;
  for (let i = 0; i < T * 240; i++) {
    const t = i / 240;
    const err = speed - v.speed;
    const steer = t < 4 ? 0 : Math.min(1, (t - 4) / (T - 4)) * 0.6;
    v.controls = { steer, throttle: Math.max(0, Math.min(1, err * 0.5 + 0.2)), brake: err < -2 ? 0.3 : 0 };
    pw.step();
    if (t > 5 && Math.abs(err) < 1.5) {
      const alat = Math.abs(v.speed * v.angvel.y) / 9.81;
      if (alat > best) {
        best = alat; bestSteer = steer;
        const w = v.wheels;
        info = `前の滑り角 ${(Math.atan(w[0].tanAlpha) * 57.3).toFixed(1)}°,${(Math.atan(w[1].tanAlpha) * 57.3).toFixed(1)}° 後 ${(Math.atan(w[2].tanAlpha) * 57.3).toFixed(1)}°,${(Math.atan(w[3].tanAlpha) * 57.3).toFixed(1)}° 荷重 ${w.map((x) => x.fz.toFixed(0)).join(',')}`;
      }
    }
  }
  console.log(`${p.name}: ${speed} m/s で最大 ${best.toFixed(2)} g（ハンドル ${(bestSteer * p.steer.maxAngleDeg).toFixed(1)}°）${info}`);
  pw.free();
}
