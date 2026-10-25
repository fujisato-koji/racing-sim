// キーボードの入力。押すか離すかの 0/1 を、操作量の立ち上がりと戻りの速さで滑らかにする。
// ハンドルは、押している時間で少しずつ切れ（速いほどゆっくり）、短く押したときは小さく切れるように曲線をかける。
import type { Controls } from '../sim/vehicle';

const STEER_LEFT = ['ArrowLeft', 'KeyA'];
const STEER_RIGHT = ['ArrowRight', 'KeyD'];
const THROTTLE = ['ArrowUp', 'KeyW'];
const BRAKE = ['ArrowDown', 'KeyS', 'Space'];

export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly c: Controls = { steer: 0, throttle: 0, brake: 0 };
  /** 押した時間で決まるハンドルの量（曲線をかける前） */
  private s = 0;
  /** 切れる速さの倍率（設定の Keyboard steering speed） */
  sensitivity = 1;
  /** 補助あり：出すのは「曲がり具合の求め」（steer-assist.ts が切れ角にする）。速めに立ち上げ、曲線は弱く */
  assisted = true;
  /** 補助ありで、いっぱいの求めまで押し続ける時間 [s]（止まっているとき、速いとき）と曲線の強さ */
  assistRamp: [number, number] = [0.25, 0.7];
  assistCurve = 1.5;
  onAction: (action: 'camera' | 'reset' | 'pause' | 'mirror' | 'map' | 'sound' | 'shiftUp' | 'shiftDown') => void = () => {};

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
      if (e.code === 'KeyE') this.onAction('shiftUp');
      if (e.code === 'KeyQ') this.onAction('shiftDown');
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
    // 押している間に少しずつ切れる。いっぱいまでの時間は、止まっているとき 0.3 秒、150 km/h で約 1 秒
    const v = Math.min(1, Math.abs(speed) / 42);
    const turnRate = this.assisted ? this.sensitivity / (this.assistRamp[0] + (this.assistRamp[1] - this.assistRamp[0]) * v) : this.sensitivity / (0.3 + 0.75 * v);
    // 中央へ戻すとき、反対へ切り返すときは速い（速いほど少しゆっくり戻して、車の揺れを抑える）
    const backRate = this.assisted ? 7 : 6 - 2.5 * v;
    const returning = target === 0 || (c.steer !== 0 && Math.sign(target) !== Math.sign(c.steer));
    this.s = toward(this.s, target, returning ? backRate : turnRate, returning ? backRate : turnRate);
    // 押し始めは小さく、押し続けるといっぱいまで（短く押せば小さく直せる）
    c.steer = Math.sign(this.s) * Math.abs(this.s) ** (this.assisted ? this.assistCurve : 1.7);
    return { steer: c.steer, throttle: c.throttle, brake: c.brake };
  }

  reset() {
    this.c.steer = 0; this.c.throttle = 0; this.c.brake = 0; this.s = 0;
  }
}
