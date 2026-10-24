// 路面の種類と係数。値は調整を始めるための仮置き（出典なし）。
export type SurfaceId = 'asphalt' | 'concrete' | 'gravel' | 'sand' | 'rock' | 'grass';

export interface Surface {
  id: SurfaceId;
  name: string;
  /** タイヤの最大摩擦係数に掛ける倍率 */
  mu: number;
  /** 最大摩擦になる滑り（滑り率、滑り角）に掛ける倍率。未舗装は大きい */
  slipScale: number;
  /** 滑り切ったときの摩擦と最大摩擦の比。null ならタイヤの値を使う */
  slide: number | null;
  /** 転がり抵抗係数 */
  rolling: number;
  /** 細かい凹凸の振幅 [m] */
  roughness: number;
  /** 凹凸の波長 [m] */
  roughWave: number;
  /** タイヤの沈み込み [m] */
  sink: number;
  /** 車体が地面に触れたときの摩擦（物理エンジンの接触用） */
  bodyFriction: number;
  color: number;
}

export const SURFACES: Record<SurfaceId, Surface> = {
  asphalt: { id: 'asphalt', name: 'アスファルト', mu: 1.0, slipScale: 1.0, slide: null, rolling: 0.012, roughness: 0, roughWave: 1, sink: 0, bodyFriction: 0.6, color: 0x3b3e44 },
  concrete: { id: 'concrete', name: 'コンクリート', mu: 0.95, slipScale: 1.0, slide: null, rolling: 0.012, roughness: 0, roughWave: 1, sink: 0, bodyFriction: 0.5, color: 0x9a9a96 },
  gravel: { id: 'gravel', name: '砂利', mu: 0.62, slipScale: 1.8, slide: 0.95, rolling: 0.03, roughness: 0.012, roughWave: 0.6, sink: 0.01, bodyFriction: 0.5, color: 0x8c8172 },
  sand: { id: 'sand', name: '砂地', mu: 0.45, slipScale: 2.2, slide: 1.0, rolling: 0.15, roughness: 0.006, roughWave: 1.5, sink: 0.06, bodyFriction: 0.6, color: 0xd6c08a },
  rock: { id: 'rock', name: '岩場', mu: 0.8, slipScale: 1.2, slide: 0.8, rolling: 0.03, roughness: 0.03, roughWave: 0.5, sink: 0, bodyFriction: 0.7, color: 0x6e6964 },
  grass: { id: 'grass', name: '草地', mu: 0.5, slipScale: 1.6, slide: 0.9, rolling: 0.05, roughness: 0.01, roughWave: 0.8, sink: 0.01, bodyFriction: 0.4, color: 0x4d7a38 },
};

// 位置で決まる凹凸。同じ場所はいつも同じ高さになる。
function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 0xffff;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}

/** 路面の凹凸による高さのずれ [m]（上向きが正） */
export function surfaceBump(s: Surface, x: number, z: number): number {
  if (s.roughness === 0) return 0;
  const w = s.roughWave;
  return s.roughness * (0.7 * valueNoise(x / w, z / w) + 0.3 * valueNoise(x / (w * 0.37) + 17.1, z / (w * 0.37) - 5.3));
}
