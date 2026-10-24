// 縁石と路面の三角形がすべて上を向いているか（確認用）
import { buildCourse } from '../src/sim/course';
import { COURSES } from '../src/sim/courses';
for (const def of COURSES) {
  const c = buildCourse(def);
  const check = (name: string, v: Float32Array, idx: Uint32Array) => {
    let down = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, d = idx[i + 2] * 3;
      const ux = v[b] - v[a], uz = v[b + 2] - v[a + 2], wx = v[d] - v[a], wz = v[d + 2] - v[a + 2];
      // 法線の y = uz*wx - ux*wz
      if (uz * wx - ux * wz < 0) down++;
    }
    console.log(`${def.name} ${name}: 三角形 ${idx.length / 3}、下向き ${down}`);
  };
  if (c.kerbs) check('縁石', c.kerbs.vertices, c.kerbs.indices);
  if (c.road) for (const p of c.road.parts) check(`路面(${p.surface})`, c.road.vertices, p.indices);
  if (c.shoulder) check('路肩', c.shoulder.vertices, c.shoulder.indices);
  console.log(`  木 ${c.trees.length}、建物 ${c.buildings.length}`);
}
