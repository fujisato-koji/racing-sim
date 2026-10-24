// 実在の建物の描画。足元の多角形を高さまで押し出し、壁はテーマの外壁の色、屋根は少し暗い色。
// 窓は世界の高さ 3.4 m ごとの帯として描く（テクスチャを使わない）。観客席はテーマの席の色の段、工場は金属の灰色。
import * as THREE from 'three';
import type { CourseData } from '../sim/course';
import type { CourseTheme } from './themes';

function hash01(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** 窓の帯のある材質。aWin が 1 の面にだけ窓を描く */
export function windowMaterial(winColor: number) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.winColor = { value: new THREE.Color(winColor) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWin;\nvarying vec3 vWPos;\nvarying float vWin;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWin = aWin;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vWin;\nuniform vec3 winColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fl = fract(vWPos.y / 3.4);
        float cx = fract((vWPos.x + vWPos.z) / 3.0);
        float w = step(0.38, fl) * step(fl, 0.76) * step(0.18, cx) * step(cx, 0.86) * step(0.5, vWin);
        diffuseColor.rgb = mix(diffuseColor.rgb, winColor, w * 0.88);`);
  };
  return m;
}

export function buildOsmMesh(c: CourseData, theme: CourseTheme): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  if (c.osm.length === 0) return { group, dispose: () => {} };
  const pos: number[] = [], col: number[] = [], win: number[] = [], idx: number[] = [];
  const facades = theme.facades ?? [0xd9d0bf, 0xcbbfa8, 0xe3dccd, 0xb9ad98, 0xc7c2b8, 0xa99d8a];
  const cl = new THREE.Color(), roof = new THREE.Color();
  const metal = new THREE.Color(0xa7acb2), house = new THREE.Color(0xb05a3c);
  const seats = theme.seats.map((s) => new THREE.Color(s));
  const quad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, h0: number, h1: number, color: THREE.Color, w: number) => {
    const o = pos.length / 3;
    pos.push(ax, h0, az, bx, h0, bz, bx, h1, bz, ax, h1, az);
    for (let k = 0; k < 4; k++) { col.push(color.r, color.g, color.b); win.push(w); }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    void ay; void by;
  };
  c.osm.forEach((b, bi) => {
    const m = b.pts.length / 2;
    cl.setHex(facades[Math.floor(hash01(bi * 3.7) * facades.length)]);
    if (b.kind === 3) cl.copy(metal).multiplyScalar(0.9 + 0.15 * hash01(bi));
    roof.copy(cl).multiplyScalar(0.72);
    if (b.kind === 4) roof.copy(house).lerp(cl, 0.25);
    if (b.kind === 3) roof.copy(metal).multiplyScalar(0.8);
    const tall = b.height > 6 && b.kind !== 3 && b.kind !== 2;
    // 壁（屋根だけの建物は上 0.6 m の縁だけ）
    const w0 = b.kind === 2 ? b.top - 0.6 : b.base;
    for (let k = 0; k < m; k++) {
      const a = k, d = (k + 1) % m;
      const ax = b.pts[a * 2], az = b.pts[a * 2 + 1], bx = b.pts[d * 2], bz = b.pts[d * 2 + 1];
      if (b.kind === 1) {
        // 観客席：席の色の段を重ねる
        const rows = Math.max(3, Math.round((b.top - b.base) / 1.2));
        for (let r = 0; r < rows; r++) {
          const h0 = b.base + ((b.top - b.base) * r) / rows, h1 = b.base + ((b.top - b.base) * (r + 1)) / rows;
          quad(ax, 0, az, bx, 0, bz, h0, h1, seats[(r + k) % 3], 0);
        }
      } else {
        quad(ax, 0, az, bx, 0, bz, w0, b.top, cl, tall ? 1 : 0);
      }
    }
    // 屋根
    const contour = [] as THREE.Vector2[];
    for (let k = 0; k < m; k++) contour.push(new THREE.Vector2(b.pts[k * 2], b.pts[k * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const o = pos.length / 3;
    for (let k = 0; k < m; k++) { pos.push(b.pts[k * 2], b.top, b.pts[k * 2 + 1]); col.push(roof.r, roof.g, roof.b); win.push(0); }
    // 上から見て反時計回りの点の並びなので、上を向く面にするには並びを入れ替える
    for (const t of tris) idx.push(o + t[0], o + t[2], o + t[1]);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = windowMaterial(theme.facades && theme.facades.some((f) => (f & 0xff) > ((f >> 16) & 0xff)) ? 0x58789a : 0x2b3440);
  mat.side = THREE.DoubleSide;
  disposables.push(g, mat);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return { group, dispose: () => { for (const d of disposables) d.dispose(); } };
}
