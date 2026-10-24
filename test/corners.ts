// コースの曲がりの一覧（副操縦士が知らせるもの）を出す。実行: npx tsx test/corners.ts [id ...]
import { findCorners, cornerName } from '../src/game/codriver';
import { buildCourse } from '../src/sim/course';
import { COURSES } from '../src/sim/courses';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['suzuka', 'monaco', 'spa', 'daytona'];
for (const id of ids) {
  const c = buildCourse(COURSES.find((x) => x.id === id)!);
  const cs = findCorners(c);
  const ds = c.length / c.path.length;
  console.log(`== ${id}（${(c.length / 1000).toFixed(2)} km）曲がり ${cs.length}`);
  console.log(cs.map((k) => `${(k.start * ds).toFixed(0)} m ${cornerName(k)}（${k.angle.toFixed(0)}°、R ${k.minR.toFixed(0)}）`).join(' / '));
}
