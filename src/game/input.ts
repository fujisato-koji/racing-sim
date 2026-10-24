// キーボードの入力。押すか離すかの 0/1 を、操作量の立ち上がりと戻りの速さで滑らかにする。
import type { Controls } from '../sim/vehicle';

const STEER_LEFT = ['ArrowLeft', 'KeyA'];
const STEER_RIGHT = ['ArrowRight', 'KeyD'];
const THROTTLE = ['ArrowUp', 'KeyW'];
const BRAKE = ['ArrowDown', 'KeyS', 'Space'];

export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly c: Controls = { steer: 0, throttle: 0, brake: 0 };
  onAction: (action: 'camera' | 'reset' | 'pause' | 'mirror' | 'map' | 'sound') => void = () => {};

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this.isDriving(e.code)) e.preventDefault(); return; }
      this.down.add(e.code);
      if (this.isDriving(e.code)) e.preventDefault();
      if (e.code === 'KeyC') this.onAction('camera');
      if (e.code === 'KeyR') this.onAction('reset');
      if (e.code === 'Escape' || e.code === 'KeyP') this.onAction('pause');
      if (e.code === 'KeyM') this.onAction('mirror');
      if (e.code === 'KeyN') this.onAction('map');
      if (e.code === 'KeyV') this.onAction('sound');
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  private isDriving(code: string) {
    return [...STEER_LEFT, ...STEER_RIGHT, ...THROTTLE, ...BRAKE].includes(code);
  }

  private any(keys: string[]) {
    return keys.some((k) => this.down.has(k));
  }

  /** 物理の 1 ステップごとに呼ぶ */
  update(dt: number, speed: number): Controls {
    const c = this.c;
    const toward = (cur: number, target: number, up: number, down: number) => {
      const rate = target > cur ? up : down;
      const d = target - cur;
      return Math.abs(d) <= rate * dt ? target : cur + Math.sign(d) * rate * dt;
    };
    c.throttle = toward(c.throttle, this.any(THROTTLE) ? 1 : 0, 3.5, 7);
    c.brake = toward(c.brake, this.any(BRAKE) ? 1 : 0, 4.5, 8);
    const left = this.any(STEER_LEFT), right = this.any(STEER_RIGHT);
    const target = left === right ? 0 : right ? 1 : -1;
    // 速いほどゆっくり切れる。中央へ戻すとき、反対へ切り返すときは速い
    const v = Math.min(1, Math.abs(speed) / 40);
    const turnRate = 3.2 - 1.9 * v;
    const returning = target === 0 || Math.sign(target) !== Math.sign(c.steer);
    c.steer = toward(c.steer, target, returning ? 6 : turnRate, returning ? 6 : turnRate);
    if (returning && target !== 0 && Math.abs(c.steer) < 0.05) c.steer = toward(c.steer, target, turnRate, turnRate);
    return { steer: c.steer, throttle: c.throttle, brake: c.brake };
  }

  reset() {
    this.c.steer = 0; this.c.throttle = 0; this.c.brake = 0;
  }
}
