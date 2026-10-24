// コースの見た目。物理と同じ配列から作る。
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CourseData } from '../sim/course';
import { SURFACES } from '../sim/surfaces';
import type { PhysicsWorld } from '../sim/world';
import { quality } from './quality';
import { cityMix, forestAmount, natureColor, paletteOf } from './scenery';
import type { CourseTheme } from './themes';
import { DEFAULT_THEME } from './themes';
import type { TreeKind } from './trees';
import { DOUBLE_SIDED, treeVariants } from './trees';
import { checkerTexture, groundDetailTexture, roadTexture, stripeTexture } from './textures';

/** 頂点の色を一色で塗る */
function paint(g: THREE.BufferGeometry, color: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** コーン：四角い台座と、白い帯の入った円錐 */
function coneGeometry() {
  const base = paint(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 4).rotateY(Math.PI / 4).translate(0, -0.32, 0), 0xff4d0a);
  const parts = [base];
  const bands: [number, number, number][] = [[-0.3, -0.05, 0xff4d0a], [-0.05, 0.07, 0xf2f2f2], [0.07, 0.17, 0xff4d0a], [0.17, 0.25, 0xf2f2f2], [0.25, 0.36, 0xff4d0a]];
  const r = (y: number) => 0.155 - ((y + 0.3) / 0.66) * 0.13;
  for (const [y0, y1, col] of bands) {
    parts.push(paint(new THREE.CylinderGeometry(r(y1), r(y0), y1 - y0, 16, 1, y1 < 0.36).translate(0, (y0 + y1) / 2, 0), col));
  }
  return mergeGeometries(parts)!;
}

/** タイヤ（バリア用）：断面を回した輪 */
function barrierTireGeometry() {
  const R = 0.32, r = 0.19, w = 0.22, sh = 0.04;
  const pts = [
    new THREE.Vector2(r, -w / 2), new THREE.Vector2(R - sh, -w / 2), new THREE.Vector2(R, -w / 2 + sh),
    new THREE.Vector2(R, w / 2 - sh), new THREE.Vector2(R - sh, w / 2), new THREE.Vector2(r, w / 2),
    new THREE.Vector2(r - 0.01, 0), new THREE.Vector2(r, -w / 2),
  ];
  return new THREE.LatheGeometry(pts, 20);
}

/** コンクリートの分離帯：断面を長さ 1 m 押し出す（z 方向に伸ばして使う） */
function barrierGeometry() {
  const s = new THREE.Shape();
  const hw = 0.3, h = 1.0;
  s.moveTo(-hw, -h / 2);
  s.lineTo(hw, -h / 2);
  s.lineTo(hw - 0.03, -h / 2 + 0.08);
  s.lineTo(0.11, -h / 2 + 0.3);
  s.lineTo(0.08, h / 2);
  s.lineTo(-0.08, h / 2);
  s.lineTo(-0.11, -h / 2 + 0.3);
  s.lineTo(-hw + 0.03, -h / 2 + 0.08);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

/** 観客席：段々の席と屋根。席はテーマの 3 色、躯体はテーマの地の色 */
function standGeometry(length: number, t: CourseTheme) {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color(t.structure);
  const step = (k: number) => base.clone().multiplyScalar(k).getHex();
  for (let i = 0; i < 8; i++) {
    parts.push(paint(new THREE.BoxGeometry(length, 0.5 + i * 0.6, 1.1).translate(0, (0.5 + i * 0.6) / 2, 1.1 * i + 0.55), step(i % 2 ? 0.72 : 0.64)));
  }
  // 観客（色のついた点の代わりに細い帯）。席の 3 色を、ところどころ空席の地の色で区切る
  const colors = [t.seats[0], t.seats[1], t.seats[0], t.seats[2], step(0.8)];
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 6; k++) {
      const x = -length / 2 + (k + 0.5) * (length / 6);
      parts.push(paint(new THREE.BoxGeometry(length / 6 - 1, 0.35, 0.35).translate(x, 0.5 + i * 0.6 + 0.17, 1.1 * i + 0.35), colors[(i * 2 + k) % colors.length]));
    }
  }
  parts.push(paint(new THREE.BoxGeometry(length + 2, 0.25, 10).translate(0, 7.5, 4.2), step(1)));
  // 屋根の前の縁に差し色
  parts.push(paint(new THREE.BoxGeometry(length + 2.1, 0.5, 0.18).translate(0, 7.45, -0.8), t.accent));
  for (let k = 0; k <= 4; k++) parts.push(paint(new THREE.BoxGeometry(0.3, 7.5, 0.3).translate(-length / 2 + (k * length) / 4, 3.75, 8.9), step(0.7)));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/** ピットの建物：横に長い 2 階建てとガレージの開口。帯は差し色 */
function pitGeometry(length: number, t: CourseTheme) {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.BoxGeometry(length, 6, 12).translate(0, 3, -6), t.structure));
  parts.push(paint(new THREE.BoxGeometry(length, 0.8, 0.3).translate(0, 4.2, 0.1), t.accent));
  for (let k = 0; k < 10; k++) {
    const x = -length / 2 + (k + 0.5) * (length / 10);
    parts.push(paint(new THREE.BoxGeometry(length / 10 - 1.5, 3.2, 0.2).translate(x, 1.6, 0.05), 0x2a2d33));
  }
  parts.push(paint(new THREE.BoxGeometry(length, 1.4, 0.2).translate(0, 5, 0.05), 0x30363f));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/** 0〜1 の決まった乱数 */
function hash01(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class CourseMesh {
  readonly group = new THREE.Group();
  private readonly cones: THREE.InstancedMesh | null = null;
  private readonly tires: THREE.InstancedMesh | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  /** theme はコースの色のテーマ（植生、木の種類、建物の色） */
  constructor(readonly c: CourseData, readonly pw: PhysicsWorld, theme: CourseTheme = DEFAULT_THEME) {
    const track = <T extends { dispose(): void }>(x: T) => { this.disposables.push(x); return x; };
    const vcol = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));

    // 地形
    {
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(c.terrain.vertices, 3));
      // 頂点の色は sRGB の値で入っているので線形に直し、道から離れた所は遠景と同じ植生の色を混ぜる
      const n = c.terrain.vertices.length / 3;
      const tc = new Float32Array(n * 3), cl = new THREE.Color(), nat = new THREE.Color(), pal = paletteOf(theme);
      const { nx, cell } = c.terrain, V = c.terrain.vertices;
      for (let i = 0; i < n; i++) {
        cl.setRGB(c.terrain.colors[i * 3], c.terrain.colors[i * 3 + 1], c.terrain.colors[i * 3 + 2], THREE.SRGBColorSpace);
        const w = c.terrain.nature[i];
        if (w >= 0 && c.def.ground === 'grass') cl.lerp(nat.setHex(pal.meadow), 0.6);
        if (w > 0) {
          const ix = i % (nx + 1), l = i - 1, r = i + 1, u = i - (nx + 1), d = i + nx + 1;
          const hy = (j: number) => (j >= 0 && j < n ? V[j * 3 + 1] : V[i * 3 + 1]);
          const sx = ix > 0 && ix < nx ? Math.abs(hy(r) - hy(l)) / (2 * cell) : 0;
          const slope = Math.max(sx, Math.abs(hy(d) - hy(u)) / (2 * cell));
          natureColor(nat, V[i * 3], V[i * 3 + 2], slope, 0, V[i * 3 + 1] - c.seaY, pal);
          cityMix(nat, V[i * 3], V[i * 3 + 2], slope, theme);
          cl.lerp(nat, w);
        }
        tc[i * 3] = cl.r; tc[i * 3 + 1] = cl.g; tc[i * 3 + 2] = cl.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { uv[i * 2] = c.terrain.vertices[i * 3] / 6; uv[i * 2 + 1] = c.terrain.vertices[i * 3 + 2] / 6; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      let total = 0;
      for (const p of c.terrain.parts) total += p.indices.length;
      const idx = new Uint32Array(total);
      let o = 0;
      for (const p of c.terrain.parts) { idx.set(p.indices, o); o += p.indices.length; }
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: track(groundDetailTexture()) })));
      m.receiveShadow = true;
      this.group.add(m);
    }

    // 路面と路肩
    if (c.road) {
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(c.road.vertices, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(c.road.uvs, 2));
      let total = 0;
      for (const p of c.road.parts) total += p.indices.length;
      const idx = new Uint32Array(total);
      const mats: THREE.Material[] = [];
      let o = 0;
      c.road.parts.forEach((p, k) => {
        idx.set(p.indices, o);
        g.addGroup(o, p.indices.length, k);
        o += p.indices.length;
        mats.push(track(new THREE.MeshStandardMaterial({ map: track(roadTexture(p.surface)), roughness: 0.92 })));
      });
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mats);
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (c.shoulder) {
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(c.shoulder.vertices, 3));
      g.setIndex(new THREE.BufferAttribute(c.shoulder.indices, 1));
      g.computeVertexNormals();
      const col = new THREE.Color(SURFACES[c.shoulder.surface].color).multiplyScalar(0.92);
      // 路肩の草もテーマの草の色へ寄せる
      if (c.shoulder.surface === 'grass') col.lerp(new THREE.Color(paletteOf(theme).meadow), 0.55);
      const m = new THREE.Mesh(g, track(new THREE.MeshStandardMaterial({ color: col, roughness: 1 })));
      m.receiveShadow = true;
      this.group.add(m);
    }
    // 縁石
    if (c.kerbs) {
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(c.kerbs.vertices, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c.kerbs.colors, 3));
      g.setIndex(new THREE.BufferAttribute(c.kerbs.indices, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
      m.receiveShadow = true;
      this.group.add(m);
    }

    // スタートライン
    if (c.path.length > 0) {
      const p = c.path[0];
      const geo = track(new THREE.PlaneGeometry(c.width, 2));
      const m = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({ map: track(checkerTexture()), roughness: 0.9 })));
      m.rotation.order = 'YXZ';
      m.rotation.y = Math.atan2(-p.tx, -p.tz);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, p.y + 0.02, p.z);
      m.receiveShadow = true;
      this.group.add(m);
    }

    // ジャンプ台：斜面、両横、切り立った後ろ
    const rampMat = track(new THREE.MeshStandardMaterial({ map: track(stripeTexture('#d8d8d0', '#e0b020')), roughness: 0.8, side: THREE.DoubleSide }));
    for (const r of c.ramps) {
      const v = (i: number) => [r[i * 3], r[i * 3 + 1], r[i * 3 + 2]];
      const faces = [[0, 1, 5], [0, 5, 4], [0, 4, 2], [1, 3, 5], [2, 4, 5], [2, 5, 3]];
      const pos: number[] = [], uv: number[] = [];
      for (const f of faces) for (const i of f) { pos.push(...v(i)); uv.push(i % 2, i < 2 ? 0 : 1); }
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, rampMat);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }

    // 岩
    const rockMat = track(new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 1, flatShading: true }));
    for (const r of c.rocks) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < r.length; i += 3) pts.push(new THREE.Vector3(r[i], r[i + 1], r[i + 2]));
      const m = new THREE.Mesh(track(new ConvexGeometry(pts)), rockMat);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

    // 壁（コンクリートの分離帯）
    if (c.walls.length > 0) {
      const m = new THREE.InstancedMesh(track(barrierGeometry()), track(new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.9 })), c.walls.length);
      c.walls.forEach((w, i) => {
        q.setFromAxisAngle(Y, w.yaw);
        sc.set(1, 1, w.half[2] * 2);
        ps.set(w.cx, w.cy, w.cz);
        m.setMatrixAt(i, m4.compose(ps, q, sc));
      });
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }

    // 木：テーマの種類の割合で、森の濃い所ほど多く植える。種類ごとに形の違う 3 本をインスタンスで並べ、向き、大きさ、色味をずらす
    {
      const limit = quality.level === 'low' ? 250 : quality.level === 'medium' ? 800 : 2000;
      const kinds = (Object.entries(theme.trees) as [TreeKind, number][]).filter(([, w]) => w > 0);
      const total = kinds.reduce((sum, [, w]) => sum + w, 0);
      const buckets = new Map<string, number[]>();
      let used = 0;
      for (let i = 0; i < c.trees.length && used < limit && total > 0; i++) {
        const [x, , z] = c.trees[i];
        const sl = Math.hypot(c.heightAt(x + 4, z) - c.heightAt(x - 4, z), c.heightAt(x, z + 4) - c.heightAt(x, z - 4)) / 8;
        if (hash01(i) > 0.2 + 0.8 * forestAmount(x, z, sl, 1)) continue;
        let u = hash01(i * 7 + 3) * total, kind = kinds[0][0];
        for (const [k, w] of kinds) { if (u < w) { kind = k; break; } u -= w; }
        const key = `${kind}:${i % 3}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(i);
        used++;
      }
      const tint = new THREE.Color(theme.treeTint), tc = new THREE.Color();
      for (const [kind] of kinds) {
        const variants = treeVariants(kind);
        const mat = track(new THREE.MeshLambertMaterial({ vertexColors: true, side: DOUBLE_SIDED[kind] ? THREE.DoubleSide : THREE.FrontSide }));
        variants.forEach((g, v) => {
          const ids = buckets.get(`${kind}:${v}`) ?? [];
          if (ids.length === 0) { g.dispose(); return; }
          const m = new THREE.InstancedMesh(track(g), mat, ids.length);
          ids.forEach((i, j) => {
            const [x, y, z, s0] = c.trees[i];
            const k = 0.75 + (s0 - 0.7) * 0.5;
            q.setFromAxisAngle(Y, hash01(i * 13) * Math.PI * 2);
            sc.set(k, k * (0.9 + 0.2 * hash01(i * 19)), k);
            ps.set(x, y - 0.15, z);
            m.setMatrixAt(j, m4.compose(ps, q, sc));
            m.setColorAt(j, tc.copy(tint).multiplyScalar(0.86 + 0.28 * hash01(i * 23)));
          });
          m.castShadow = quality.level === 'high';
          m.receiveShadow = true;
          this.group.add(m);
        });
      }
    }

    // 街の建物：壁と、階ごとに帯の窓。全部を 2 つの形にまとめて描く
    {
      const walls: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
      const m4 = new THREE.Matrix4();
      for (const b of c.buildings) {
        if (b.kind !== 'block') continue;
        const h = b.height ?? 12, d = b.depth ?? 14, l = b.length;
        m4.makeRotationY(b.yaw).setPosition(b.x, b.y, b.z);
        const fac = theme.facades ? theme.facades[Math.floor(hash01(Math.round(b.x * 7 + b.z * 13)) * theme.facades.length)] : (b.color ?? 0xb8b0a4);
        walls.push(paint(new THREE.BoxGeometry(d, h, l).translate(0, h / 2, 0), fac).applyMatrix4(m4));
        walls.push(paint(new THREE.BoxGeometry(d + 0.3, 0.6, l + 0.3).translate(0, h + 0.3, 0), 0x6d6f73).applyMatrix4(m4));
        const floors = Math.floor((h - 1.5) / 3.4);
        for (let k = 0; k < floors; k++) glass.push(new THREE.BoxGeometry(d + 0.08, 1.2, l + 0.08).translate(0, 2.3 + k * 3.4, 0).applyMatrix4(m4));
      }
      if (walls.length > 0) {
        const w = new THREE.Mesh(track(mergeGeometries(walls)!), vcol);
        w.castShadow = true; w.receiveShadow = true;
        this.group.add(w);
        const gm = track(new THREE.MeshStandardMaterial({ color: 0x3f4b58, roughness: 0.25, metalness: 0.5 }));
        this.group.add(new THREE.Mesh(track(mergeGeometries(glass)!), gm));
      }
    }

    // 橋の柱
    if (c.pillars.length > 0) {
      const m = new THREE.InstancedMesh(track(new THREE.BoxGeometry(1.4, 1, 1.4).translate(0, 0.5, 0)), track(new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 0.9 })), c.pillars.length);
      const m4 = new THREE.Matrix4();
      c.pillars.forEach(([x, top, z, bottom], i) => m.setMatrixAt(i, m4.makeScale(1, Math.max(0.5, top - bottom), 1).setPosition(x, bottom, z)));
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }

    // 観客席とピット
    for (const b of c.buildings) {
      if (b.kind === 'block') continue;
      const g = track(b.kind === 'stand' ? standGeometry(b.length, theme) : pitGeometry(b.length, theme));
      const m = new THREE.Mesh(g, vcol);
      // 長さの向きを走る向きに。観客席は外向きに段が上がる
      m.rotation.y = b.yaw + Math.PI / 2;
      m.position.set(b.x, b.y - 0.2, b.z);
      // 観客席は段が外へ上がるように、ピットはガレージの開口がコースを向くように回す
      m.rotateY(Math.PI);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }

    // 動く小物（コーン、タイヤ）
    const cones = pw.props.filter((p) => p.kind === 'cone');
    const tires = pw.props.filter((p) => p.kind === 'tire');
    if (cones.length > 0) {
      this.cones = new THREE.InstancedMesh(track(coneGeometry()), vcol, cones.length);
      this.cones.castShadow = true;
      this.cones.frustumCulled = false;
      this.group.add(this.cones);
    }
    if (tires.length > 0) {
      this.tires = new THREE.InstancedMesh(track(barrierTireGeometry()), track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })), tires.length);
      // 何本かに 1 本は白く塗る
      const white = new THREE.Color(0xe6e6e6), black = new THREE.Color(0x222222);
      for (let i = 0; i < tires.length; i++) this.tires.setColorAt(i, Math.floor(i / 2) % 4 === 0 ? white : black);
      this.tires.castShadow = true; this.tires.receiveShadow = true;
      this.tires.frustumCulled = false;
      this.group.add(this.tires);
    }
    this.updateProps();
  }

  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  /** 小物の位置を物理に合わせる */
  updateProps() {
    let ci = 0, ti = 0;
    for (const prop of this.pw.props) {
      const t = prop.body.translation(), r = prop.body.rotation();
      this.p.set(t.x, t.y, t.z);
      this.q.set(r.x, r.y, r.z, r.w);
      this.m4.compose(this.p, this.q, this.one);
      if (prop.kind === 'cone' && this.cones) this.cones.setMatrixAt(ci++, this.m4);
      else if (prop.kind === 'tire' && this.tires) this.tires.setMatrixAt(ti++, this.m4);
    }
    if (this.cones) this.cones.instanceMatrix.needsUpdate = true;
    if (this.tires) this.tires.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
