// ゴースト：1 周の車の位置と向きを 20 回／秒で記録し、あとで同じ時刻の姿勢を取り出す。
import { Quaternion, Vector3 } from 'three';
import type { Vehicle } from '../sim/vehicle';

export const GHOST_RATE = 20;

export interface GhostLap {
  course: string;
  /** 車の識別（代表車種は id、自作は custom:名前） */
  car: string;
  carName: string;
  color: string;
  /** 1 周のタイム [s] */
  time: number;
  /** 記録した人の名前（世界の記録のとき） */
  name?: string;
  /** 1 コマ 7 つ（x, y, z, qx, qy, qz, qw） */
  frames: Float32Array;
}

export class GhostRecorder {
  private buf: number[] = [];
  private next = 0;

  start() {
    this.buf = [];
    this.next = 0;
  }

  /** 周の始まりからの時刻 t で呼ぶ（物理の 1 ステップごとでよい。20 回／秒に間引く） */
  push(t: number, v: Vehicle) {
    if (t < this.next) return;
    this.next += 1 / GHOST_RATE;
    this.buf.push(v.pos.x, v.pos.y, v.pos.z, v.quat.x, v.quat.y, v.quat.z, v.quat.w);
  }

  finish(meta: Omit<GhostLap, 'frames'>): GhostLap {
    return { ...meta, frames: new Float32Array(this.buf) };
  }
}

const _qa = new Quaternion(), _qb = new Quaternion();

/** 時刻 t [s] の姿勢。範囲の外は端の姿勢 */
export function sampleGhost(g: GhostLap, t: number, pos: Vector3, quat: Quaternion) {
  const n = g.frames.length / 7;
  if (n === 0) return false;
  const f = Math.max(0, Math.min(n - 1, t * GHOST_RATE));
  const i = Math.min(n - 2, Math.floor(f)), u = n === 1 ? 0 : f - i;
  const a = i * 7, b = Math.min(n - 1, i + 1) * 7, d = g.frames;
  pos.set(d[a] + (d[b] - d[a]) * u, d[a + 1] + (d[b + 1] - d[a + 1]) * u, d[a + 2] + (d[b + 2] - d[a + 2]) * u);
  _qa.set(d[a + 3], d[a + 4], d[a + 5], d[a + 6]);
  _qb.set(d[b + 3], d[b + 4], d[b + 5], d[b + 6]);
  quat.slerpQuaternions(_qa, _qb, u);
  return true;
}

// ---------------------------------------------------------------- 保存（ブラウザ内。使えなければ保存しないだけ）
function toBase64(a: Float32Array) {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function encodeGhost(g: GhostLap) {
  return JSON.stringify({ ...g, frames: toBase64(g.frames) });
}

export function decodeGhost(s: string): GhostLap | null {
  try {
    const o = JSON.parse(s) as Omit<GhostLap, 'frames'> & { frames: string };
    return { ...o, frames: fromBase64(o.frames) };
  } catch {
    return null;
  }
}

const key = (course: string, car: string) => `racing-sim.ghost.v1.${course}.${car}`;

export function loadBestGhost(course: string, car: string): GhostLap | null {
  try {
    const s = localStorage.getItem(key(course, car));
    return s ? decodeGhost(s) : null;
  } catch {
    return null;
  }
}

export function saveBestGhost(g: GhostLap) {
  try { localStorage.setItem(key(g.course, g.car), encodeGhost(g)); return true; } catch { return false; }
}
