// コースとセッションを作る時間を測る（確認用）。実行: npx tsx test/prof-build.ts [コース id]
import { readFileSync } from 'node:fs';
import { buildCourse } from '../src/sim/course';
import { REAL_COURSES } from '../src/sim/tracks';
import { polarSampler } from '../src/sim/terrain-sampler';
const id = process.argv[2] ?? 'spa';
const def = REAL_COURSES.find((c) => c.id === id)!;
const data = JSON.parse(readFileSync(`src/sim/scenery/${id}.json`, 'utf8'));
let t = Date.now(); buildCourse(def); console.log('地形なし', Date.now() - t, 'ms');
t = Date.now(); const c = buildCourse(def, polarSampler(data)); console.log('地形あり', Date.now() - t, 'ms', 'セル', c.terrain.cell, c.terrain.nx, c.terrain.nz, '木', c.trees.length);
import RAPIER from '@dimforge/rapier3d-compat';
import { Session } from '../src/game/session';
import { CAR_PRESETS } from '../src/sim/presets';
await RAPIER.init();
t = Date.now();
new Session(RAPIER, { course: def, player: null, opponents: CAR_PRESETS, laps: 1, terrain: polarSampler(data) }, () => ({ steer: 0, throttle: 0, brake: 0 }));
console.log('セッション全体', Date.now() - t, 'ms');
