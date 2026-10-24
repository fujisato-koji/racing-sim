// コースの見た目。物理と同じ配列から作る。
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CourseData } from '../sim/course';
import { SURFACES } from '../sim/surfaces';
import type { PhysicsWorld } from '../sim/world';
import { quality } from './quality';
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

/** 木：幹と、重ねた円錐の葉 */
function treeGeometry() {
  const trunk = paint(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6).translate(0, 0.8, 0), 0x5a4030);
  const l1 = paint(new THREE.ConeGeometry(1.5, 2.6, 7).translate(0, 2.6, 0), 0x2f5a2a);
  const l2 = paint(new THREE.ConeGeometry(1.1, 2.2, 7).translate(0, 3.8, 0), 0x386a30);
  const l3 = paint(new THREE.ConeGeometry(0.7, 1.6, 7).translate(0, 4.9, 0), 0x427737);
  return mergeGeometries([trunk, l1, l2, l3])!;
}

/** 観客席：段々の席と屋根 */
function standGeometry(length: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    parts.push(paint(new THREE.BoxGeometry(length, 0.5 + i * 0.6, 1.1).translate(0, (0.5 + i * 0.6) / 2, 1.1 * i + 0.55), i % 2 ? 0x8f949c : 0x7a8088));
  }
  // 観客（色のついた点の代わりに細い帯）
  const colors = [0xd94c4c, 0x3b6fd1, 0xf0c419, 0xe8e8e8, 0x2fa35a];
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 6; k++) {
      const x = -length / 2 + (k + 0.5) * (length / 6);
      parts.push(paint(new THREE.BoxGeometry(length / 6 - 1, 0.35, 0.35).translate(x, 0.5 + i * 0.6 + 0.17, 1.1 * i + 0.35), colors[(i + k) % 5]));
    }
  }
  parts.push(paint(new THREE.BoxGeometry(length + 2, 0.25, 10).translate(0, 7.5, 4.2), 0xd8dade));
  for (let k = 0; k <= 4; k++) parts.push(paint(new THREE.BoxGeometry(0.3, 7.5, 0.3).translate(-length / 2 + (k * length) / 4, 3.75, 8.9), 0x9aa0a8));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/** ピットの建物：横に長い 2 階建てとガレージの開口 */
function pitGeometry(length: number) {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.BoxGeometry(length, 6, 12).translate(0, 3, -6), 0xb9bdc4));
  parts.push(paint(new THREE.BoxGeometry(length, 0.8, 0.3).translate(0, 4.2, 0.1), 0x2a6fd6));
  for (let k = 0; k < 10; k++) {
    const x = -length / 2 + (k + 0.5) * (length / 10);
    parts.push(paint(new THREE.BoxGeometry(length / 10 - 1.5, 3.2, 0.2).translate(x, 1.6, 0.05), 0x2a2d33));
  }
  parts.push(paint(new THREE.BoxGeometry(length, 1.4, 0.2).translate(0, 5, 0.05), 0x30363f));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

export class CourseMesh {
  readonly group = new THREE.Group();
  private readonly cones: THREE.InstancedMesh | null = null;
  private readonly tires: THREE.InstancedMesh | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(readonly c: CourseData, readonly pw: PhysicsWorld) {
    const track = <T extends { dispose(): void }>(x: T) => { this.disposables.push(x); return x; };
    const vcol = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));

    // 地形
    {
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(c.terrain.vertices, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c.terrain.colors, 3));
      const n = c.terrain.vertices.length / 3;
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
      const m = new THREE.InstancedMesh(track(barrierGeometry()), track(new THREE.MeshStandardMaterial({ color: 0xcfd0cc, roughness: 0.9 })), c.walls.length);
      c.walls.forEach((w, i) => {
        q.setFromAxisAngle(Y, w.yaw);
        sc.set(1, 1, w.half[2] * 2);
        ps.set(w.cx, w.cy, w.cz);
        m.setMatrixAt(i, m4.compose(ps, q, sc));
      });
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }

    // 木
    const treeCount = quality.level === 'low' ? Math.min(250, c.trees.length) : quality.level === 'medium' ? Math.min(700, c.trees.length) : c.trees.length;
    if (treeCount > 0) {
      const m = new THREE.InstancedMesh(track(treeGeometry()), vcol, treeCount);
      for (let i = 0; i < treeCount; i++) {
        const [x, y, z, s] = c.trees[i];
        q.setFromAxisAngle(Y, (i * 2.39996) % (Math.PI * 2));
        sc.set(s, s * (0.85 + ((i * 7) % 5) * 0.08), s);
        ps.set(x, y - 0.1, z);
        m.setMatrixAt(i, m4.compose(ps, q, sc));
      }
      m.castShadow = quality.level === 'high';
      m.receiveShadow = true;
      this.group.add(m);
    }

    // 街の建物：壁と、階ごとに帯の窓。全部を 2 つの形にまとめて描く
    {
      const walls: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
      const m4 = new THREE.Matrix4();
      for (const b of c.buildings) {
        if (b.kind !== 'block') continue;
        const h = b.height ?? 12, d = b.depth ?? 14, l = b.length;
        m4.makeRotationY(b.yaw).setPosition(b.x, b.y, b.z);
        walls.push(paint(new THREE.BoxGeometry(d, h, l).translate(0, h / 2, 0), b.color ?? 0xb8b0a4).applyMatrix4(m4));
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
      const g = track(b.kind === 'stand' ? standGeometry(b.length) : pitGeometry(b.length));
      const m = new THREE.Mesh(g, vcol);
      // 長さの向きを走る向きに。観客席は外向きに段が上がる
      m.rotation.y = b.yaw + Math.PI / 2;
      m.position.set(b.x, b.y - 0.2, b.z);
      // 観客席は段が外へ上がるように、ピットはガレージの開口がコースを向くように回す
      m.rotateY(Math.PI);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }

    // 遠くの山
    {
      const { x0, z0, x1, z1 } = c.bounds;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const R = Math.max(x1 - x0, z1 - z0) * 0.5 + 900;
      const parts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2 + (k % 3) * 0.05;
        const h = 120 + ((k * 53) % 7) * 45;
        parts.push(paint(new THREE.ConeGeometry(h * 2.2, h, 5).translate(cx + Math.cos(a) * R, h / 2 - 20, cz + Math.sin(a) * R), k % 2 ? 0x5f7a66 : 0x6c8572));
      }
      const m = new THREE.Mesh(track(mergeGeometries(parts)!), track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));
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
