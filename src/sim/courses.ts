// コースのプリセット
import type { CourseDef } from './course';
import { REAL_COURSES } from './tracks';

const deg = (a: number) => (a * Math.PI) / 180;
const rampHeight = (length: number, angleDeg: number) => length * Math.tan(deg(angleDeg));

const slalom: [number, number][] = Array.from({ length: 11 }, (_, i) => [-90, 90 - i * 12]);
const coneWall: [number, number][] = Array.from({ length: 15 }, (_, i) => [-14 + i * 2, -30]);
const tireLine = Array.from({ length: 54 }, (_, i) => ({ x: 100, z: -20 + i * 0.75, count: 2 }));

const ORIGINAL: CourseDef[] = [
  {
    id: 'testfield',
    name: 'Proving Ground',
    description: 'A paved plaza with jump ramps (10, 15 and 20 degrees), gravel, sand, rocks, cones, a tire wall and a concrete wall. No laps, drive freely.',
    ground: 'grass',
    cell: 2.5,
    size: 480,
    // 先に書いた区画が優先
    patches: [
      { x: -70, z: -85, w: 70, d: 60, surface: 'gravel' },
      { x: 70, z: -85, w: 70, d: 60, surface: 'sand' },
      { x: 0, z: 0, w: 260, d: 260, surface: 'asphalt' },
    ],
    rockFields: [{ x: 75, z: 70, radius: 28, count: 45, size: 0.7, seed: 3 }],
    ramps: [
      { x: -30, z: 40, yaw: 0, length: 8, width: 5, height: rampHeight(8, 10) },
      { x: 0, z: 40, yaw: 0, length: 8, width: 5, height: rampHeight(8, 15) },
      { x: 30, z: 40, yaw: 0, length: 10, width: 5, height: rampHeight(10, 20) },
    ],
    cones: [...slalom, ...coneWall],
    tireStacks: tireLine,
    walls: [{ x: -115, z: 0, yaw: 0, length: 80 }],
    start: { x: 0, z: 110, yaw: 0 },
    laps: 0,
  },
  {
    id: 'circuit',
    name: 'Tarmac Circuit',
    description: 'About 1.9 km of tarmac. A small jump over a crest on the long straight, then a hairpin and a chicane. Tire barriers on the outside.',
    ground: 'grass',
    cell: 2.5,
    hills: { amp: 5, wave: 220 },
    track: {
      points: [
        [0, 200], [0, -100], [40, -220], [160, -290], [300, -250], [360, -150], [330, -80],
        [240, -110], [170, -60], [190, 40], [270, 100], [320, 210], [250, 320], [120, 350], [30, 300],
      ],
      width: 12,
      surface: 'asphalt',
      shoulder: 'grass',
      jumps: [{ at: 0.07, up: 30, height: 1.4, down: 45 }],
      barriers: [
        { from: 0.96, to: 0.12, side: 'both', kind: 'wall' },
        { from: 0.36, to: 0.39, side: 'outside', kind: 'tires' },
        { from: 0.45, to: 0.48, side: 'outside', kind: 'tires' },
        { from: 0.8, to: 0.83, side: 'outside', kind: 'tires' },
      ],
      cones: [[0.5, 5.5], [0.505, 5.5], [0.51, 5.5], [0.53, -5.5], [0.535, -5.5], [0.54, -5.5]],
    },
    laps: 3,
  },
  {
    id: 'rally',
    name: 'Rally (gravel)',
    description: 'About 2.1 km of gravel road. Over hills, through sand sections and rocky areas, with two jumps.',
    ground: 'grass',
    cell: 3,
    hills: { amp: 9, wave: 150 },
    track: {
      points: [
        [0, 250], [-20, 0], [-120, -180], [-40, -350], [150, -400], [320, -330], [300, -150],
        [400, 0], [360, 200], [220, 330], [80, 380],
      ],
      width: 9,
      surface: 'gravel',
      shoulder: 'grass',
      sections: [
        { from: 0.3, to: 0.38, surface: 'sand' },
        { from: 0.7, to: 0.76, surface: 'sand' },
      ],
      jumps: [
        { at: 0.18, up: 14, height: 2.2, down: 32 },
        { at: 0.55, up: 10, height: 1.5, down: 22 },
      ],
      barriers: [{ from: 0.97, to: 0.04, side: 'both', kind: 'wall' }],
    },
    rockFields: [
      { x: -100, z: -150, radius: 30, count: 40, size: 0.8, seed: 11 },
      { x: 330, z: -200, radius: 35, count: 50, size: 0.9, seed: 12 },
      { x: 300, z: 280, radius: 30, count: 40, size: 0.7, seed: 13 },
    ],
    laps: 2,
  },
];

export const COURSES: CourseDef[] = [...ORIGINAL.map((c) => ({ ...c, category: 'original' as const })), ...REAL_COURSES];
