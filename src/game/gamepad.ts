// ゲームパッド（ブラウザの Gamepad API、標準の配置）。左スティックでハンドル、右トリガーでアクセル、左トリガーでブレーキ。
// RB で上げる、LB で下げる、Y で視点、START で一時停止、BACK で車を戻す。

export type PadAction = 'shiftUp' | 'shiftDown' | 'camera' | 'pause' | 'reset';

const BUTTONS: [number, PadAction][] = [[5, 'shiftUp'], [4, 'shiftDown'], [3, 'camera'], [9, 'pause'], [8, 'reset']];

export class GamepadInput {
  steer = 0;
  throttle = 0;
  brake = 0;
  /** 最近ゲームパッドが触られた */
  active = false;
  name = '';
  onAction: (a: PadAction) => void = () => {};
  private readonly prev = new Map<number, boolean>();

  /** 毎フレーム呼ぶ */
  poll() {
    let pads: (Gamepad | null)[] = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch { pads = []; }
    const gp = pads.find((p): p is Gamepad => !!p && p.connected);
    if (!gp) { this.active = false; this.steer = 0; this.throttle = 0; this.brake = 0; return; }
    this.name = gp.id;
    const ax = gp.axes[0] ?? 0;
    const dz = 0.08;
    const x = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
    // スティックは中央付近を少し鈍く
    this.steer = Math.sign(x) * (0.55 * Math.abs(x) + 0.45 * x * x);
    const trig = (i: number) => {
      const b = gp.buttons[i];
      return b ? Math.max(b.value, b.pressed ? 1 : 0) : 0;
    };
    this.throttle = trig(7);
    this.brake = trig(6);
    let any = Math.abs(x) > 0 || this.throttle > 0.02 || this.brake > 0.02;
    for (const [i, a] of BUTTONS) {
      const down = !!gp.buttons[i]?.pressed;
      if (down) any = true;
      if (down && !this.prev.get(i)) this.onAction(a);
      this.prev.set(i, down);
    }
    if (any) this.active = true;
  }
}
