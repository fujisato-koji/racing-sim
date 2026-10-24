// スマホの操作。スマホをハンドルのように回して切り、画面のペダルでアクセルとブレーキ。
// 傾きは、重力の向きを画面の面に写した角度で測る（画面を手前に倒して持っても効く）。
import type { Controls } from '../sim/vehicle';
import { TiltSteering } from './tilt';

const DEG = Math.PI / 180;

export type TouchAction = 'camera' | 'reset' | 'pause' | 'center' | 'sound' | 'shiftUp' | 'shiftDown';

function wrap(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  readonly tiltSteer = new TiltSteering();
  onAction: (a: TouchAction) => void = () => {};
  private raw: number | null = null;
  private center: number | null = null;
  private wantCenter = true;
  private tiltSeen = false;
  private throttleOn = false;
  private brakeOn = false;
  private leftOn = false;
  private rightOn = false;
  private readonly c: Controls = { steer: 0, throttle: 0, brake: 0 };
  private listening = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <div class="touch-buttons">
        <button data-a="pause" aria-label="一時停止">Ⅱ</button>
        <button data-a="camera">視点</button>
        <button data-a="reset">戻す</button>
        <button data-a="center">中央</button>
        <button data-a="sound" class="sound">音</button>
      </div>
      <div class="shift-buttons">
        <button data-a="shiftUp" aria-label="シフトアップ">▲</button>
        <button data-a="shiftDown" aria-label="シフトダウン">▼</button>
      </div>
      <div class="pedal brake" data-p="brake"><span>ブレーキ</span></div>
      <div class="pedal throttle" data-p="throttle"><span>アクセル</span></div>
      <div class="steer-buttons">
        <div class="pedal small" data-p="left"><span>◀</span></div>
        <div class="pedal small" data-p="right"><span>▶</span></div>
      </div>
`;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onAction(b.dataset.a as TouchAction); });
    });
    this.root.querySelectorAll<HTMLElement>('[data-p]').forEach((el) => {
      const set = (on: boolean) => {
        el.classList.toggle('on', on);
        const k = el.dataset.p;
        if (k === 'throttle') this.throttleOn = on;
        if (k === 'brake') this.brakeOn = on;
        if (k === 'left') this.leftOn = on;
        if (k === 'right') this.rightOn = on;
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        set(true);
        // 指がペダルの外へずれても離すまでは押したままにする
        try { el.setPointerCapture(e.pointerId); } catch { /* 捕まえられなくても押したことにはする */ }
      });
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, () => set(false));
    });
    this.visible = false;
  }

  set visible(v: boolean) { this.root.style.display = v ? '' : 'none'; }

  setMuted(m: boolean) { this.root.querySelector('.sound')!.classList.toggle('off', m); }

  /** タップの処理の中で呼ぶ。iPhone では傾きセンサーの許可を求める */
  async enable() {
    const DO = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    try {
      if (DO?.requestPermission) {
        const r = await DO.requestPermission();
        if (r !== 'granted') return;
      }
    } catch {
      return;
    }
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('deviceorientation', (e) => this.onOrientation(e));
  }

  /** 傾きが届いているか（届かない端末では ◀ ▶ のボタンで切る） */
  get tilt() { return this.tiltSeen; }

  private onOrientation(e: DeviceOrientationEvent) {
    if (e.beta === null || e.gamma === null) return;
    const b = e.beta * DEG, g = e.gamma * DEG;
    // 端末の座標で見た「上」の向き（x 右、y 上、z 画面の外）
    const ux = -Math.sin(g) * Math.cos(b), uy = Math.sin(b);
    // 画面の向きに合わせて回す
    const so = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) * DEG;
    const sx = ux * Math.cos(so) - uy * Math.sin(so), sy = ux * Math.sin(so) + uy * Math.cos(so);
    // ほぼ水平に置いたときは向きが定まらないので前の値を使う
    if (Math.hypot(sx, sy) < 0.25) return;
    // 時計回り（右に切る）を正。中央は合わせた位置からの差で見るので、画面を回していても向きは崩れない
    this.raw = Math.atan2(-sx, sy);
    if (!this.tiltSeen) {
      this.tiltSeen = true;
      this.root.classList.add('has-tilt');
    }
    if (this.wantCenter) { this.center = this.raw; this.wantCenter = false; }
    this.tiltSteer.push(wrap(this.raw - (this.center ?? this.raw)) / DEG, e.timeStamp / 1000);
  }

  /** 今の持ち方を中央にする */
  calibrate() {
    if (this.raw !== null) { this.center = this.raw; this.wantCenter = false; }
    else this.wantCenter = true;
    this.tiltSteer.reset();
  }

  /** 物理の 1 ステップごとに呼ぶ */
  update(dt: number, speed = 0): Controls {
    const c = this.c;
    if (this.tiltSeen && this.raw !== null && this.center !== null) {
      c.steer = this.tiltSteer.steer(speed * 3.6);
    } else {
      const target = this.leftOn === this.rightOn ? 0 : this.rightOn ? 1 : -1;
      const rate = target === 0 ? 6 : 2.5;
      const d = target - c.steer;
      c.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    }
    const toward = (cur: number, on: boolean, up: number, down: number) => {
      const t = on ? 1 : 0, r = on ? up : down;
      return Math.abs(t - cur) <= r * dt ? t : cur + Math.sign(t - cur) * r * dt;
    };
    c.throttle = toward(c.throttle, this.throttleOn, 4, 8);
    c.brake = toward(c.brake, this.brakeOn, 5, 9);
    return { steer: c.steer, throttle: c.throttle, brake: c.brake };
  }

  reset() {
    this.c.steer = 0; this.c.throttle = 0; this.c.brake = 0;
    this.tiltSteer.reset();
    this.wantCenter = true;
    if (this.raw !== null) this.calibrate();
  }
}
