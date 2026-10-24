// 実在の建物（tools/fetch-buildings.ts が OpenStreetMap から作ったもの）を読む。
// 並びは Int16：[点の数, 高さ×10, 種類, x×2, z×2, x×2, z×2, ...] の繰り返し。

export interface BuildingsData {
  id: string;
  count: number;
  data: string;
  source: { shape: string; retrieved: string };
}

/** 0 一般、1 観客席、2 屋根だけ、3 工場と倉庫、4 住宅 */
export type BuildingKind = 0 | 1 | 2 | 3 | 4;

export interface RealBuilding {
  /** 足元の多角形（x, z の順に並べる。上から見て反時計回り） */
  pts: Float32Array;
  height: number;
  kind: BuildingKind;
}

export function decodeBuildings(d: BuildingsData): RealBuilding[] {
  const bin = typeof atob === 'function' ? atob(d.data) : Buffer.from(d.data, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = new Int16Array(bytes.buffer);
  const out: RealBuilding[] = [];
  let i = 0;
  while (i + 3 <= a.length) {
    const n = a[i], h = a[i + 1] / 10, kind = a[i + 2] as BuildingKind;
    i += 3;
    const pts = new Float32Array(n * 2);
    for (let k = 0; k < n * 2; k++) pts[k] = a[i + k] / 2;
    i += n * 2;
    out.push({ pts, height: h, kind });
  }
  return out;
}

/** 点 (x, z) が多角形の中か */
export function insidePolygon(pts: Float32Array, x: number, z: number) {
  let c = false;
  const n = pts.length / 2;
  for (let i = 0, k = n - 1; i < n; k = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1], xk = pts[k * 2], zk = pts[k * 2 + 1];
    if ((zi > z) !== (zk > z) && x < ((xk - xi) * (z - zi)) / (zk - zi) + xi) c = !c;
  }
  return c;
}
