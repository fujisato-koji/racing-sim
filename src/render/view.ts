// 描画。レースの画面（運転席視点と後方視点、バックミラー）と、メニューの後ろに出す車庫の画面。
import * as THREE from 'three';
import { sampleGhost } from '../game/ghost';
import type { Session } from '../game/session';
import type { CarParams } from '../sim/params';
import { carGeometry } from '../sim/params';
import type { Vehicle } from '../sim/vehicle';
import { onLayoutChange, viewSize } from '../ui/layout';
import { Gauges } from '../ui/gauges';
import { CarMesh } from './car-mesh';
import { CourseMesh } from './course-mesh';
import { FAR_TREE_LAYER } from './forest';
import { Globe } from './globe';
import type { SceneryData, SceneryMesh } from './scenery';
import { SCENERY_LAYER, buildScenery } from './scenery';
import { themeOf } from './themes';
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
  // 遠景（まわり 30 km の地形と空）を先に描くカメラ。手前とは奥行きを分ける
  private readonly farCam = new THREE.PerspectiveCamera(70, 1, 30, 80000);
  private readonly mirrorFarCam = new THREE.PerspectiveCamera(24, 3.6, 30, 80000);
  private scenery: SceneryMesh | null = null;
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
  // タイムアタックのゴースト（最速の周の車。半透明で、ぶつからない）
  private ghost: CarMesh | null = null;
  private readonly ghostMat = new THREE.MeshBasicMaterial({ color: 0xa8d4ff, transparent: true, opacity: 0.3, depthWrite: false });
  showGhost = true;

  // 車庫
  private readonly garage = new THREE.Scene();
  private readonly garageCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private garageCar: CarMesh | null = null;
  private garageAngle = 0;
  private garageRing: THREE.MeshBasicMaterial | null = null;
  private garageTime = 0;
  // コースを選ぶ画面の地球儀
  private globe: Globe | null = null;
  private globeOn = false;
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
    this.sky.mesh.layers.set(SCENERY_LAYER);
    this.scene.add(this.sky.mesh);
    this.farCam.layers.set(SCENERY_LAYER);
    // 簡単な形の遠くの木は前のカメラだけが写す（バックミラーと影には出さない）
    this.mainCam.layers.enable(FAR_TREE_LAYER);
    this.mirrorFarCam.layers.set(SCENERY_LAYER);
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x56603f, 0.55);
    this.hemi.layers.enable(SCENERY_LAYER);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sun.layers.enable(SCENERY_LAYER);
    // 影は 1 フレームに 1 回だけ作る（遠景、手前、ミラーで描き分けても）
    this.renderer.shadowMap.autoUpdate = false;
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

    // 車庫（ショールーム）：暗い部屋、光る輪の回転台、床の光だまり、上からの照明と、青と橙の縁の光
    {
      const g = this.garage;
      g.background = new THREE.Color(0x05080e);
      g.fog = new THREE.Fog(0x05080e, 14, 34);
      // 奥の壁：上が暗く、床の近くが少し明るい
      const wall = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec3 vP; void main() {
          float h = normalize(vP).y;
          vec3 c = mix(vec3(0.016, 0.03, 0.055), vec3(0.004, 0.006, 0.012), smoothstep(-0.05, 0.5, h));
          c += vec3(0.05, 0.03, 0.01) * exp(-abs(h) * 14.0);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      }));
      g.add(wall);
      g.add(new THREE.HemisphereLight(0x9fbfff, 0x101418, 0.55));
      const key = new THREE.SpotLight(0xfff4e6, 70, 30, 0.6, 0.7, 1.2);
      key.position.set(2.5, 8, 4.5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.0005;
      g.add(key, key.target);
      const rimBlue = new THREE.DirectionalLight(0x4aa8ff, 2.2);
      rimBlue.position.set(-6, 3, -5);
      const rimOrange = new THREE.DirectionalLight(0xff9a3a, 1.8);
      rimOrange.position.set(6, 2.5, -4);
      g.add(rimBlue, rimOrange);
      // 床：暗く、つやを抑えた床（後ろの縁の光が床で照り返さないように）
      const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 96), new THREE.MeshStandardMaterial({ color: 0x0c1017, roughness: 0.95, metalness: 0, envMapIntensity: 0.05 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      g.add(floor);
      // 回転台と光る輪
      const table = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.7, 0.06, 96), new THREE.MeshStandardMaterial({ color: 0x151b25, roughness: 0.75, metalness: 0.1, envMapIntensity: 0.1 }));
      table.position.y = -0.03;
      table.receiveShadow = true;
      g.add(table);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.62, 3.72, 128), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      g.add(ring);
      // 床の光だまり（真ん中が明るく外へ消える）
      const pc = document.createElement('canvas');
      pc.width = pc.height = 256;
      const px = pc.getContext('2d')!;
      const rg = px.createRadialGradient(128, 128, 0, 128, 128, 128);
      rg.addColorStop(0, 'rgba(90,140,230,0.22)'); rg.addColorStop(0.5, 'rgba(50,90,170,0.08)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      px.fillStyle = rg; px.fillRect(0, 0, 256, 256);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.006;
      g.add(pool);
      // 床の細い同心円
      for (const r of [5.5, 8, 11]) {
        const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.02, 160), new THREE.MeshBasicMaterial({ color: 0x3a6fb8, transparent: true, opacity: 0.25, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.004;
        g.add(m);
      }
      this.garageRing = ringMat;
    }

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
    this.hemi.color.set(s.horizon).lerp(new THREE.Color(s.top), 0.5);
    this.hemi.groundColor.set(s.ground).multiplyScalar(0.85);
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
  setSession(s: Session, scenery: SceneryData | null = null) {
    this.clearSession();
    this.session = s;
    const id = s.course.def.id;
    // コースの色のテーマ（空、光、霞、植生、建物の色）
    const theme = themeOf(id);
    this.setSky(theme.sky);
    this.renderer.toneMappingExposure = theme.exposure;
    this.courseMesh = new CourseMesh(s.course, s.pw, theme);
    this.scene.add(this.courseMesh.group);
    this.scenery = buildScenery(s.course, scenery, theme, [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7));
    this.scene.add(this.scenery.group);
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
    if (s.attack && pv) {
      const m = new CarMesh(pv.p);
      m.group.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.material = this.ghostMat; o.castShadow = false; o.receiveShadow = false; }
      });
      m.group.visible = false;
      this.ghost = m;
      this.scene.add(m.group);
    }
    this.chaseInit = false;
  }

  clearSession() {
    if (this.courseMesh) { this.scene.remove(this.courseMesh.group); this.courseMesh.dispose(); this.courseMesh = null; }
    if (this.scenery) { this.scene.remove(this.scenery.group); this.scenery.dispose(); this.scenery = null; }
    if (this.skySettings !== DAY) { this.setSky(DAY); this.renderer.toneMappingExposure = 1.05; }
    for (const m of this.cars.values()) { this.scene.remove(m.group); m.dispose(); }
    this.cars.clear();
    if (this.ghost) { this.scene.remove(this.ghost.group); this.ghost.dispose(); this.ghost = null; }
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
    this.placeGhost(s, pos);
    this.courseMesh?.updateView(pos.x, pos.z);

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
    this.renderer.shadowMap.needsUpdate = true;

    const r = this.renderer;
    // 遠景を描いてから奥行きを消し、手前を重ねる
    const far = (cam: THREE.PerspectiveCamera, fc: THREE.PerspectiveCamera) => {
      fc.position.copy(cam.position);
      fc.quaternion.copy(cam.quaternion);
      fc.fov = cam.fov; fc.aspect = cam.aspect;
      fc.updateProjectionMatrix();
      this.sky.mesh.position.copy(cam.position);
      r.render(this.scene, fc);
      r.clearDepth();
    };
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
      this.mirrorCam.updateMatrixWorld();
      far(this.mirrorCam, this.mirrorFarCam);
      r.render(this.scene, this.mirrorCam);
    }
    r.setRenderTarget(null);
    r.clear();
    this.mainCam.updateMatrixWorld();
    far(this.mainCam, this.farCam);
    r.render(this.scene, this.mainCam);
    if (this.showMirror) {
      r.clearDepth();
      r.render(this.hudScene, this.hudCam);
    }
  }

  /** ゴーストを最速の周の同じ時刻の位置に置く。自車に重なるほど薄くする */
  private placeGhost(s: Session, playerPos: THREE.Vector3) {
    const g = this.ghost, a = s.attack;
    if (!g || !a) return;
    const best = a.best;
    const t = a.lapTime + s.alpha * s.pw.dt;
    g.group.visible = this.showGhost && !!best && s.race.state === 'running' && t <= best.time + 0.5;
    if (!g.group.visible || !best) return;
    sampleGhost(best, t, g.group.position, g.group.quaternion);
    const d = g.group.position.distanceTo(playerPos);
    this.ghostMat.opacity = 0.42 * Math.min(1, Math.max(0, (d - 2) / 8));
    g.group.visible = this.ghostMat.opacity > 0.01;
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

  /** コースを選ぶ画面の地球儀を出す（はじめて出すときに作る） */
  showGlobe(): Globe {
    this.globe ??= new Globe();
    this.globe.attach(this.renderer.domElement);
    this.globeOn = true;
    return this.globe;
  }

  hideGlobe() {
    this.globe?.detach();
    this.globeOn = false;
  }

  renderGarage(dt: number) {
    if (this.globeOn && this.globe) { this.globe.render(this.renderer, dt); return; }
    this.garageAngle += dt * 0.35;
    this.garageTime += dt;
    if (this.garageRing) this.garageRing.opacity = 0.65 + 0.3 * Math.sin(this.garageTime * 2.2);
    if (this.garageCar) this.garageCar.group.rotation.y = this.garageAngle;
    const L = this.garageCar?.p.body.length ?? 4.3;
    const D = L * 2.3;
    this.garageCam.position.set(Math.sin(0.6) * D, L * 0.36, Math.cos(0.6) * D);
    // メニューは左に出るので、車は右半分に見せる。低めから見上げて大きく見せる
    this.garageCam.lookAt(-L * 0.62, 0.5, L * 0.15);
    const r = this.renderer;
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.garage, this.garageCam);
  }
}
