// 取り込んだ実在のサーキット（tools/fetch-tracks.ts が作った JSON）をコースの定義にする。
import type { CourseCategory, CourseDef } from '../course';
import { terrainAttribution } from './terrain-credit';
import baku from './baku.json';
import brandsHatch from './brands-hatch.json';
import bristol from './bristol.json';
import charlotte from './charlotte.json';
import daytona from './daytona.json';
import fuji from './fuji.json';
import hungaroring from './hungaroring.json';
import indianapolis from './indianapolis.json';
import lagunaSeca from './laguna-seca.json';
import macau from './macau.json';
import melbourne from './melbourne.json';
import monaco from './monaco.json';
import monza from './monza.json';
import silverstone from './silverstone.json';
import singapore from './singapore.json';
import spa from './spa.json';
import suzuka from './suzuka.json';
import talladega from './talladega.json';
import tsukuba from './tsukuba.json';
import zandvoort from './zandvoort.json';

interface TrackJson {
  id: string;
  name: string;
  nameJa: string;
  country: string;
  type: string;
  width: number;
  laps: number;
  lengthOfficial: number;
  length: number;
  banking: { turns: number; straights: number } | null;
  points: number[];
  elev: number[];
  bridge: number[];
  source: { elevation: string; retrieved: string };
}

const ORDER: TrackJson[] = [
  suzuka, spa, monza, silverstone, fuji,
  zandvoort, brandsHatch, hungaroring, tsukuba, lagunaSeca,
  monaco, macau, singapore, baku, melbourne,
  indianapolis, daytona, talladega, charlotte, bristol,
] as TrackJson[];

/** 周回の値を前後 w 点で 2 回ならす（三角の重み） */
function smoothCyclic(a: number[], w: number) {
  const n = a.length;
  let cur = a.slice();
  for (let pass = 0; pass < 2; pass++) {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -w; k <= w; k++) s += cur[((i + k) % n + n) % n];
      out[i] = s / (2 * w + 1);
    }
    cur = out;
  }
  return cur;
}

const TYPE_NAME: Record<string, string> = { international: 'Grand Prix', technical: 'Technical', street: 'Street', oval: 'Oval' };

function toCourse(j: TrackJson): CourseDef {
  const pts: [number, number][] = [];
  for (let i = 0; i < j.points.length; i += 2) pts.push([j.points[i], j.points[i + 1]]);
  // 標高は制御点ごとの値を、周回に対する割合の位置に置く
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] + Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  const street = j.type === 'street', oval = j.type === 'oval';
  // オーバルは実際には平らに舗装されているので、標高データの 20〜100 m の小さな波（約 0.2 m）をならす。
  // 250 km/h ではこの波が車をずっと上下に揺らす（test/ride-rough.ts）。大きな形（直線と曲がりの高さの違い）は残す
  const elev = oval ? smoothCyclic(j.elev, Math.round(90 / (total / j.elev.length))) : j.elev;
  const elevation: [number, number][] = elev.map((e, i) => [cum[i] / total, e]);
  const rise = Math.max(...j.elev) - Math.min(...j.elev);
  return {
    id: j.id,
    name: j.name,
    nameEn: undefined,
    rise,
    description: `${TYPE_NAME[j.type]}, ${j.country}, ${(j.lengthOfficial / 1000).toFixed(3)} km lap, ${rise.toFixed(0)} m elevation change${j.banking ? `, ${j.banking.turns}° banking` : ''}`,
    category: j.type as CourseCategory,
    country: j.country,
    lengthOfficial: j.lengthOfficial,
    ground: street ? 'concrete' : 'grass',
    cell: 3,
    terrainFromTrack: true,
    track: {
      points: pts,
      width: j.width,
      surface: 'asphalt',
      shoulder: street ? 'concrete' : oval ? 'asphalt' : 'grass',
      elevation,
      banking: j.banking ?? undefined,
      bridges: j.bridge,
      auto: oval ? 'oval' : street ? 'street' : 'circuit',
    },
    laps: j.laps,
    credit: `Track shape and buildings © OpenStreetMap contributors (ODbL), elevation: ${j.source.elevation.replace('国土地理院 標高 API（地理院タイル DEM）', 'GSI Japan elevation API (GSI tiles DEM)')}, retrieved ${j.source.retrieved}. Scenery terrain: Terrain Tiles (${terrainAttribution(j.country).join('; ')})`,
  };
}

export const REAL_COURSES: CourseDef[] = ORDER.map(toCourse);
