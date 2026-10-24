// バンクの付いたコースで、路面の縁の高さの短い波を調べる（中心は滑らかでも、バンクの角度が揺れると縁が上下する）。
// 実行: npx tsx test/bank-bumps.ts [id ...]
import { buildCourse } from '../src/sim/course';
import { COURSES } from '../src/sim/courses';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['indianapolis', 'daytona', 'talladega', 'charlotte', 'bristol', 'suzuka', 'zandvoort'];
for (const id of ids) {
  const def = COURSES.find((c) => c.id === id)!;
  const c = buildCourse(def);
  const p = c.path, n = p.length, step = c.length / n, half = c.width / 2;
  const w = Math.max(1, Math.round(60 / step));
  const wave = (f: (i: number) => number) => {
    let s2 = 0, mx = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -w; k <= w; k++) s += f((i + k + n) % n);
      const d = f(i) - s / (2 * w + 1);
      s2 += d * d; mx = Math.max(mx, Math.abs(d));
    }
    return [Math.sqrt(s2 / n), mx];
  };
  const bankDeg = (i: number) => (p[i].bank * 180) / Math.PI;
  const outer = (i: number) => p[i].y + half * Math.abs(Math.tan(p[i].bank));
  const [bR, bM] = wave(bankDeg), [eR, eM] = wave(outer), [cR] = wave((i) => p[i].y);
  const maxBank = Math.max(...p.map((_q, i) => Math.abs(bankDeg(i))));
  let jumps = 0;
  for (let i = 0; i < n; i++) if (Math.abs(bankDeg((i + 1) % n) - bankDeg(i)) > 1.5) jumps++;
  console.log(`${id.padEnd(13)} 間隔 ${step.toFixed(1)} m 幅 ${c.width} m  最大バンク ${maxBank.toFixed(1)}°  バンクの揺れ RMS ${bR.toFixed(2)}°（最大 ${bM.toFixed(1)}°、隣と 1.5° 以上違う所 ${jumps}）  縁の高さの短い波 RMS ${eR.toFixed(2)} m（最大 ${eM.toFixed(2)} m）  中心 ${cR.toFixed(2)} m`);
}
