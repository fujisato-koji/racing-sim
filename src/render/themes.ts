// コースごとの色のテーマ。空と太陽（時刻と天気）、霞、植生、木の種類、建物の色、差し色を 1 つの雰囲気にまとめる。
// 配色の決まり：
// - 彩度を抑えた地の色（植生、建物、壁）の上に、差し色を 1 色だけ置く（ピットの帯、スタンドの屋根の縁）
// - スタンドの席は差し色、明るい中間色、暗い中間色の 3 色だけ
// - 霞の色は空の地平の色と同じにして、遠くほどその色に寄せる
// - 太陽の向きは実際の方角（南が +z、東が +x）。南半球は昼の太陽が北
import type { SkySettings } from './sky';
import type { Palette, SceneryStyle } from './scenery';
import type { TreeKind } from './trees';

export interface CourseTheme extends SceneryStyle {
  /** 雰囲気の短い説明（コースのカードに出す。英語） */
  mood: string;
  sky: SkySettings;
  exposure: number;
  /** 木の種類の割合 */
  trees: Partial<Record<TreeKind, number>>;
  /** 木の色にかける色（秋の黄み、乾いた土地の灰色みなど） */
  treeTint: number;
  /** 差し色 */
  accent: number;
  /** スタンドの席の 3 色 */
  seats: [number, number, number];
  /** ピットとスタンドの躯体、壁の色 */
  structure: number;
  wall: number;
  /** 森：森にする濃さのしきい値（低いほど森が広い）、樹冠の高さ [m]、畑の境の並木の多さ（0〜1） */
  forest: { threshold: number; canopy: number; hedgerows: number };
}

const FACADES_MED = [0xe6d7b8, 0xdcc49a, 0xe9e0cf, 0xd1a886, 0xc9b38c, 0xf0e8da, 0xb98f6e];
const FACADES_GLASS = [0x7f95a8, 0x9aaebf, 0x6c8296, 0xb8c4cc, 0x8b9aa6, 0xd0d4d6];
const FACADES_ASIA = [0xc9c6bd, 0xb3b6b4, 0xe0d6b0, 0xd6b9a6, 0x9fa9ad, 0xe8e4da];

type Base = Omit<CourseTheme, 'sky' | 'forest'> & { sky: Partial<SkySettings> };

const SKY: SkySettings = {
  top: 0x2f6fc0, horizon: 0xc7dbeb, ground: 0x6b6f5a, sunElevation: 38, sunAzimuth: 135,
  sunColor: 0xfff1d8, sunIntensity: 2.8, ambient: 0.55, fogNear: 100, fogFar: 36000,
};

function theme(b: Base): CourseTheme {
  return { ...b, sky: { ...SKY, ...b.sky }, forest: { threshold: 0.5, canopy: 14, hedgerows: 0 } };
}

/** コースごとの森の様子 */
const FOREST: Record<string, Partial<CourseTheme['forest']>> = {
  testfield: { threshold: 0.55 }, circuit: { threshold: 0.42 }, rally: { threshold: 0.28, canopy: 17 },
  suzuka: { threshold: 0.42 }, spa: { threshold: 0.28, canopy: 18 }, monza: { threshold: 0.36, canopy: 16 },
  silverstone: { threshold: 0.7, hedgerows: 0.8 }, fuji: { threshold: 0.4, canopy: 16 },
  zandvoort: { threshold: 0.62, canopy: 7 }, 'brands-hatch': { threshold: 0.32, canopy: 16 }, hungaroring: { threshold: 0.5, hedgerows: 0.3 },
  tsukuba: { threshold: 0.58, hedgerows: 0.5 }, 'laguna-seca': { threshold: 0.55, canopy: 9 },
  monaco: { threshold: 0.6, canopy: 10 }, macau: { threshold: 0.42 }, singapore: { threshold: 0.55, canopy: 12 },
  baku: { threshold: 0.8, canopy: 8 }, melbourne: { threshold: 0.5, canopy: 13 },
  indianapolis: { threshold: 0.68, hedgerows: 0.6 }, daytona: { threshold: 0.55, canopy: 12 },
  talladega: { threshold: 0.32, canopy: 18 }, charlotte: { threshold: 0.45 }, bristol: { threshold: 0.32, canopy: 17 },
};

const pal = (p: Partial<Palette>) => p;

export const THEMES: Record<string, CourseTheme> = {
  // ---------------------------------------------------------------- オリジナル
  testfield: theme({
    mood: 'Midday on a highland proving ground', biome: 'temperate', mountains: 0.8,
    sky: { top: 0x3570bd, horizon: 0xcbdbe6, sunElevation: 50, sunAzimuth: 20 },
    exposure: 1.05, trees: { conifer: 0.7, broadleaf: 0.3 }, treeTint: 0xffffff,
    accent: 0xe0a020, seats: [0xe0a020, 0xd8d8d2, 0x5b6470], structure: 0xc9ccd0, wall: 0xcfd0cc,
  }),
  circuit: theme({
    mood: 'Early summer afternoon in the hills', biome: 'temperate', mountains: 1,
    sky: { top: 0x3a76c2, horizon: 0xd3dfe6, sunElevation: 36, sunAzimuth: -40, sunColor: 0xffecd0 },
    exposure: 1.05, trees: { broadleaf: 0.6, conifer: 0.4 }, treeTint: 0xf4fff0,
    accent: 0xd0402c, seats: [0xd0402c, 0xe6e2d8, 0x4d5866], structure: 0xd2d0ca, wall: 0xd6d5cf,
  }),
  rally: theme({
    mood: 'Morning in the mountains', biome: 'temperate', mountains: 1.4,
    sky: { top: 0x4f82bf, horizon: 0xd8e0e2, sunElevation: 16, sunAzimuth: 80, sunColor: 0xffdcb0, sunIntensity: 2.4, ambient: 0.62, fogFar: 22000 },
    exposure: 1.08, trees: { conifer: 0.85, broadleaf: 0.15 }, treeTint: 0xe8f2ea,
    accent: 0x2f7fbf, seats: [0x2f7fbf, 0xdcdcd4, 0x575f66], structure: 0xb9b3a7, wall: 0xc8c4ba,
  }),

  // ---------------------------------------------------------------- 国際サーキット
  suzuka: theme({
    mood: 'Autumn afternoon, low light from the west', biome: 'temperate',
    sky: { top: 0x3d72b5, horizon: 0xe3d6c0, ground: 0x6b6450, sunElevation: 24, sunAzimuth: -55, sunColor: 0xffd29c, sunIntensity: 2.9, ambient: 0.5, fogFar: 30000 },
    exposure: 1.04, palette: pal({ meadow: 0x7a8a4a, field: 0xa89b5a, forest: 0x33502b }),
    trees: { conifer: 0.45, broadleaf: 0.55 }, treeTint: 0xfff0d0,
    accent: 0xc23a2e, seats: [0xc23a2e, 0xe8e3d6, 0x59626c], structure: 0xd8d2c4, wall: 0xdad5ca,
  }),
  spa: theme({
    mood: 'Ardennes forest under a cloudy sky', biome: 'temperate',
    sky: { top: 0x7c90a6, horizon: 0xc8cfd4, ground: 0x5a6150, sunElevation: 30, sunAzimuth: -20, sunColor: 0xe9eef2, sunIntensity: 1.6, ambient: 0.95, fogNear: 50, fogFar: 16000 },
    exposure: 1.12, palette: pal({ meadow: 0x5d7c45, field: 0x7a8c50, forest: 0x23402a }),
    trees: { conifer: 0.7, broadleaf: 0.3 }, treeTint: 0xdde8e4,
    accent: 0xd8a62a, seats: [0xd8a62a, 0xd9d9d3, 0x3e4a56], structure: 0xbfc2c2, wall: 0xc9ccca,
  }),
  monza: theme({
    mood: 'Hazy northern Italian summer in the park', biome: 'temperate',
    sky: { top: 0x4b7fb8, horizon: 0xe6dcc6, ground: 0x6e6a54, sunElevation: 52, sunAzimuth: 25, sunColor: 0xfff0d2, sunIntensity: 3, ambient: 0.55, fogFar: 20000 },
    exposure: 1.02, palette: pal({ meadow: 0x7f8b4a, field: 0xa8a061, forest: 0x3c552f }),
    trees: { broadleaf: 0.8, umbrella: 0.1, cypress: 0.1 }, treeTint: 0xfaf2dc,
    accent: 0xb5302a, seats: [0xb5302a, 0xefebe1, 0x2e6b45], structure: 0xd6cfbf, wall: 0xdcd6c8,
  }),
  silverstone: theme({
    mood: 'Soft English overcast over open fields', biome: 'temperate',
    sky: { top: 0x6f8fb4, horizon: 0xd2d9df, ground: 0x5e6656, sunElevation: 34, sunAzimuth: 10, sunColor: 0xf3f2ea, sunIntensity: 2, ambient: 0.85, fogFar: 22000 },
    exposure: 1.1, palette: pal({ meadow: 0x5f8c46, field: 0x8ea459, forest: 0x2f4c2c }),
    trees: { broadleaf: 0.75, conifer: 0.25 }, treeTint: 0xeef4ea,
    accent: 0x24553a, seats: [0x24553a, 0xe7e7e2, 0x8a2433], structure: 0xc6c8c6, wall: 0xd0d1ce,
  }),
  fuji: theme({
    mood: 'Clear autumn morning with Mount Fuji ahead', biome: 'temperate',
    sky: { top: 0x2a63b6, horizon: 0xc6d9ec, ground: 0x60664f, sunElevation: 28, sunAzimuth: 70, sunColor: 0xfff0d8, sunIntensity: 3, ambient: 0.5, fogFar: 60000 },
    exposure: 1.03, palette: pal({ meadow: 0x7a8c48, field: 0xa59852, forest: 0x34502c }),
    trees: { conifer: 0.55, broadleaf: 0.45 }, treeTint: 0xfff0d6,
    accent: 0xbf3b2f, seats: [0xbf3b2f, 0xefefea, 0x34495a], structure: 0xd5d6d6, wall: 0xdcdcda,
  }),

  // ---------------------------------------------------------------- テクニカル
  zandvoort: theme({
    mood: 'North Sea breeze and dune grass', biome: 'temperate',
    sky: { top: 0x4f86c6, horizon: 0xd9e3ea, ground: 0x7a7560, sunElevation: 40, sunAzimuth: -15, sunColor: 0xfff6e6, sunIntensity: 2.8, ambient: 0.65, fogFar: 26000 },
    exposure: 1.06, palette: pal({ meadow: 0x8e9a5c, field: 0xa8a46c, forest: 0x56663d, beach: 0xe4d6ae }),
    trees: { conifer: 0.5, broadleaf: 0.5 }, treeTint: 0xe8eedc,
    accent: 0xe07028, seats: [0xe07028, 0xf2f2ee, 0x2b4f78], structure: 0xd8d8d4, wall: 0xdedfdb,
  }),
  'brands-hatch': theme({
    mood: 'Golden evening light in a Kent valley', biome: 'temperate',
    sky: { top: 0x46699e, horizon: 0xe8d0ac, ground: 0x6a5e48, sunElevation: 14, sunAzimuth: -75, sunColor: 0xffbf80, sunIntensity: 2.6, ambient: 0.5, fogFar: 22000 },
    exposure: 1.06, palette: pal({ meadow: 0x6c8a40, field: 0x9a9a52, forest: 0x2e4a26 }),
    trees: { broadleaf: 0.8, conifer: 0.2 }, treeTint: 0xffe8c8,
    accent: 0x1f3b6e, seats: [0x1f3b6e, 0xe9e2d4, 0xa8382c], structure: 0xd3cbbb, wall: 0xd8d1c3,
  }),
  hungaroring: theme({
    mood: 'Hot continental summer on dry hills', biome: 'temperate',
    sky: { top: 0x3d7ac4, horizon: 0xe8e1cf, ground: 0x7a7055, sunElevation: 60, sunAzimuth: 0, sunColor: 0xfff2d6, sunIntensity: 3.1, ambient: 0.5, fogFar: 24000 },
    exposure: 1, palette: pal({ meadow: 0x8d8c4e, field: 0xb5a462, forest: 0x47572f }),
    trees: { broadleaf: 0.85, conifer: 0.15 }, treeTint: 0xf6eccc,
    accent: 0x3b7a3e, seats: [0xb53a2c, 0xeeece6, 0x3b7a3e], structure: 0xd9d2c2, wall: 0xdfd9cb,
  }),
  tsukuba: theme({
    mood: 'Spring haze over the green Kanto plain', biome: 'temperate',
    sky: { top: 0x5a86bd, horizon: 0xdfe3e2, ground: 0x6a6c56, sunElevation: 44, sunAzimuth: 30, sunColor: 0xfff4e2, sunIntensity: 2.6, ambient: 0.7, fogFar: 18000 },
    exposure: 1.07, palette: pal({ meadow: 0x7c9c4c, field: 0x9fb05c, forest: 0x3c5e30 }),
    trees: { broadleaf: 0.6, conifer: 0.4 }, treeTint: 0xf2fae6,
    accent: 0x2b6cb0, seats: [0x2b6cb0, 0xf0f0ec, 0xd9a83a], structure: 0xd6d7d6, wall: 0xdcdcda,
  }),
  'laguna-seca': theme({
    mood: 'Golden California hills and oak trees', biome: 'dry',
    sky: { top: 0x3874c2, horizon: 0xe8dbc0, ground: 0x7d6e52, sunElevation: 40, sunAzimuth: -30, sunColor: 0xfff0d0, sunIntensity: 3.1, ambient: 0.5, fogFar: 32000 },
    exposure: 1.02, palette: pal({ meadow: 0xc0a262, field: 0xceb578, forest: 0x5a5a33, rock: 0xa08c70 }),
    trees: { broadleaf: 1 }, treeTint: 0xa8a070,
    accent: 0xd9a03c, seats: [0x2d4a6b, 0xd9a03c, 0xeeeae0], structure: 0xdccfb6, wall: 0xe0d6c2,
  }),

  // ---------------------------------------------------------------- 市街地
  monaco: theme({
    mood: 'Mediterranean noon, the sea and a cliffside town', biome: 'mediterranean', city: { radius: 2600, height: [12, 70] }, facades: FACADES_MED, water: 0x1d5684,
    sky: { top: 0x2a6bd1, horizon: 0xd5e3ee, ground: 0x7a7060, sunElevation: 56, sunAzimuth: 10, sunColor: 0xfff3dc, sunIntensity: 3.1, ambient: 0.55, fogFar: 30000 },
    exposure: 1.02, palette: pal({ meadow: 0x80894e, field: 0x9e9a62, forest: 0x48603a, rock: 0xb3a68f }),
    trees: { umbrella: 0.4, palm: 0.35, cypress: 0.1, broadleaf: 0.15 }, treeTint: 0xf2f2dc,
    accent: 0xc8102e, seats: [0xc8102e, 0xf3f1ec, 0x8c2a2a], structure: 0xe2d8c4, wall: 0xe6e2d8,
  }),
  macau: theme({
    mood: 'Humid South China Sea light, narrow hill roads', biome: 'tropical', city: { radius: 3600, height: [20, 140] }, facades: FACADES_ASIA, water: 0x3e5b55,
    sky: { top: 0x6a8fb6, horizon: 0xd9dccf, ground: 0x6c6a58, sunElevation: 48, sunAzimuth: 15, sunColor: 0xfff0d8, sunIntensity: 2.5, ambient: 0.75, fogNear: 50, fogFar: 14000 },
    exposure: 1.08, palette: pal({ meadow: 0x5f8f40, field: 0x7fa44c, forest: 0x2b5c2b }),
    trees: { palm: 0.35, broadleaf: 0.65 }, treeTint: 0xeaf2dc,
    accent: 0x1f7a5c, seats: [0x1f7a5c, 0xefece4, 0xc8a04a], structure: 0xd6d3c8, wall: 0xdcdad2,
  }),
  singapore: theme({
    mood: 'Dusk at Marina Bay among glass towers', biome: 'tropical', city: { radius: 4200, height: [25, 200] }, facades: FACADES_GLASS, water: 0x2b4560,
    sky: { top: 0x3a5c9c, horizon: 0xf0bf94, ground: 0x5e5250, sunElevation: 14, sunAzimuth: -95, sunColor: 0xffb47c, sunIntensity: 2.5, ambient: 0.85, fogFar: 28000 },
    exposure: 1.2, palette: pal({ meadow: 0x55823a, field: 0x6f9445, forest: 0x285727 }),
    trees: { palm: 0.5, broadleaf: 0.5 }, treeTint: 0xffd8c0,
    accent: 0xd23c7a, seats: [0xd23c7a, 0x2aa7a6, 0xe8e4e8], structure: 0xbfc4cc, wall: 0xcfd3d8,
  }),
  baku: theme({
    mood: 'Dry Caspian light and an old stone town', biome: 'dry', city: { radius: 3600, height: [15, 90] }, facades: [0xd8c8a4, 0xcbb68e, 0xe3d6ba, 0x7f97ab, 0xbfa77e], seaLevel: -28, water: 0x2f5c6b,
    sky: { top: 0x5689c0, horizon: 0xe7d8ba, ground: 0x7d6c52, sunElevation: 34, sunAzimuth: -40, sunColor: 0xffe2b4, sunIntensity: 2.9, ambient: 0.55, fogFar: 22000 },
    exposure: 1.03, palette: pal({ meadow: 0xb39f72, field: 0xc8b585, forest: 0x7a7444, rock: 0xa89676 }),
    trees: { broadleaf: 0.6, cypress: 0.4 }, treeTint: 0xd8d4b0,
    accent: 0x2a78b8, seats: [0x2a78b8, 0xc94040, 0x3a925a], structure: 0xddcfb4, wall: 0xe2d8c4,
  }),
  melbourne: theme({
    mood: 'Southern autumn by the park lake (the sun is in the north)', biome: 'temperate', city: { radius: 4200, height: [8, 110] }, facades: FACADES_GLASS, water: 0x2a587a,
    sky: { top: 0x3b7bd0, horizon: 0xd6e2ea, ground: 0x6a6a55, sunElevation: 36, sunAzimuth: 170, sunColor: 0xfff1da, sunIntensity: 2.9, ambient: 0.55, fogFar: 30000 },
    exposure: 1.04, palette: pal({ meadow: 0x80984f, field: 0xa3a35e, forest: 0x4f6a48 }),
    trees: { broadleaf: 0.85, palm: 0.15 }, treeTint: 0xdfe8d8,
    accent: 0x1c3f94, seats: [0x1c3f94, 0xf0f0ee, 0xdcab2c], structure: 0xd0d2d4, wall: 0xd8dadc,
  }),

  // ---------------------------------------------------------------- オーバル
  indianapolis: theme({
    mood: 'Midwestern summer noon, a flat horizon', biome: 'temperate',
    sky: { top: 0x3f7fd0, horizon: 0xdce6ee, sunElevation: 58, sunAzimuth: 5, sunIntensity: 3.1, ambient: 0.5 },
    exposure: 1.01, palette: pal({ meadow: 0x6a9a48, field: 0x9ab05a, forest: 0x3b5f30 }),
    trees: { broadleaf: 0.9, conifer: 0.1 }, treeTint: 0xf4faea,
    accent: 0x1d3f8f, seats: [0x1d3f8f, 0xdcdcd8, 0xb8312f], structure: 0xd2d4d6, wall: 0xdadcde,
  }),
  daytona: theme({
    mood: 'Strong Florida sun, palms and the seaside', biome: 'tropical', water: 0x2a6a86,
    sky: { top: 0x2f80d6, horizon: 0xe0ecf2, ground: 0x7d7660, sunElevation: 66, sunAzimuth: 0, sunColor: 0xfff6e4, sunIntensity: 3.2, ambient: 0.55 },
    exposure: 1, palette: pal({ meadow: 0x6c9a46, field: 0x8fae56, forest: 0x2f6430, beach: 0xe8dcb6 }),
    trees: { palm: 0.6, broadleaf: 0.4 }, treeTint: 0xf2fae0,
    accent: 0xf0b030, seats: [0x1f5fa8, 0xf0b030, 0xf4f4f0], structure: 0xe0e0dc, wall: 0xe6e6e2,
  }),
  talladega: theme({
    mood: 'Hot Alabama afternoon among the pines', biome: 'temperate',
    sky: { top: 0x4a7fc0, horizon: 0xe2dcc8, ground: 0x6e6650, sunElevation: 40, sunAzimuth: -40, sunColor: 0xffecc8, sunIntensity: 3, ambient: 0.5, fogFar: 26000 },
    exposure: 1.02, palette: pal({ meadow: 0x7b8f45, field: 0x9e9e56, forest: 0x2f4a2b }),
    trees: { conifer: 0.8, broadleaf: 0.2 }, treeTint: 0xf6f0d8,
    accent: 0xc0392b, seats: [0x2c3e50, 0xc0392b, 0xecf0f1], structure: 0xd4d2cc, wall: 0xdcdad4,
  }),
  charlotte: theme({
    mood: 'Early evening before a night race', biome: 'temperate',
    sky: { top: 0x45649f, horizon: 0xf0c294, ground: 0x655748, sunElevation: 9, sunAzimuth: -80, sunColor: 0xffaa66, sunIntensity: 2.3, ambient: 0.5, fogFar: 24000 },
    exposure: 1.1, palette: pal({ meadow: 0x6f8a44, field: 0x969652, forest: 0x2f4a2b }),
    trees: { broadleaf: 0.6, conifer: 0.4 }, treeTint: 0xffdcc0,
    accent: 0x1f3f7a, seats: [0x1f3f7a, 0xe6e0d8, 0xc0782c], structure: 0xcfc8be, wall: 0xd6d0c6,
  }),
  bristol: theme({
    mood: 'Morning mist in an Appalachian valley', biome: 'temperate',
    sky: { top: 0x5f8fc0, horizon: 0xd3dcd6, ground: 0x5e6450, sunElevation: 20, sunAzimuth: 95, sunColor: 0xffe6c0, sunIntensity: 2.4, ambient: 0.7, fogNear: 50, fogFar: 14000 },
    exposure: 1.08, palette: pal({ meadow: 0x638a44, field: 0x84994f, forest: 0x2d4a2c }),
    trees: { broadleaf: 0.6, conifer: 0.4 }, treeTint: 0xeaf2e6,
    accent: 0xb8312f, seats: [0xb8312f, 0xe8e6e0, 0x34485c], structure: 0xcfd0cc, wall: 0xd8d8d4,
  }),
};

for (const [id, f] of Object.entries(FOREST)) if (THEMES[id]) THEMES[id].forest = { ...THEMES[id].forest, ...f };

export const DEFAULT_THEME = THEMES.circuit;

export function themeOf(id: string): CourseTheme {
  return THEMES[id] ?? DEFAULT_THEME;
}
