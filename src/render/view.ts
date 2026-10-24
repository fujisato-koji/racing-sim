// 描画。レースの画面（運転席視点と後方視点、バックミラー）と、メニューの後ろに出す車庫の画面。
import * as THREE from 'three';
import type { Session } from '../game/session';
import type { CarParams } from '../sim/params';
import { carGeometry } from '../sim/params';
import type { Vehicle } from '../sim/vehicle';
import { onLayoutChange, viewSize } from '../ui/layout';
import { Gauges } from '../ui/gauges';
import { CarMesh } from './car-mesh';
import { CourseMesh } from './course-mesh';
import { quality } from './quality';
import type { SkySettings } from './sky';
import { DAY, Sky, sunDirection } from './sky';

export type CameraMode = 'cockpit' | 'chase';

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky = new Sky();
  private readonly pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skySettings: SkySettings = DAY;
  private readonly mainCam = new THREE.PerspectiveCamera(70, 1, 0.08, 6000);
  private readonly mirrorCam = new THREE.PerspectiveCamera(24, 3.6, 0.1, 800);
  private readonly mirrorTarget = new THREE.WebGLRenderTarget(512, 142);
  private readonly hudScene = new THREE.Scene();
  private readonly hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private readonly mirrorQuad: THREE.Mesh;
  private readonly mirrorFrame: THREE.Mesh;
  private session: Session | null = null;
  private courseMesh: CourseMesh | null = null;
  private readonly cars = new Map<Vehicle, CarMesh>();
  mode: CameraMode = 'chase';
  showMirror = true;
  private readonly chasePos = new THREE.Vector3();
  // 運転席のメーター（画面の計器と同じ絵をテクスチャにする）
  private readonly cluster = new Gauges(512, 240);
  private readonly clusterTex = new THREE.CanvasTexture(this.cluster.canvas);
  private clusterMesh: THREE.Group | null = null;
  private chaseInit = false;

  // 車庫
  private readonly garage = new THREE.Scene();
  private readonly garageCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private garageCar: CarMesh | null = null;
  private garageAngle = 0;
  // 描く画素の数の自動調整
  private basePR = 1;
  private prScale = 1;
  private frameAvg = 1 / 60;
  private sinceAdjust = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.applyQuality();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog(0xc7dbeb, 300, 2600);
    this.scene.add(this.sky.mesh);
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x56603f, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sun.castShadow = true;
    const sm = quality.level === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.setSky(DAY);

    // バックミラー：後ろ向きのカメラで描いた絵を、左右反転して画面上部に貼る
    this.mirrorTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.mirrorFrame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    this.mirrorQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture, side: THREE.DoubleSide }));
    this.hudScene.add(this.mirrorFrame, this.mirrorQuad);

    // 車庫
    this.garage.background = new THREE.Color(0x20242b);
    this.garage.add(new THREE.HemisphereLight(0xdde8ff, 0x303030, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(4, 6, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.garage.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.garage.add(floor);

    onLayoutChange(() => this.resize());
    this.resize();
  }

  /** 描画の質を当てはめる（画素の数、影） */
  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const lv = quality.level;
    this.basePR = lv === 'low' ? Math.min(dpr, 1) : lv === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    if (quality.pref !== 'auto') this.prScale = 1;
    this.renderer.setPixelRatio(this.basePR * this.prScale);
    this.renderer.shadowMap.enabled = lv !== 'low';
    if (this.sun) this.sun.castShadow = lv !== 'low';
  }

  /** 空、太陽、霧、映り込みを当てはめる（天候と時間帯でも使う） */
  setSky(s: SkySettings) {
    this.skySettings = s;
    this.sky.set(s);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(s.horizon);
    fog.near = s.fogNear; fog.far = s.fogFar;
    this.sun.color.set(s.sunColor);
    this.sun.intensity = s.sunIntensity;
    this.hemi.intensity = s.ambient;
    this.hemi.color.set(s.horizon);
    // 映り込み：空だけの場面から環境マップを作る（質が低いときは作らない）
    this.envRT?.dispose();
    this.envRT = null;
    if (quality.level !== 'low') {
      const envScene = new THREE.Scene();
      const dome = new Sky();
      dome.set(s);
      dome.mesh.scale.setScalar(50);
      envScene.add(dome.mesh);
      this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 200);
      this.scene.environment = this.envRT.texture;
      this.garage.environment = this.envRT.texture;
      dome.mesh.geometry.dispose();
    } else {
      this.scene.environment = null;
      this.garage.environment = null;
    }
  }

  /** 質を変えたときに映り込みを作り直す */
  refreshSky() { this.setSky(this.skySettings); }

  /** フレームの時間を見て、描く画素の数を増減する（自動のときだけ） */
  private adapt(dt: number) {
    if (quality.pref !== 'auto') return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    this.sinceAdjust += dt;
    if (this.sinceAdjust < 2) return;
    let next = this.prScale;
    if (this.frameAvg > 1 / 45) next = Math.max(0.55, this.prScale - 0.1);
    else if (this.frameAvg < 1 / 57 && this.prScale < 1) next = Math.min(1, this.prScale + 0.05);
    if (next !== this.prScale) {
      this.prScale = next;
      this.renderer.setPixelRatio(this.basePR * this.prScale);
      this.resize();
      this.sinceAdjust = 0;
    } else this.sinceAdjust = 1.5;
  }

  resize() {
    const { w, h } = viewSize();
    this.renderer.setSize(w, h);
    this.mainCam.aspect = w / h;
    this.mainCam.updateProjectionMatrix();
    this.garageCam.aspect = w / h;
    this.garageCam.updateProjectionMatrix();
    this.hudCam.right = w; this.hudCam.top = h;
    this.hudCam.updateProjectionMatrix();
    const mw = Math.min(440, w * 0.34), mh = mw / 3.6;
    const dpr = this.renderer.getPixelRatio();
    this.mirrorTarget.setSize(Math.round(mw * dpr), Math.round(mh * dpr));
    // 左右反転（scale.x を負に）
    this.mirrorQuad.scale.set(-mw, mh, 1);
    this.mirrorQuad.position.set(w / 2, h - 14 - mh / 2, 0);
    this.mirrorFrame.scale.set(mw + 8, mh + 8, 1);
    this.mirrorFrame.position.set(w / 2, h - 14 - mh / 2, -0.5);
  }

  // ------------------------------------------------------------ レース
  setSession(s: Session) {
    this.clearSession();
    this.session = s;
    this.courseMesh = new CourseMesh(s.course, s.pw);
    this.scene.add(this.courseMesh.group);
    for (const r of s.racers) {
      const m = new CarMesh(r.vehicle.p);
      this.cars.set(r.vehicle, m);
      this.scene.add(m.group);
    }
    const pv = s.player?.vehicle;
    if (pv) {
      // ハンドルの奥、計器盤の上に低く置く（前の景色をふさがないよう、目線から 20° ほど下に見える高さ）
      const g = carGeometry(pv.p);
      const [ex, , ez] = g.eye;
      const grp = new THREE.Group();
      this.clusterTex.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.14), new THREE.MeshBasicMaterial({ map: this.clusterTex, transparent: true, toneMapped: false }));
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.9 }));
      hood.position.z = -0.03;
      grp.add(hood, face);
      grp.position.set(ex, g.beltY + 0.165, ez - 0.5);
      // 運転席の目のほうへ向ける
      grp.rotation.x = -0.38;
      this.cars.get(pv)!.group.add(grp);
      this.clusterMesh = grp;
    }
    this.chaseInit = false;
  }

  clearSession() {
    if (this.courseMesh) { this.scene.remove(this.courseMesh.group); this.courseMesh.dispose(); this.courseMesh = null; }
    for (const m of this.cars.values()) { this.scene.remove(m.group); m.dispose(); }
    this.cars.clear();
    this.clusterMesh = null;
    this.session = null;
  }

  toggleCamera() {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    this.chaseInit = false;
  }

  render(dt: number) {
    const s = this.session;
    if (!s) return;
    this.adapt(dt);
    for (const [v, m] of this.cars) m.update(v, s.alpha);
    this.courseMesh?.updateProps();
    const pv = s.player?.vehicle ?? s.racers[0]?.vehicle;
    if (!pv) return;
    const car = this.cars.get(pv)!;
    const pos = car.group.position, quat = car.group.quaternion;
    const geo = carGeometry(pv.p);

    // 運転席視点か後方視点
    if (this.clusterMesh) this.clusterMesh.visible = this.mode === 'cockpit';
    if (this.mode === 'cockpit') {
      this.cluster.draw(pv);
      this.clusterTex.needsUpdate = true;
      this.mainCam.fov = 72;
      this.mainCam.position.set(...geo.eye).applyQuaternion(quat).add(pos);
      this.mainCam.quaternion.copy(quat);
    } else {
      this.mainCam.fov = 60;
      // 空中で車体が回っても、カメラは水平の向きだけ追う
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      f.y = 0;
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      f.normalize();
      const dist = pv.p.body.length * 1.3 + 2.6, height = 1.5 + pv.p.body.height * 0.55;
      const want = new THREE.Vector3().copy(pos).addScaledVector(f, -dist);
      want.y = pos.y + height;
      if (!this.chaseInit) { this.chasePos.copy(want); this.chaseInit = true; }
      this.chasePos.lerp(want, 1 - Math.exp(-dt * 7));
      // 地面にめり込まない
      const ground = s.course.heightAt(this.chasePos.x, this.chasePos.z) + 0.6;
      if (this.chasePos.y < ground) this.chasePos.y = ground;
      this.mainCam.position.copy(this.chasePos);
      this.mainCam.lookAt(new THREE.Vector3().copy(pos).addScaledVector(f, 3).add(new THREE.Vector3(0, 0.7, 0)));
    }
    this.mainCam.updateProjectionMatrix();

    // 影は自車のまわりだけ。空は目の位置に合わせて動かす
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).addScaledVector(sunDirection(this.skySettings), 150);
    this.sky.mesh.position.copy(this.mainCam.position);

    const r = this.renderer;
    if (this.showMirror) {
      // 鏡は目の少し前と上。フロントガラスが寝ているので、その高さでのガラスより内側に置く
      const my = geo.eye[1] + 0.08;
      const cabH = geo.bodyTopY - geo.beltY;
      const glassZ = geo.cabinFrontZ + (cabH * 1.1 * (my - geo.beltY)) / (cabH - 0.03);
      const mz = Math.min(geo.eye[2] - 0.05, Math.max(geo.eye[2] - 0.25, glassZ + 0.1));
      this.mirrorCam.position.set(geo.eye[0] * 0.2, my, mz).applyQuaternion(quat).add(pos);
      this.mirrorCam.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      r.setRenderTarget(this.mirrorTarget);
      r.clear();
      r.render(this.scene, this.mirrorCam);
    }
    r.setRenderTarget(null);
    r.clear();
    r.render(this.scene, this.mainCam);
    if (this.showMirror) {
      r.clearDepth();
      r.render(this.hudScene, this.hudCam);
    }
  }

  // ------------------------------------------------------------ 車庫
  showCar(p: CarParams | null) {
    if (this.garageCar) { this.garage.remove(this.garageCar.group); this.garageCar.dispose(); this.garageCar = null; }
    if (!p) return;
    this.garageCar = new CarMesh(p);
    const g = carGeometry(p);
    this.garageCar.group.position.set(0, -g.groundY, 0);
    this.garage.add(this.garageCar.group);
  }

  renderGarage(dt: number) {
    this.garageAngle += dt * 0.35;
    if (this.garageCar) this.garageCar.group.rotation.y = this.garageAngle;
    const L = this.garageCar?.p.body.length ?? 4.3;
    const D = L * 2.3;
    this.garageCam.position.set(Math.sin(0.6) * D, L * 0.55, Math.cos(0.6) * D);
    // メニューは左に出るので、車は右半分に見せる
    this.garageCam.lookAt(-L * 0.55, 0.35, L * 0.2);
    const r = this.renderer;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.garage, this.garageCam);
  }
}
