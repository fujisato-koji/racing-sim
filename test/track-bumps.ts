// コースの縦の起伏を調べる：高低差、最大の勾配、20〜100 m の短い波の大きさ（滑らかにした線からのずれ）、勾配の向きが変わる回数。
// 実行: npx tsx test/track-bumps.ts [id ...]
import { readFileSync, readdirSync } from 'node:fs';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync('src/sim/tracks').filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
for (const id of ids) {
  const j = JSON.parse(readFileSync(`src/sim/tracks/${id}.json`, 'utf8')) as { type: string; length: number; elev: number[] };
  const e = j.elev, n = e.length, step = j.length / n;
  const at = (i: number) => e[((i % n) + n) % n];
  // 200 m の移動平均からのずれ（短い波）
  const w = Math.max(1, Math.round(100 / step));
  let sum2 = 0, maxDev = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -w; k <= w; k++) s += at(i + k);
    const d = e[i] - s / (2 * w + 1);
    sum2 += d * d; maxDev = Math.max(maxDev, Math.abs(d));
  }
  let maxG = 0, flips = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const g = (at(i + 1) - e[i]) / step;
    maxG = Math.max(maxG, Math.abs(g));
    const sgn = Math.abs(g) < 0.004 ? 0 : Math.sign(g);
    if (sgn !== 0 && prev !== 0 && sgn !== prev) flips++;
    if (sgn !== 0) prev = sgn;
  }
  const rise = Math.max(...e) - Math.min(...e);
  console.log(`${id.padEnd(13)} ${j.type.padEnd(13)} 間隔 ${step.toFixed(1)} m  高低差 ${rise.toFixed(1)} m  最大勾配 ${(maxG * 100).toFixed(1)}%  短い波 RMS ${Math.sqrt(sum2 / n).toFixed(2)} m（最大 ${maxDev.toFixed(2)} m）  上り下りの入れ替わり ${flips} 回（1 km あたり ${(flips / (j.length / 1000)).toFixed(1)}）`);
}
