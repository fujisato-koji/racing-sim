// 実車のようなメーター：回転計（左）と速度計（右）、ギア、変速の合図のランプ、補助の警告灯。
// canvas に描くので、画面の計器と運転席のダッシュボード（テクスチャ）の両方に使える。
import { estimateTopSpeed } from '../sim/params';
import type { Vehicle } from '../sim/vehicle';

const START = (-225 * Math.PI) / 180; // 左下から
const SWEEP = (270 * Math.PI) / 180; // 右下まで

export class Gauges {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private face: HTMLCanvasElement | null = null;
  private faceKey = '';
  private flash = 0;

  constructor(width = 640, height = 300) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d')!;
  }

  private scales(v: Vehicle) {
    const red = v.p.engine.redlineRpm;
    const rpmMax = Math.ceil((red + 900) / 1000) * 1000;
    const top = estimateTopSpeed(v.p) * 3.6;
    const kmhMax = Math.max(180, Math.ceil((top * 1.12) / 20) * 20);
    return { red, rpmMax, kmhMax };
  }

  /** 目盛りなど動かない部分は、車が変わったときだけ描く */
  private drawFace(v: Vehicle) {
    const { red, rpmMax, kmhMax } = this.scales(v);
    const key = `${red}/${rpmMax}/${kmhMax}`;
    if (this.face && key === this.faceKey) return;
    this.faceKey = key;
    const W = this.canvas.width, H = this.canvas.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const R = H * 0.44;
    // 数字が詰まらないよう、270° の中に 8〜11 個ほど並べる
    const major = kmhMax > 220 ? 40 : 20;
    const dials = [
      { cx: W * 0.24, cy: H * 0.52, max: rpmMax / 1000, major: 1, minor: 0.5, red: red / 1000, label: '×1000 rpm' },
      { cx: W * 0.76, cy: H * 0.52, max: kmhMax, major, minor: major / 2, red: Infinity, label: 'km/h' },
    ];
    for (const d of dials) {
      const grd = g.createRadialGradient(d.cx, d.cy - R * 0.3, R * 0.1, d.cx, d.cy, R);
      grd.addColorStop(0, '#2a2f38'); grd.addColorStop(1, '#0d0f13');
      g.fillStyle = grd;
      g.beginPath(); g.arc(d.cx, d.cy, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#59606b'; g.lineWidth = R * 0.03;
      g.beginPath(); g.arc(d.cx, d.cy, R * 0.985, 0, Math.PI * 2); g.stroke();
      // 赤い区域
      if (isFinite(d.red)) {
        g.strokeStyle = '#d62b2b'; g.lineWidth = R * 0.07;
        g.beginPath(); g.arc(d.cx, d.cy, R * 0.86, START + (SWEEP * d.red) / d.max, START + SWEEP); g.stroke();
      }
      // 目盛り
      g.fillStyle = '#e9edf2';
      g.font = `${Math.round(R * 0.15)}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let x = 0; x <= d.max + 1e-6; x += d.minor) {
        const a = START + (SWEEP * x) / d.max;
        const major = Math.abs(x / d.major - Math.round(x / d.major)) < 1e-6;
        const r0 = R * (major ? 0.74 : 0.8), r1 = R * 0.9;
        g.strokeStyle = x >= d.red ? '#ff6a6a' : '#e9edf2';
        g.lineWidth = major ? R * 0.028 : R * 0.014;
        g.beginPath(); g.moveTo(d.cx + Math.cos(a) * r0, d.cy + Math.sin(a) * r0); g.lineTo(d.cx + Math.cos(a) * r1, d.cy + Math.sin(a) * r1); g.stroke();
        if (major) g.fillText(String(Math.round(x)), d.cx + Math.cos(a) * R * 0.6, d.cy + Math.sin(a) * R * 0.6);
      }
      g.fillStyle = '#9aa4b2';
      g.font = `${Math.round(R * 0.1)}px sans-serif`;
      g.fillText(d.label, d.cx, d.cy + R * 0.32);
    }
    this.face = c;
  }

  draw(v: Vehicle) {
    this.drawFace(v);
    const { red, rpmMax, kmhMax } = this.scales(v);
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.face!, 0, 0);
    const R = H * 0.44;
    const needle = (cx: number, cy: number, frac: number) => {
      const a = START + SWEEP * Math.max(0, Math.min(1.02, frac));
      g.save();
      g.translate(cx, cy); g.rotate(a);
      g.fillStyle = '#ff8a1a';
      g.shadowColor = 'rgba(255,120,0,0.6)'; g.shadowBlur = R * 0.06;
      g.beginPath(); g.moveTo(-R * 0.12, -R * 0.022); g.lineTo(R * 0.86, -R * 0.008); g.lineTo(R * 0.86, R * 0.008); g.lineTo(-R * 0.12, R * 0.022); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = '#20242b';
      g.beginPath(); g.arc(cx, cy, R * 0.09, 0, Math.PI * 2); g.fill();
    };
    const tx = W * 0.24, sx = W * 0.76, cy = H * 0.52;
    needle(tx, cy, v.rpm / rpmMax);
    const kmh = Math.abs(v.speed * 3.6);
    needle(sx, cy, kmh / kmhMax);
    // ギア（回転計の中）と速さ（速度計の中）
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = v.shifting > 0 ? '#9aa4b2' : '#ffb000';
    g.font = `bold ${Math.round(R * 0.34)}px sans-serif`;
    const gear = v.targetGear;
    g.fillText(gear < 0 ? 'R' : String(gear), tx, cy + R * 0.58);
    g.fillStyle = '#ffffff';
    g.font = `bold ${Math.round(R * 0.3)}px sans-serif`;
    g.fillText(String(Math.round(kmh)), sx, cy + R * 0.58);
    if (v.manual) {
      g.fillStyle = '#9aa4b2'; g.font = `${Math.round(R * 0.1)}px sans-serif`;
      g.fillText('Manual', tx, cy - R * 0.32);
    }
    // 変速の合図（5 つのランプが順に灯り、レブリミットで点滅）
    const shiftAt = red * 0.97;
    const lit = Math.max(0, Math.min(5, Math.floor(((v.rpm - shiftAt * 0.75) / (shiftAt * 0.25)) * 5)));
    this.flash = (this.flash + 1) % 8;
    const blink = v.rpm > shiftAt && this.flash < 4;
    for (let i = 0; i < 5; i++) {
      const on = v.rpm > shiftAt ? blink : i < lit;
      const col = i < 2 ? '#3fd06a' : i < 4 ? '#ffc21a' : '#ff3b3b';
      g.fillStyle = on ? col : 'rgba(255,255,255,0.08)';
      g.beginPath(); g.arc(W / 2 + (i - 2) * H * 0.07, H * 0.12, H * 0.025, 0, Math.PI * 2); g.fill();
    }
    // 警告灯
    const lamps: [string, boolean][] = [
      ['TCS', v.p.assists.tcs && v.throttleOut < v.controls.throttle - 0.1 && !v.airborne && v.gear > 0],
      ['ABS', v.wheels.some((w) => w.absFactor < 0.95)],
      ['ESC', v.escActive],
    ];
    g.font = `bold ${Math.round(H * 0.05)}px sans-serif`;
    lamps.forEach(([t, on], i) => {
      g.fillStyle = on ? '#ffb000' : 'rgba(255,255,255,0.12)';
      g.fillText(t, W / 2, H * (0.42 + i * 0.12));
    });
  }
}
