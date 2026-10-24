// 走行中の表示：速さ、ギア、回転数、周回と順位、全体の地図（右上、半透明）、案内
import type { Session } from '../game/session';
import type { CourseData } from '../sim/course';
import { SURFACES } from '../sim/surfaces';
import { steeringWheelAngle } from '../render/car-mesh';
import { Gauges } from './gauges';
import { isTouch } from './layout';

export function formatTime(t: number) {
  if (!isFinite(t) || t < 0) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export class Hud {
  readonly root: HTMLDivElement;
  private readonly gauges = new Gauges(640, 300);
  private readonly meter: HTMLElement;
  private readonly info: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly message: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly help: HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly wheel: HTMLElement;
  private readonly wheelSvg: SVGElement;
  private readonly wheelDeg: HTMLElement;
  private mapBase: HTMLCanvasElement | null = null;
  private mapScale = 1;
  private mapX0 = 0;
  private mapZ0 = 0;
  showMap = true;
  private helpTime = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-info"></div>
      <canvas class="hud-map" width="440" height="440"></canvas>
      <div class="hud-message"></div>
      <div class="hud-notice" style="display:none"></div>
      <div class="hud-help">${isTouch
        ? 'スマホを左右に回してハンドル　右下アクセル　左下ブレーキ（止まって押し続けると後退）'
        : '← → ハンドル　↑ アクセル　↓ ブレーキ（止まって押し続けると後退）　E/Q 手動変速<br>C 視点　M ミラー　N 地図　R 戻す　V 音　Esc 一時停止'}</div>
      <div class="hud-wheel"><svg viewBox="-50 -50 100 100">
        <circle r="44" fill="none" stroke="#e8ecf2" stroke-width="7"/>
        <circle r="10" fill="#e8ecf2"/>
        <path d="M -42 4 L -10 2 M 42 4 L 10 2 M 0 10 L 0 42" stroke="#e8ecf2" stroke-width="7" stroke-linecap="round"/>
        <path d="M -6 -44 L 6 -44" stroke="#ffb000" stroke-width="7" stroke-linecap="round"/>
      </svg><div class="hud-wheel-deg"></div></div>
      <div class="hud-meter"><div class="hud-surface"></div></div>`;
    parent.appendChild(this.root);
    const q = (c: string) => this.root.querySelector(c) as HTMLElement;
    this.meter = q('.hud-meter');
    this.gauges.canvas.className = 'hud-gauges';
    this.meter.appendChild(this.gauges.canvas);
    this.info = q('.hud-info');
    this.surface = q('.hud-surface');
    this.message = q('.hud-message');
    this.notice = q('.hud-notice');
    this.help = q('.hud-help');
    this.map = q('.hud-map') as HTMLCanvasElement;
    this.wheel = q('.hud-wheel');
    this.wheelSvg = this.root.querySelector('.hud-wheel svg') as SVGElement;
    this.wheelDeg = q('.hud-wheel-deg');
  }

  set visible(v: boolean) { this.root.style.display = v ? '' : 'none'; }

  /** 地図の下絵（コースの形）を一度だけ描く */
  setCourse(c: CourseData) {
    const W = this.map.width;
    const { x0, z0, x1, z1 } = c.bounds;
    const pad = c.path.length > 0 ? 140 : 0;
    const bx0 = x0 + pad, bz0 = z0 + pad, bx1 = x1 - pad, bz1 = z1 - pad;
    const scale = (W - 24) / Math.max(bx1 - bx0, bz1 - bz0);
    this.mapScale = scale;
    this.mapX0 = (bx0 + bx1) / 2;
    this.mapZ0 = (bz0 + bz1) / 2;
    const base = document.createElement('canvas');
    base.width = base.height = W;
    const g = base.getContext('2d')!;
    const to = (x: number, z: number): [number, number] => [W / 2 + (x - this.mapX0) * scale, W / 2 + (z - this.mapZ0) * scale];
    if (c.path.length > 0) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = Math.max(6, c.width * scale + 4);
      g.beginPath();
      c.path.forEach((p, i) => { const [x, y] = to(p.x, p.z); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.closePath(); g.stroke();
      for (let i = 0; i < c.path.length; i++) {
        const p = c.path[i], q = c.path[(i + 1) % c.path.length];
        g.strokeStyle = p.surface === 'asphalt' ? '#e8e8e8' : p.surface === 'sand' ? '#f0d58a' : '#cdb48e';
        g.lineWidth = Math.max(3, c.width * scale);
        g.beginPath(); g.moveTo(...to(p.x, p.z)); g.lineTo(...to(q.x, q.z)); g.stroke();
      }
      const s = c.path[0];
      const [sx, sy] = to(s.x, s.z);
      g.strokeStyle = '#d22'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(sx - s.lx * 10, sy - s.lz * 10); g.lineTo(sx + s.lx * 10, sy + s.lz * 10); g.stroke();
    } else {
      for (const p of c.def.patches ?? []) {
        const [ax, ay] = to(p.x - p.w / 2, p.z - p.d / 2);
        g.fillStyle = p.surface === 'asphalt' ? 'rgba(70,72,78,0.85)' : `#${SURFACES[p.surface].color.toString(16).padStart(6, '0')}`;
        g.fillRect(ax, ay, p.w * scale, p.d * scale);
      }
      for (const f of c.def.rockFields ?? []) {
        const [x, y] = to(f.x, f.z);
        g.fillStyle = '#8a837b'; g.beginPath(); g.arc(x, y, f.radius * scale, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#e0b020';
      for (const r of c.def.ramps ?? []) { const [x, y] = to(r.x, r.z); g.fillRect(x - 4, y - 4, 8, 8); }
    }
    this.mapBase = base;
    this.help.style.opacity = '1';
    this.helpTime = 0;
  }

  update(s: Session, dt: number, cockpit: boolean) {
    const pr = s.player;
    if (!pr) return;
    const v = pr.vehicle;
    // ハンドル：実際のタイヤの切れ角 × ステアリングギア比（運転席視点では車の中のハンドルが見えるので出さない）
    this.wheel.style.display = cockpit ? 'none' : '';
    const deg = (steeringWheelAngle(v) * 180) / Math.PI;
    this.wheelSvg.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    this.wheelDeg.textContent = `${Math.abs(deg) < 0.5 ? 0 : Math.round(deg)}°`;
    // 運転席視点ではダッシュボードのメーターが見えるので、画面の計器は出さない
    this.meter.style.display = cockpit ? 'none' : '';
    if (!cockpit) this.gauges.draw(v);
    const w = v.wheels.find((x) => x.contact);
    this.surface.textContent = v.airborne ? '空中' : (w ? SURFACES[w.surface.id].name : '');

    const race = s.race;
    if (race.free) {
      this.info.innerHTML = `<div class="hud-title">${s.course.def.name}</div><div>自由走行</div>`;
    } else {
      const st = race.standings();
      const pos = st.indexOf(pr) + 1;
      const lapNow = Math.min(race.laps, pr.laps + 1);
      const cur = race.state === 'countdown' ? 0 : race.time - pr.lapStart;
      this.info.innerHTML = `
        <div class="hud-big">${pos}<span>/${st.length} 位</span></div>
        <div>周回 ${lapNow}/${race.laps}</div>
        <div>今の周 ${formatTime(pr.finished ? pr.lastLap : cur)}</div>
        <div>前の周 ${formatTime(pr.lastLap)}</div>
        <div>最速 ${formatTime(pr.bestLap)}</div>`;
    }
    let msg = '';
    if (race.state === 'countdown') msg = race.time < -0.5 ? String(Math.ceil(-race.time - 0.5)) : '';
    else if (race.time < 1.2 && !race.free) msg = 'GO!';
    if (race.state === 'finished') msg = 'ゴール！';
    if (s.paused) msg = '一時停止';
    this.message.textContent = msg;
    const n = s.notice && s.notice.until > s.pw.time ? s.notice.text : '';
    this.notice.textContent = n;
    this.notice.style.display = n ? '' : 'none';

    this.helpTime += dt;
    if (this.helpTime > 10) this.help.style.opacity = '0';
    this.drawMap(s);
  }

  private drawMap(s: Session) {
    this.map.style.display = this.showMap ? '' : 'none';
    if (!this.showMap || !this.mapBase) return;
    const g = this.map.getContext('2d')!;
    const W = this.map.width;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.mapBase, 0, 0);
    const to = (x: number, z: number): [number, number] => [W / 2 + (x - this.mapX0) * this.mapScale, W / 2 + (z - this.mapZ0) * this.mapScale];
    for (const r of s.racers) {
      if (r.isPlayer) continue;
      const [x, y] = to(r.vehicle.pos.x, r.vehicle.pos.z);
      g.fillStyle = r.color; g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (s.player) {
      const v = s.player.vehicle;
      const [x, y] = to(v.pos.x, v.pos.z);
      const a = Math.atan2(v.fwd.x, -v.fwd.z);
      g.save();
      g.translate(x, y); g.rotate(a);
      g.fillStyle = '#ffeb3b'; g.strokeStyle = '#000'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath();
      g.fill(); g.stroke();
      g.restore();
    }
  }
}
