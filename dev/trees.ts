// 開発用：木の形を並べて見る（npx vite で開き、/dev/trees.html）
import * as THREE from 'three';
import type { TreeKind } from '../src/render/trees';
import { DOUBLE_SIDED, treeVariants } from '../src/render/trees';
import { DAY, Sky, sunDirection } from '../src/render/sky';

const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(innerWidth, innerHeight);
r.toneMapping = THREE.ACESFilmicToneMapping;
r.toneMappingExposure = 1.05;
r.shadowMap.enabled = true;
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
const sky = new Sky(); sky.set(DAY); scene.add(sky.mesh);
scene.fog = new THREE.Fog(0xc7dbeb, 100, 36000);
scene.add(new THREE.HemisphereLight(0xc7dbeb, 0x56603f, 0.55));
const sun = new THREE.DirectionalLight(0xfff1d8, 2.8);
sun.position.copy(sunDirection(DAY)).multiplyScalar(80);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 300 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x4f7a3a }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const kinds: TreeKind[] = ['conifer', 'broadleaf', 'umbrella', 'cypress', 'palm'];
kinds.forEach((k, i) => treeVariants(k).forEach((g, j) => {
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: DOUBLE_SIDED[k] ? THREE.DoubleSide : THREE.FrontSide }));
  m.position.set((i - 2) * 14, 0, -j * 14);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
}));
const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 5000);
cam.position.set(0, 9, 32); cam.lookAt(0, 7, -10);
r.render(scene, cam);
(window as unknown as { done: boolean }).done = true;
