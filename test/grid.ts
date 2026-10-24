/** x0〜x1、z0〜z1 を cell 刻みの格子にした地面（上向きの面） */
export function gridMesh(x0: number, x1: number, z0: number, z1: number, cell: number, h: (x: number, z: number) => number) {
  const nx = Math.round((x1 - x0) / cell), nz = Math.round((z1 - z0) / cell);
  const v = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, k = (j * (nx + 1) + i) * 3;
    v[k] = x; v[k + 1] = h(x, z); v[k + 2] = z;
  }
  const idx = new Uint32Array(nx * nz * 6);
  let n = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx[n++] = a; idx[n++] = c; idx[n++] = b;
    idx[n++] = b; idx[n++] = c; idx[n++] = d;
  }
  return { v, i: idx };
}
