// 道の網の目が折り返している所（曲がりの半径が道の幅の半分より小さく、内側の縁が後ろへ戻る所）を調べる。
// 実行: npx tsx test/road-folds.ts [id ...]
import { buildCourse } from '../src/sim/course';
import { COURSES } from '../src/sim/courses';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : COURSES.filter((c) => c.track).map((c) => c.id);
for (const id of ids) {
  const c = buildCourse(COURSES.find((x) => x.id === id)!);
  const p = c.path, n = p.length, e = c.width / 2;
  const spots: string[] = [];
  let folds = 0, minR = Infinity, at = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    for (const side of [1, -1]) {
      const ax = a.x + a.lx * e * side, az = a.z + a.lz * e * side, bx = b.x + b.lx * e * side, bz = b.z + b.lz * e * side;
      if ((bx - ax) * a.tx + (bz - az) * a.tz < 0) { folds++; if (!spots.length || !spots[spots.length - 1].startsWith((i / n).toFixed(2))) spots.push(`${(i / n).toFixed(3)}`); }
    }
    const r = 1 / Math.max(1e-9, Math.abs(a.k));
    if (r < minR) { minR = r; at = i / n; }
  }
  if (folds > 0 || id === 'macau') console.log(`${id.padEnd(13)} 幅 ${c.width} m  最小半径 ${minR.toFixed(1)} m（${at.toFixed(3)}）  折り返し ${folds} か所  ${spots.slice(0, 8).join(' ')}`);
}
console.log('おわり');
