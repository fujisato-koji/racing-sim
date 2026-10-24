// コースを選ぶ画面の地球儀。暗い海、光る点で描いた陸、大気の光、実在のサーキットの位置に立つ光の柱。
// ドラッグで回し、ホイールかピンチで寄る。柱を選ぶと、その場所が正面に来るように回って寄る。
import * as THREE from 'three';
import { toView, viewSize } from '../ui/layout';
import { LAND_BITS, LAND_N } from './globe-land';
import { fibLatLon, latLonToVec } from './globe-points';

export interface GlobeMarker { id: string; lat: number; lon: number; color: string }

interface MarkerObj {
  m: GlobeMarker;
  group: THREE.Group;
  spike: THREE.Mesh;
  head: THREE.Sprite;
  ring: THREE.Mesh;
  /** 地球の上の向き（回す前） */
  normal: THREE.Vector3;
  mat: { spike: THREE.MeshBasicMaterial; head: THREE.SpriteMaterial; ring: THREE.MeshBasicMaterial };
}

const D2R = Math.PI / 180;
const FAR = 3.4, NEAR = 2.35;

function landPositions() {
  const bin = atob(LAND_BITS);
  const pos: number[] = [];
  for (let i = 0; i < LAND_N; i++) {
    if (!(bin.charCodeAt(i >> 3) & (1 << (i & 7)))) continue;
    const [lat, lon] = fibLatLon(i, LAND_N);
    const [x, y, z] = latLonToVec(lat, lon);
    pos.push(x * 1.003, y * 1.003, z * 1.003);
  }
  return new Float32Array(pos);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT_VIEW = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

export class Globe {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 300);
  private readonly earth = new THREE.Group();
  private readonly markers: MarkerObj[] = [];
  private readonly glow = glowTexture();
  private readonly landMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  private yaw = -2.2;
  private pitch = 0.45;
  private dist = FAR;
  private tYaw: number | null = null;
  private tPitch = 0.45;
  private tDist = FAR;
  private vYaw = 0;
  private vPitch = 0;
  private idle = 0;
  private time = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private readonly pointers = new Map<number, [number, number]>();
  private pinch0 = 0;
  private pinchDist0 = FAR;
  selected: string | null = null;
  private hovered: string | null = null;
  /** 地球儀の中心を置く位置（画面の幅に対する割合） */
  centerX = 0.64;
  /** 地球儀の中心を置く高さ（画面の高さに対する割合） */
  centerY = 0.5;
  private tCenterX = 0.64;
  private tCenterY = 0.5;
  /** title はタイトル画面（地平線のように下に大きく置く）、select はコースを選ぶ画面 */
  private framing: 'title' | 'select' = 'select';
  onPick: ((id: string) => void) | null = null;
  private dom: HTMLElement | null = null;
  private readonly handlers: [string, (e: Event) => void][] = [];

  constructor() {
    const track = <T extends { dispose(): void }>(x: T) => { this.disposables.push(x); return x; };
    this.scene.background = new THREE.Color(0x02060d);
    this.scene.add(this.earth);

    // 海：中心は暗く、縁は明るい
    const ocean = new THREE.Mesh(track(new THREE.SphereGeometry(1, 96, 64)), track(new THREE.ShaderMaterial({
      vertexShader: VERT_VIEW,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.2);
          float l = 0.6 + 0.4 * max(dot(vN, normalize(vec3(-0.5, 0.6, 0.6))), 0.0);
          vec3 c = vec3(0.020, 0.055, 0.105) * l + vec3(0.10, 0.36, 0.62) * f;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })));
    ocean.renderOrder = 0;
    this.earth.add(ocean);

    // 緯線と経線（30° ごと）
    const grid: number[] = [];
    const R = 1.0015;
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let k = 0; k < 120; k++) {
        const a = latLonToVec(lat, (k / 120) * 360), b = latLonToVec(lat, ((k + 1) / 120) * 360);
        grid.push(a[0] * R, a[1] * R, a[2] * R, b[0] * R, b[1] * R, b[2] * R);
      }
    }
    for (let lon = 0; lon < 360; lon += 30) {
      for (let k = 0; k < 60; k++) {
        const a = latLonToVec(-90 + (k / 60) * 180, lon), b = latLonToVec(-90 + ((k + 1) / 60) * 180, lon);
        grid.push(a[0] * R, a[1] * R, a[2] * R, b[0] * R, b[1] * R, b[2] * R);
      }
    }
    const gg = track(new THREE.BufferGeometry());
    gg.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    this.earth.add(new THREE.LineSegments(gg, track(new THREE.LineBasicMaterial({ color: 0x2b6a9e, transparent: true, opacity: 0.22, depthWrite: false }))));

    // 陸：光る点。縁に近い点は薄くして丸みを出す
    const lg = track(new THREE.BufferGeometry());
    lg.setAttribute('position', new THREE.BufferAttribute(landPositions(), 3));
    this.landMat = track(new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 }, size: { value: 0.0062 }, maxSize: { value: 6 } },
      vertexShader: /* glsl */ `
        uniform float scale; uniform float size; uniform float maxSize;
        varying float vFace; varying float vY;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * position);
          vFace = dot(n, normalize(-mv.xyz));
          vY = position.y;
          gl_PointSize = clamp(size * scale / -mv.z, 1.0, maxSize);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vFace; varying float vY;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.2, r);
          float face = smoothstep(0.0, 0.45, vFace);
          vec3 c = mix(vec3(0.32, 0.80, 1.0), vec3(0.55, 1.0, 0.92), smoothstep(-0.2, 0.9, vY));
          gl_FragColor = vec4(c, a * (0.18 + 0.82 * face));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const land = new THREE.Points(lg, this.landMat);
    land.renderOrder = 1;
    this.earth.add(land);

    // 大気の光（地球の外側だけ）
    const atm = new THREE.Mesh(track(new THREE.SphereGeometry(1.16, 64, 48)), track(new THREE.ShaderMaterial({
      vertexShader: VERT_VIEW,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          float i = smoothstep(0.0, 0.52, -dot(vN, vV));
          gl_FragColor = vec4(vec3(0.22, 0.62, 1.0) * pow(i, 2.2) * 0.95, 1.0);
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })));
    this.scene.add(atm);

    // 星
    const star: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) {
      const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      star.push(Math.cos(t) * r * 80, u * 80, Math.sin(t) * r * 80);
    }
    const sg = track(new THREE.BufferGeometry());
    sg.setAttribute('position', new THREE.Float32BufferAttribute(star, 3));
    this.earth.add(new THREE.Points(sg, track(new THREE.PointsMaterial({ color: 0xc8d8ff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }))));
  }

  setMarkers(list: GlobeMarker[]) {
    for (const o of this.markers) {
      this.earth.remove(o.group);
      o.spike.geometry.dispose(); o.ring.geometry.dispose();
      o.mat.spike.dispose(); o.mat.head.dispose(); o.mat.ring.dispose();
    }
    this.markers.length = 0;
    const up = new THREE.Vector3(0, 1, 0), fz = new THREE.Vector3(0, 0, 1);
    for (const m of list) {
      const n = new THREE.Vector3(...latLonToVec(m.lat, m.lon));
      const color = new THREE.Color(m.color);
      const group = new THREE.Group();
      group.position.copy(n);
      const spikeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 1, 6).translate(0, 0.5, 0), spikeMat);
      spike.quaternion.setFromUnitVectors(up, n);
      const headMat = new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const head = new THREE.Sprite(headMat);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.021, 40), ringMat);
      ring.quaternion.setFromUnitVectors(fz, n);
      ring.position.copy(n).multiplyScalar(0.002);
      group.add(spike, head, ring);
      group.renderOrder = 2;
      this.earth.add(group);
      this.markers.push({ m, group, spike, head, ring, normal: n, mat: { spike: spikeMat, head: headMat, ring: ringMat } });
    }
  }

  /** 柱を選ぶ。fly なら、その場所が正面に来るように回って寄る。null なら引いて回り続ける */
  /** 置き方を変える。間の動きはなめらかにつなぐ */
  setFraming(f: 'title' | 'select') {
    this.framing = f;
    if (f === 'title') { this.tCenterX = 0.5; this.tCenterY = 1.02; this.tDist = 2.2; this.tYaw = null; this.tPitch = 0.3; this.selected = null; this.idle = 3; }
    else { this.tCenterX = 0.64; this.tCenterY = 0.5; if (!this.selected) this.tDist = FAR; }
  }

  select(id: string | null, fly = true) {
    this.selected = id;
    const o = this.markers.find((x) => x.m.id === id);
    if (!o) { this.tYaw = null; this.tDist = FAR; this.tPitch = Math.max(-0.6, Math.min(0.6, this.pitch)); return; }
    if (!fly) return;
    let y = -o.m.lon * D2R;
    // 今の向きから近い回り方を選ぶ
    while (y - this.yaw > Math.PI) y -= Math.PI * 2;
    while (y - this.yaw < -Math.PI) y += Math.PI * 2;
    this.tYaw = y;
    this.tPitch = Math.max(-1.2, Math.min(1.2, o.m.lat * D2R));
    this.tDist = NEAR;
    this.vYaw = this.vPitch = 0;
  }

  /** ドラッグかピンチで回している最中か */
  get dragging() { return this.drag !== null && this.drag.moved > 4 || this.pinch0 > 0; }

  /** すべての柱の頭の、画面の上の位置 */
  screenAll() {
    return this.markers.map((o) => ({ id: o.m.id, ...this.screenOf(o.m.id)! }));
  }

  /** 柱の頭の、画面の上の位置（CSS の画素）。裏側にあれば front が false */
  screenOf(id: string) {
    const o = this.markers.find((x) => x.m.id === id);
    if (!o) return null;
    const { w, h } = viewSize();
    const p = new THREE.Vector3().copy(o.head.position).add(o.group.position).applyMatrix4(this.earth.matrixWorld);
    const n = new THREE.Vector3().copy(o.normal).applyQuaternion(this.earth.quaternion);
    const front = n.dot(new THREE.Vector3().copy(this.camera.position).sub(p).normalize()) > 0.08;
    p.project(this.camera);
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, front };
  }

  attach(dom: HTMLElement) {
    this.detach();
    this.dom = dom;
    const on = (type: string, fn: (e: Event) => void, opt?: AddEventListenerOptions) => {
      dom.addEventListener(type, fn, opt);
      this.handlers.push([type, fn]);
    };
    on('pointerdown', (e) => {
      const ev = e as PointerEvent;
      const [x, y] = toView(ev.clientX, ev.clientY);
      this.pointers.set(ev.pointerId, [x, y]);
      try { dom.setPointerCapture(ev.pointerId); } catch { /* 取れなくても動く */ }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.pinchDist0 = this.tDist;
        this.drag = null;
        return;
      }
      this.drag = { x, y, moved: 0 };
      this.vYaw = this.vPitch = 0;
    });
    on('pointermove', (e) => {
      const ev = e as PointerEvent;
      const [x, y] = toView(ev.clientX, ev.clientY);
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, [x, y]);
      if (this.pointers.size === 2 && this.pinch0 > 0) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.tDist = Math.max(1.45, Math.min(5, (this.pinchDist0 * this.pinch0) / Math.max(1, d)));
        return;
      }
      if (this.drag) {
        const dx = x - this.drag.x, dy = y - this.drag.y;
        this.drag.x = x; this.drag.y = y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        // 寄っているほどゆっくり回す
        const k = 0.0042 * (this.dist - 0.9) / (FAR - 0.9);
        this.tYaw = null;
        this.yaw += dx * k; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + dy * k));
        this.tPitch = this.pitch;
        this.vYaw = dx * k * 60; this.vPitch = dy * k * 60;
        this.idle = 0;
        return;
      }
      const hit = this.pick(x, y);
      if (hit !== this.hovered) { this.hovered = hit; dom.style.cursor = hit ? 'pointer' : 'grab'; }
    });
    const up = (e: Event) => {
      const ev = e as PointerEvent;
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch0 = 0;
      const d = this.drag;
      this.drag = null;
      if (d && d.moved < 8) {
        const [x, y] = toView(ev.clientX, ev.clientY);
        const hit = this.pick(x, y);
        if (hit) this.onPick?.(hit);
      }
    };
    on('pointerup', up);
    on('pointercancel', up);
    on('wheel', (e) => {
      const ev = e as WheelEvent;
      ev.preventDefault();
      this.tDist = Math.max(1.45, Math.min(5, this.tDist * Math.exp(ev.deltaY * 0.0012)));
    }, { passive: false });
    dom.style.cursor = 'grab';
  }

  detach() {
    if (!this.dom) return;
    for (const [t, f] of this.handlers) this.dom.removeEventListener(t, f);
    this.handlers.length = 0;
    this.dom.style.cursor = '';
    this.dom = null;
    this.pointers.clear();
    this.drag = null;
  }

  /** 画面の位置 (x, y) にいちばん近い表側の柱（指でも当てやすいよう 26 px 以内） */
  private pick(x: number, y: number): string | null {
    let best: string | null = null, bd = 26;
    for (const o of this.markers) {
      const s = this.screenOf(o.m.id);
      if (!s || !s.front) continue;
      // 柱の頭と根元の間のどこかに近ければよい
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = o.m.id; }
    }
    return best;
  }

  render(r: THREE.WebGLRenderer, dt: number) {
    this.time += dt;
    const { w, h } = viewSize();
    const a = 1 - Math.exp(-dt * 3.2);
    if (!this.drag) {
      if (this.tYaw !== null) {
        this.yaw += (this.tYaw - this.yaw) * a;
        this.pitch += (this.tPitch - this.pitch) * a;
      } else {
        // 手を離したあとは少し滑り、止まったらゆっくり回り続ける
        this.yaw += this.vYaw * dt; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + this.vPitch * dt));
        this.vYaw *= Math.exp(-dt * 3); this.vPitch *= Math.exp(-dt * 3);
        this.idle += dt;
        const spin = this.framing === 'title' ? 0.05 : 0.07;
        if (!this.selected && this.idle > 1.5) this.yaw += dt * spin * Math.min(1, (this.idle - 1.5) / 2);
      }
    }
    this.dist += (this.tDist - this.dist) * a;
    this.centerX += (this.tCenterX - this.centerX) * a;
    this.centerY += (this.tCenterY - this.centerY) * a;
    if (this.framing === 'title' && !this.drag) this.pitch += (this.tPitch - this.pitch) * a;
    this.earth.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    this.earth.updateMatrixWorld();
    this.camera.aspect = w / h;
    this.camera.position.set(0, 0, this.dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.setViewOffset(w, h, w * (0.5 - this.centerX), h * (0.5 - this.centerY), w, h);
    this.camera.updateProjectionMatrix();
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    this.landMat.uniforms.scale.value = buf.y / (2 * Math.tan((this.camera.fov * D2R) / 2));
    this.landMat.uniforms.maxSize.value = (this.framing === 'title' ? 3.6 : 6) * (buf.y / h);

    // 柱：選んだものは高く明るく、根元に広がる輪
    for (const o of this.markers) {
      const sel = o.m.id === this.selected, hov = o.m.id === this.hovered;
      const hgt = sel ? 0.16 : hov ? 0.11 : 0.075;
      const cur = o.spike.scale.y || hgt;
      const k = cur + (hgt - cur) * Math.min(1, dt * 8);
      o.spike.scale.set(1, k, 1);
      o.head.position.copy(o.normal).multiplyScalar(k);
      const s = (sel ? 0.075 : hov ? 0.06 : 0.045) * (1 + 0.12 * Math.sin(this.time * 3 + o.normal.x * 9));
      o.head.scale.set(s, s, 1);
      o.mat.spike.opacity = sel ? 1 : this.selected ? 0.45 : 0.8;
      o.mat.head.opacity = sel ? 1 : this.selected ? 0.55 : 0.9;
      const ph = (this.time * 0.8) % 1;
      o.ring.scale.setScalar(sel ? 1 + ph * 2.6 : 1);
      o.mat.ring.opacity = sel ? 0.9 * (1 - ph) : 0;
    }

    r.setRenderTarget(null);
    r.clear();
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.detach();
    this.setMarkers([]);
    for (const d of this.disposables) d.dispose();
    this.glow.dispose();
  }
}
