// 物理の検算。画面なしで車を走らせ、見積りと比べる。
// 実行: npm run check
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_PRESETS } from '../src/sim/presets';
import type { CarParams } from '../src/sim/params';
import { G, cloneParams, estimateTopSpeed } from '../src/sim/params';
import { SURFACES } from '../src/sim/surfaces';
import { Vehicle } from '../src/sim/vehicle';
import { PhysicsWorld } from '../src/sim/world';
import { gridMesh } from './grid';

await RAPIER.init();

let failures = 0;
function report(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}: ${detail}`);
}

/** 傾き slopeDeg（-z に向かって上り）の地面。最高速を測るので -z 方向に長くとる */
function makeWorld(slopeDeg = 0) {
  const pw = new PhysicsWorld(RAPIER);
  const t = Math.tan((slopeDeg * Math.PI) / 180);
  const g = slopeDeg === 0 ? gridMesh(-200, 200, -9000, 60, 5, () => 0) : gridMesh(-40, 40, -60, 60, 5, (_x, z) => -z * t);
  pw.addStaticMesh(g.v, g.i, SURFACES.asphalt);
  return pw;
}

function spawn(pw: PhysicsWorld, p: CarParams, y = 0) {
  const v = new Vehicle(pw, p, { x: 0, y, z: 0, yaw: 0 });
  pw.vehicles.push(v);
  return v;
}

function run(pw: PhysicsWorld, seconds: number, each?: (t: number) => boolean | void) {
  const n = Math.round(seconds / pw.dt);
  for (let i = 0; i < n; i++) {
    pw.step();
    if (each && each(pw.time)) return;
  }
}

for (const preset of CAR_PRESETS) {
  const p = cloneParams(preset);
  console.log(`\n== ${p.name}`);

  // 1. 停車：何もしないで揺れが収まるか
  {
    const pw = makeWorld();
    const v = spawn(pw, p);
    run(pw, 2);
    let maxV = 0;
    run(pw, 3, () => { maxV = Math.max(maxV, v.linvel.length()); });
    report('停車時の揺れ', maxV < 0.05, `最大速度 ${maxV.toFixed(4)} m/s`);
    pw.free();
  }

  // 2. 最高速と 0-100 km/h
  {
    const pw = makeWorld();
    const v = spawn(pw, p);
    run(pw, 1);
    v.controls = { steer: 0, throttle: 1, brake: 0 };
    let t100 = NaN;
    const t0 = pw.time;
    let best = 0, lastBest = 0, lastImprove = 0;
    run(pw, 240, (t) => {
      const kmh = v.speed * 3.6;
      if (isNaN(t100) && kmh >= 100) t100 = t - t0;
      if (kmh > best + 0.05) { best = kmh; }
      if (best - lastBest > 0.5) { lastBest = best; lastImprove = t; }
      return t - lastImprove > 15;
    });
    const est = estimateTopSpeed(p) * 3.6;
    const yawDeg = (Math.abs(Math.atan2(-v.fwd.x, -v.fwd.z)) * 180) / Math.PI;
    report('最高速', Math.abs(best - est) / est < 0.06, `計算 ${best.toFixed(1)} km/h、見積り ${est.toFixed(1)} km/h、ギア ${v.gear}、${v.rpm.toFixed(0)} rpm`);
    report('0-100 km/h', t100 > 2 && t100 < 25, `${t100.toFixed(2)} s`);
    report('直進性', yawDeg < 1.5, `向きの変化 ${yawDeg.toFixed(2)}°（${(-v.pos.z / 1000).toFixed(1)} km 走って横に ${v.pos.x.toFixed(1)} m）`);
    pw.free();
  }

  // 3. 100 km/h からの制動
  {
    const pw = makeWorld();
    const v = spawn(pw, p);
    run(pw, 1);
    v.controls = { steer: 0, throttle: 1, brake: 0 };
    run(pw, 60, () => v.speed * 3.6 >= 100);
    v.controls = { steer: 0, throttle: 0, brake: 1 };
    const z0 = v.pos.z, v0 = v.speed;
    run(pw, 20, () => v.speed < 0.3);
    const dist = Math.abs(v.pos.z - z0);
    const ideal = (v0 * v0) / (2 * p.tire.mu * G);
    report('制動距離', dist > ideal * 0.85 && dist < ideal * 1.5, `${dist.toFixed(1)} m（μ だけで決まる理想 ${ideal.toFixed(1)} m、比 ${(dist / ideal).toFixed(2)}）`);
    pw.free();
  }

  // 4. 15° の坂でブレーキを踏んで止まっていられるか
  {
    const pw = makeWorld(15);
    const v = spawn(pw, p, 0);
    v.hold = true;
    run(pw, 2);
    const z0 = v.pos.z;
    run(pw, 5);
    const d = Math.abs(v.pos.z - z0);
    report('坂での停車', d < 0.05, `5 秒で ${(d * 100).toFixed(2)} cm`);
    pw.free();
  }
}

console.log(failures === 0 ? '\nすべて通過' : `\n${failures} 件が範囲外`);
process.exit(failures === 0 ? 0 : 1);
