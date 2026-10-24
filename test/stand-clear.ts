// 観客席とピットが道と路肩にかかっていないかを全コースで調べる。
// 描画と同じ回し方（rotation.y = yaw + π/2 のあと π 回す）で足元の長方形を作り、2 m ごとの点から、
// 自分の直線も含めたすべての道の中心線までの距離を測る。道の幅の半分 + 路肩 2 m より近ければかかっている。
// 実行: npx tsx test/stand-clear.ts
import { buildCourse } from '../src/sim/course';
import { COURSES } from '../src/sim/courses';

let fail = 0;
for (const def of COURSES) {
  const c = buildCourse(def);
  const n = c.path.length;
  const rows: string[] = [];
  for (const b of c.buildings) {
    if (b.kind === 'block') continue;
    // 形の中の座標：長さは x、奥行きは z（ピットは −12〜0、観客席は屋根を含めて −0.8〜9.3）
    const [z0, z1] = b.kind === 'pit' ? [-12, 0] : [-0.8, 9.3];
    const th = b.yaw + Math.PI * 1.5, cs = Math.cos(th), sn = Math.sin(th);
    let minD = Infinity;
    for (let lx = -b.length / 2 - 1; lx <= b.length / 2 + 1.01; lx += 2) {
      for (let lz = z0; lz <= z1 + 0.01; lz += 2) {
        const x = b.x + lx * cs + lz * sn, z = b.z - lx * sn + lz * cs;
        for (let i = 0; i < n; i++) {
          const p = c.path[i], q = c.path[(i + 1) % n];
          const ex = q.x - p.x, ez = q.z - p.z, l2 = ex * ex + ez * ez || 1;
          const u = Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / l2));
          minD = Math.min(minD, Math.hypot(x - p.x - ex * u, z - p.z - ez * u));
        }
      }
    }
    const edge = minD - c.width / 2;
    const ok = edge > 2;
    if (!ok) fail++;
    rows.push(`${b.kind} ${b.length} m、道の縁から ${edge.toFixed(1)} m${ok ? '' : ' NG'}`);
  }
  console.log(`${def.id.padEnd(13)} ${rows.join('／') || '（なし）'}`);
}
console.log(fail === 0 ? 'すべて通過' : `${fail} 件がかかっている`);
process.exit(fail === 0 ? 0 : 1);
