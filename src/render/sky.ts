// 空。上ほど濃い青、地平線は白っぽく、太陽のまわりを明るくする。
// 同じ空を映り込み用の環境マップにも使う（車の塗装やガラスに空が映る）。
import * as THREE from 'three';

export interface SkySettings {
  top: THREE.ColorRepresentation;
  horizon: THREE.ColorRepresentation;
  ground: THREE.ColorRepresentation;
  /** 太陽の向き（高さ、方位 [度]） */
  sunElevation: number;
  sunAzimuth: number;
  sunColor: THREE.ColorRepresentation;
  sunIntensity: number;
  ambient: number;
  fogNear: number;
  fogFar: number;
}

export const DAY: SkySettings = {
  top: 0x2f6fc0, horizon: 0xc7dbeb, ground: 0x6b6f5a, sunElevation: 38, sunAzimuth: 135,
  sunColor: 0xfff1d8, sunIntensity: 2.8, ambient: 0.55, fogNear: 100, fogFar: 36000,
};

export function sunDirection(s: SkySettings) {
  const el = (s.sunElevation * Math.PI) / 180, az = (s.sunAzimuth * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(horizon, ground, pow(clamp(-h, 0.0, 1.0), 0.35));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 16.0) * 0.22);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.mat);
    this.mesh.scale.setScalar(4000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  set(s: SkySettings) {
    const u = this.mat.uniforms;
    (u.top.value as THREE.Color).set(s.top);
    (u.horizon.value as THREE.Color).set(s.horizon);
    (u.ground.value as THREE.Color).set(s.ground);
    (u.sunColor.value as THREE.Color).set(s.sunColor);
    (u.sunDir.value as THREE.Vector3).copy(sunDirection(s));
  }
}
