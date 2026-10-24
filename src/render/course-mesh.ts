// コースの見た目。物理と同じ配列から作る。
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CourseData } from '../sim/course';
import { SURFACES } from '../sim/surfaces';
import type { PhysicsWorld } from '../sim/world';
import { checkerTexture, groundDetailTexture, roadTexture, stripeTexture } from './textures';

export class CourseMesh {
  readonly group = new THREE.Group();
  private readonly cones: THREE.InstancedMesh | null = null;
  private readonly tires: THREE.InstancedMesh | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(readonly c: CourseData, readonly pw: PhysicsWorld) {
    const track = <T extends { dispose(): void }>(x: T) => { this.disposables.push(x); return x; };

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
        mats.push(track(new THREE.MeshStandardMaterial({ map: track(roadTexture(p.surface)), roughness: 0.95 })));
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

    // 壁
    if (c.walls.length > 0) {
      const g = track(new THREE.BoxGeometry(1, 1, 1));
      const m = new THREE.InstancedMesh(g, track(new THREE.MeshStandardMaterial({ color: 0xc9c9c4, roughness: 0.9 })), c.walls.length);
      const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      c.walls.forEach((w, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.yaw);
        s.set(w.half[0] * 2, w.half[1] * 2, w.half[2] * 2);
        p.set(w.cx, w.cy, w.cz);
        m.setMatrixAt(i, mat.compose(p, q, s));
      });
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }

    // 動く小物（コーン、タイヤ）
    const cones = pw.props.filter((p) => p.kind === 'cone');
    const tires = pw.props.filter((p) => p.kind === 'tire');
    if (cones.length > 0) {
      const body = new THREE.ConeGeometry(0.16, 0.66, 16).translate(0, 0.03, 0);
      const base = new THREE.BoxGeometry(0.38, 0.04, 0.38).translate(0, -0.32, 0);
      const g = track(mergeGeometries([body, base])!);
      this.cones = new THREE.InstancedMesh(g, track(new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.6 })), cones.length);
      this.cones.castShadow = true;
      this.cones.frustumCulled = false;
      this.group.add(this.cones);
    }
    if (tires.length > 0) {
      const g = track(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 18));
      this.tires = new THREE.InstancedMesh(g, track(new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.95 })), tires.length);
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
