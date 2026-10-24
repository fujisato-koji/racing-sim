// 地球儀の点の並び。球の上にほぼ等間隔に N 点を置き（フィボナッチ格子）、陸にある点だけを描く。
// 陸かどうかは tools/make-globe.ts が Natural Earth の陸地（1:110m、パブリックドメイン）から作り、globe-land.ts に入れている。

/** 緯度と経度 [度] から単位球の上の位置（経度 0 が +z、北が +y） */
export function latLonToVec(lat: number, lon: number): [number, number, number] {
  const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
  return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** i 番目の点の緯度と経度 [度] */
export function fibLatLon(i: number, n: number): [number, number] {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(1 - y * y);
  const t = i * GOLDEN;
  const x = Math.cos(t) * r, z = Math.sin(t) * r;
  return [(Math.asin(y) * 180) / Math.PI, (Math.atan2(x, z) * 180) / Math.PI];
}
