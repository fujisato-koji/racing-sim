// スタート付近で止まる車の前に何があるかを調べる（確認用）
import RAPIER from '@dimforge/rapier3d-compat';
import { Session } from '../src/game/session';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
await RAPIER.init();
const course = COURSES.find((c) => c.id === (process.argv[2] ?? 'hungaroring'))!;
const s = new Session(RAPIER, { course, player: null, opponents: CAR_PRESETS, laps: 1 }, () => ({ steer: 0, throttle: 0, brake: 0 }));
for (let i = 0; i < 240 * 10; i++) s.step(s.pw.dt);
const n = s.course.path.length;
for (const r of s.racers) {
  const v = r.vehicle;
  const hits: string[] = [];
  for (const dy of [-0.2, 0, 0.3]) {
    const o = v.pos.clone().addScaledVector(v.up, dy).addScaledVector(v.fwd, -v.geom.bodyFrontZ + 0.05);
    const ray = new RAPIER.Ray(o, v.fwd);
    const h = s.pw.world.castRay(ray, 4, true, undefined, undefined, undefined, v.body);
    if (h) {
      const c = h.collider;
      const surf = s.pw.surfaceOf.get(c.handle);
      const other = s.pw.vehicles.find((x) => x !== v && x.body.handle === c.parent()?.handle);
      hits.push(`高さ ${dy}: ${h.timeOfImpact.toFixed(2)} m 先に ${other ? `車（${other.p.name}）` : surf ? `${surf.name}（${c.shape.type === RAPIER.ShapeType.Cuboid ? '箱' : c.shape.type === RAPIER.ShapeType.TriMesh ? '三角形の網' : c.shape.type}）` : 'その他'}`);
    } else hits.push(`高さ ${dy}: なし`);
  }
  console.log(`${r.vehicle.p.name}: 位置 ${(r.idx / n).toFixed(4)} 速さ ${v.speed.toFixed(1)} ｜ ${hits.join(' ｜ ')}`);
}
// スタートライン付近の路面と地形の高さ
const p0 = s.course.path[0];
console.log(`スタートの点 y=${p0.y.toFixed(2)}、地形の高さ ${s.course.heightAt(p0.x + p0.lx * 3, p0.z + p0.lz * 3).toFixed(2)}（3 m 左）`);
for (const k of [-30, -20, -10, -5, 0, 5, 10]) { const p = s.course.path[(k + n) % n]; console.log(`  ${k} m: y=${p.y.toFixed(2)}`); }
