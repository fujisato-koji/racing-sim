// 遠景の地形データ（tools/fetch-scenery.ts が作る同心円の格子）から、任意の位置の高さを取り出す。
// コースのまわりの地形（走れる範囲）と、遠景の描画の両方で使う。

export interface SceneryData {
  id: string;
  /** 地形の標高 − この値 = ゲームの高さ（コースの最も低い点が 0） */
  offset: number;
  rings: { r0: number; r1: number; k: number; a: number };
  /** 標高 [m] の Int16 を base64 で（環 k、角度 a の順） */
  heights: string;
  source: { elevation: string; attribution: string[]; retrieved: string };
}

export interface TerrainSampler {
  /** ゲームの座標 (x, z) での地面の高さ（ゲームの高さ） */
  height(x: number, z: number): number;
  /** 水面のゲームの高さ（海が無ければ −∞） */
  seaY: number;
}

export function decodeHeights(data: SceneryData) {
  const bin = typeof atob === 'function' ? atob(data.heights) : Buffer.from(data.heights, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** 同心円の格子を、半径は対数、角度は等分で双一次に補間する */
export function polarSampler(data: SceneryData, seaLevel = 0): TerrainSampler {
  const h = decodeHeights(data);
  const { r0, r1, k: K, a: A } = data.rings;
  const lr = Math.log(r1 / r0);
  let sea = false;
  for (let i = 0; i < h.length; i++) if (h[i] <= seaLevel + 0.5) { sea = true; break; }
  const seaY = sea ? seaLevel - data.offset : -Infinity;
  return {
    seaY,
    height(x, z) {
      const r = Math.max(r0, Math.hypot(x, z));
      const fk = Math.min(K - 1e-6, (K * Math.log(r / r0)) / lr);
      let t = Math.atan2(z, x);
      if (t < 0) t += Math.PI * 2;
      const fa = (t / (Math.PI * 2)) * A;
      const k = Math.floor(fk), a = Math.floor(fa) % A, u = fk - k, v = fa - Math.floor(fa);
      const a2 = (a + 1) % A;
      const e = (h[k * A + a] * (1 - v) + h[k * A + a2] * v) * (1 - u) + (h[(k + 1) * A + a] * (1 - v) + h[(k + 1) * A + a2] * v) * u;
      return e - data.offset;
    },
  };
}
