// 路面などの模様を canvas で描いてテクスチャにする（画像ファイルを持たない）
import * as THREE from 'three';
import type { SurfaceId } from '../sim/surfaces';
import { SURFACES } from '../sim/surfaces';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, base: number, amount: number, count: number, size: number) {
  const r = (base >> 16) & 255, gg = (base >> 8) & 255, b = base & 255;
  g.fillStyle = `rgb(${r},${gg},${b})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const k = (Math.random() - 0.5) * amount;
    g.fillStyle = `rgb(${r + k},${gg + k},${b + k})`;
    g.fillRect(Math.random() * w, Math.random() * h, size * (0.5 + Math.random()), size * (0.5 + Math.random()));
  }
}

function finish(c: HTMLCanvasElement, repeatV = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = repeatV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 路面の帯。u が幅方向（0〜1）、v が進行方向（8 m で 1） */
export function roadTexture(surface: SurfaceId): THREE.Texture {
  const W = 256, H = 256;
  const { c, g } = canvas(W, H);
  const s = SURFACES[surface];
  if (surface === 'asphalt') {
    speckle(g, W, H, s.color, 26, 9000, 1.5);
    g.fillStyle = '#e8e8e0';
    g.fillRect(6, 0, 5, H);
    g.fillRect(W - 11, 0, 5, H);
    g.fillRect(W / 2 - 2, 0, 4, H * 0.45);
  } else {
    speckle(g, W, H, s.color, 50, 12000, surface === 'gravel' ? 2.5 : 1.2);
    // わだち
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(W * 0.28, 0, W * 0.08, H);
    g.fillRect(W * 0.64, 0, W * 0.08, H);
  }
  return finish(c);
}

export function groundDetailTexture(): THREE.Texture {
  const W = 256;
  const { c, g } = canvas(W, W);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, W, W);
  for (let i = 0; i < 6000; i++) {
    const k = 110 + Math.random() * 40;
    g.fillStyle = `rgb(${k},${k},${k})`;
    g.fillRect(Math.random() * W, Math.random() * W, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function checkerTexture(): THREE.Texture {
  const { c, g } = canvas(64, 16);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
    g.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#111111';
    g.fillRect(i * 4, j * 4, 4, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function stripeTexture(a: string, b: string): THREE.Texture {
  const { c, g } = canvas(64, 8);
  g.fillStyle = a; g.fillRect(0, 0, 64, 8);
  g.fillStyle = b;
  for (let i = 0; i < 4; i++) g.fillRect(i * 16, 0, 8, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
