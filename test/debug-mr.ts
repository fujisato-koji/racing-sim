import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_PRESETS } from '../src/sim/presets';
import { cloneParams } from '../src/sim/params';
import { SURFACES } from '../src/sim/surfaces';
import { Vehicle } from '../src/sim/vehicle';
import { PhysicsWorld } from '../src/sim/world';
import { gridMesh } from './grid';
await RAPIER.init();
const idx = Number(process.argv[2] ?? 4);
const pw = new PhysicsWorld(RAPIER);
const g = gridMesh(-200, 200, -9000, 60, 5, () => 0);
pw.addStaticMesh(g.v, g.i, SURFACES.asphalt);
const v = new Vehicle(pw, cloneParams(CAR_PRESETS[idx]), { x: 0, y: 0, z: 0, yaw: 0 });
pw.vehicles.push(v);
for (let i = 0; i < 240; i++) pw.step();
v.controls = { steer: 0, throttle: 1, brake: 0 };
for (let s = 0; s < 60; s++) {
  let maxYr = 0;
  for (let i = 0; i < 240; i++) { pw.step(); maxYr = Math.max(maxYr, Math.abs(v.angvel.y)); }
  const yaw = Math.atan2(-v.fwd.x, -v.fwd.z) * 180 / Math.PI;
  const w = v.wheels;
  console.log(s + 1, 'kmh', (v.speed * 3.6).toFixed(1), 'x', v.pos.x.toFixed(2), 'yaw', yaw.toFixed(3), 'maxYawRate', maxYr.toFixed(4), 'gear', v.gear, 'fz', w.map(x => x.fz.toFixed(0)).join(','), 'fy', w.map(x => x.fy.toFixed(0)).join(','), 'kap', w.map(x => x.kappa.toFixed(3)).join(','));
}
