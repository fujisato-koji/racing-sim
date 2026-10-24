// 画面の流れ：タイトル → コース → 車 → 詳細設定（飛ばせる） → レース → 結果
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { Sound } from './audio/sound';
import { GamepadInput } from './game/gamepad';
import { KeyboardInput } from './game/input';
import { TouchControls } from './game/touch';
import { Session } from './game/session';
import { GameView } from './render/view';
import type { CourseDef } from './sim/course';
import { COURSES } from './sim/courses';
import type { CarParams } from './sim/params';
import { cloneParams, computeDerived } from './sim/params';
import { CAR_PRESETS } from './sim/presets';
import { Hud, formatTime } from './ui/hud';
import { initLayout, isTouch, requestLandscape } from './ui/layout';
import { buildSettingsForm, renderDerived } from './ui/settings';
import { exportCar, importCar, loadCustomCars, saveCustomCars } from './ui/storage';

const PREFS = 'racing-sim.prefs.v1';
interface Prefs { volume: number; muted: boolean; tiltRange: number; centerSoft: number; manual: boolean }
function loadPrefs(): Prefs {
  const d: Prefs = { volume: 0.7, muted: false, tiltRange: 40, centerSoft: 1, manual: false };
  try { return { ...d, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>) }; } catch { return d; }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* 保存できなくても動く */ }
}

const COLORS = ['#c8312b', '#3d6fb6', '#2f7d4a', '#f0b400', '#7b4fb0', '#e07020', '#20a0a0', '#d0d0d0'];

class App {
  private readonly view: GameView;
  private readonly hud: Hud;
  private readonly overlay: HTMLDivElement;
  private readonly input = new KeyboardInput();
  private readonly touch: TouchControls;
  private readonly pad = new GamepadInput();
  private readonly sound = new Sound();
  private readonly prefs = loadPrefs();
  private session: Session | null = null;
  private course: CourseDef = COURSES[1];
  private laps = COURSES[1].laps;
  private opponents = 5;
  private sameCar = false;
  private car: CarParams = cloneParams(CAR_PRESETS[2]);
  private custom: CarParams[] = loadCustomCars();
  private finishedAt = -1;
  private resultsShown = false;
  private last = performance.now();

  constructor(stage: HTMLElement, overlay: HTMLDivElement) {
    this.view = new GameView(stage);
    this.hud = new Hud(stage);
    this.hud.visible = false;
    this.touch = new TouchControls(stage);
    this.touch.tiltSteer.opt.range = this.prefs.tiltRange;
    this.touch.tiltSteer.opt.centerSoft = this.prefs.centerSoft;
    this.sound.volume = this.prefs.volume;
    this.sound.muted = this.prefs.muted;
    this.touch.setMuted(this.prefs.muted);
    this.overlay = overlay;
    const act = (a: string) => {
      if (a === 'sound') { this.setMuted(!this.sound.muted); return; }
      if (!this.session) return;
      if (a === 'camera') this.view.toggleCamera();
      if (a === 'mirror') this.view.showMirror = !this.view.showMirror;
      if (a === 'map') this.hud.showMap = !this.hud.showMap;
      if (a === 'reset' && this.session.player && !this.session.paused) this.session.respawn(this.session.player);
      if (a === 'pause') this.togglePause();
      if (a === 'center') this.touch.calibrate();
      if (a === 'shiftUp' && !this.session.paused) this.session.player?.vehicle.requestShift(1);
      if (a === 'shiftDown' && !this.session.paused) this.session.player?.vehicle.requestShift(-1);
    };
    this.input.onAction = act;
    this.touch.onAction = act;
    this.pad.onAction = act;
    document.body.classList.toggle('manual', this.prefs.manual);
    // 最初のタップやクリックで音を出せるようにする
    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.view.showCar(this.car);
    // 確認用（?debug を付けたときだけ）
    if (location.search.includes('debug')) (window as unknown as { __app: App }).__app = this;
    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const s = this.session;
    this.pad.poll();
    if (s) {
      s.update(dt);
      this.view.render(dt);
      this.hud.update(s, dt, this.view.mode === 'cockpit');
      if (s.race.state === 'finished' && !this.resultsShown) {
        if (this.finishedAt < 0) this.finishedAt = now;
        if (now - this.finishedAt > 2500) this.showResults();
      }
    } else {
      this.view.renderGarage(dt);
    }
    this.sound.update(s, this.view.mode === 'cockpit');
    requestAnimationFrame((t) => this.frame(t));
  }

  private screen(html: string, cls = 'panel') {
    this.overlay.innerHTML = `<div class="${cls}">${html}</div>`;
    this.overlay.style.display = '';
    return this.overlay.firstElementChild as HTMLElement;
  }

  private on(root: HTMLElement, sel: string, fn: (el: HTMLElement) => void) {
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
  }

  // ------------------------------------------------------------ タイトル
  private showTitle() {
    const el = this.screen(`
      <h1>racing-sim</h1>
      <p class="lead">タイヤの摩擦、サスペンション、エンジンから車輪までの駆動系、空気抵抗を計算して走る車のレース。</p>
      ${this.prefsHtml()}
      <div class="buttons"><button class="primary" data-go>はじめる</button></div>
      <p class="note">${isTouch
        ? 'スマホは横向きに持ち、ハンドルのように左右へ回して切る。右下がアクセル、左下がブレーキ。変速は自動。'
        : '操作はキーボードかゲームパッド。← → ハンドル、↑ アクセル、↓ ブレーキ。手動変速は E で上げ Q で下げる。'}</p>`);
    this.bindPrefs(el);
    this.on(el, '[data-go]', () => {
      // 音、傾きセンサー、全画面と横向きの固定は、利用者のタップの中でしか始められない
      this.sound.unlock();
      void this.touch.enable();
      requestLandscape();
      this.showCourse();
    });
  }

  // ------------------------------------------------------------ コース
  private showCourse() {
    const el = this.screen(`
      <h2>1. コースを選ぶ</h2>
      <div class="cards">${COURSES.map((c) => `
        <button class="card ${c.id === this.course.id ? 'selected' : ''}" data-course="${c.id}">
          <div class="card-title">${c.name}</div><div class="card-text">${c.description}</div>
        </button>`).join('')}</div>
      <div class="race-options"></div>
      <div class="buttons"><button data-back>戻る</button><button class="primary" data-next>次へ（車を選ぶ）</button></div>`);
    const opts = el.querySelector('.race-options') as HTMLElement;
    const renderOpts = () => {
      if (!this.course.track) { opts.innerHTML = '<p class="note">自由走行（周回と対戦相手はなし）</p>'; return; }
      opts.innerHTML = `
        <label class="field"><span class="field-name">周回数</span><input type="number" min="1" max="20" value="${this.laps}" data-laps></label>
        <label class="field"><span class="field-name">対戦相手の数</span><input type="number" min="0" max="7" value="${this.opponents}" data-opp></label>
        <label class="field"><span class="field-name">対戦相手の車</span><select data-same>
          <option value="mixed" ${this.sameCar ? '' : 'selected'}>いろいろな車種</option>
          <option value="same" ${this.sameCar ? 'selected' : ''}>自分と同じ車</option></select></label>`;
      (opts.querySelector('[data-laps]') as HTMLInputElement).oninput = (e) => { this.laps = Math.max(1, Math.min(20, Number((e.target as HTMLInputElement).value) || 1)); };
      (opts.querySelector('[data-opp]') as HTMLInputElement).oninput = (e) => { this.opponents = Math.max(0, Math.min(7, Number((e.target as HTMLInputElement).value) || 0)); };
      (opts.querySelector('[data-same]') as HTMLSelectElement).onchange = (e) => { this.sameCar = (e.target as HTMLSelectElement).value === 'same'; };
    };
    renderOpts();
    this.on(el, '[data-course]', (b) => {
      this.course = COURSES.find((c) => c.id === b.dataset.course)!;
      this.laps = this.course.laps || 3;
      el.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c === b));
      renderOpts();
    });
    this.on(el, '[data-back]', () => this.showTitle());
    this.on(el, '[data-next]', () => this.showCarSelect());
  }

  // ------------------------------------------------------------ 車
  private showCarSelect() {
    const all = [...CAR_PRESETS.map((p) => ({ p, custom: false })), ...this.custom.map((p) => ({ p, custom: true }))];
    const el = this.screen(`
      <h2>2. 車を選ぶ</h2>
      <div class="car-list">${all.map(({ p, custom }, i) => `
        <button class="car-item ${p.id === this.car.id && p.name === this.car.name ? 'selected' : ''}" data-car="${i}">
          <span class="swatch" style="background:${p.color}"></span>${p.name}${custom ? '<span class="tag">自作</span>' : ''}
        </button>`).join('')}</div>
      <div class="car-summary"></div>
      <div class="buttons">
        <button data-back>戻る</button>
        <button data-import>読み込む（JSON）</button>
        <button data-detail>細かく設定する</button>
        <button class="primary" data-go>このまま走る</button>
      </div>`, 'panel narrow');
    const sum = el.querySelector('.car-summary') as HTMLElement;
    const renderSum = () => {
      const d = computeDerived(this.car);
      sum.innerHTML = `<table class="derived">
        <tr><th>駆動</th><td>${this.car.drive.layout}（エンジン${this.car.engine.orientation === 'longitudinal' ? '縦置き' : '横置き'}）</td></tr>
        <tr><th>質量</th><td>${this.car.body.mass} kg（前 ${(this.car.body.weightFront * 100).toFixed(0)}%）</td></tr>
        <tr><th>最高出力</th><td>${d.peakPowerKW.toFixed(0)} kW（${(d.peakPowerKW * 1.3596).toFixed(0)} PS）</td></tr>
        <tr><th>最高速の見込み</th><td>${d.topSpeedKmh.toFixed(0)} km/h</td></tr>
        <tr><th>変速機</th><td>${this.car.gearbox.ratios.length} 段の自動</td></tr></table>`;
    };
    renderSum();
    this.on(el, '[data-car]', (b) => {
      this.car = cloneParams(all[Number(b.dataset.car)].p);
      this.view.showCar(this.car);
      el.querySelectorAll('.car-item').forEach((c) => c.classList.toggle('selected', c === b));
      renderSum();
    });
    this.on(el, '[data-back]', () => this.showCourse());
    this.on(el, '[data-detail]', () => this.showSettings());
    this.on(el, '[data-go]', () => this.startRace());
    this.on(el, '[data-import]', async () => {
      const p = await importCar();
      if (!p) return;
      p.id = `custom-${Date.now()}`;
      this.custom.push(p);
      saveCustomCars(this.custom);
      this.car = cloneParams(p);
      this.view.showCar(this.car);
      this.showCarSelect();
    });
  }

  // ------------------------------------------------------------ 詳細設定
  private showSettings() {
    const el = this.screen(`
      <h2>3. 細かく設定する <span class="sub">${this.car.name}</span></h2>
      <div class="settings">
        <div class="settings-side"><div class="derived-box"></div></div>
        <div class="settings-form"></div>
      </div>
      <div class="buttons">
        <button data-back>戻る</button>
        <button data-save>自作として保存</button>
        <button data-export>書き出す（JSON）</button>
        <button class="primary" data-go>この設定で走る</button>
      </div>
      <p class="note status"></p>`, 'panel settings-panel');
    const form = el.querySelector('.settings-form') as HTMLElement;
    const side = el.querySelector('.derived-box') as HTMLElement;
    const status = el.querySelector('.status') as HTMLElement;
    let timer = 0;
    const changed = () => {
      renderDerived(side, this.car);
      clearTimeout(timer);
      // 見た目の作り直しは打ち終わってから
      timer = window.setTimeout(() => this.view.showCar(this.car), 200);
    };
    buildSettingsForm(form, this.car, changed);
    renderDerived(side, this.car);
    this.on(el, '[data-back]', () => this.showCarSelect());
    this.on(el, '[data-go]', () => this.startRace());
    this.on(el, '[data-export]', () => exportCar(this.car));
    this.on(el, '[data-save]', () => {
      const p = cloneParams(this.car);
      const i = this.custom.findIndex((c) => c.id === p.id);
      if (i >= 0) this.custom[i] = p;
      else {
        p.id = `custom-${Date.now()}`;
        if (CAR_PRESETS.some((c) => c.name === p.name)) p.name = `${p.name}（改）`;
        this.custom.push(p);
        this.car = cloneParams(p);
      }
      status.textContent = saveCustomCars(this.custom) ? `「${p.name}」を保存しました（このブラウザの中だけ）` : 'このブラウザでは保存できません。書き出して残してください';
    });
  }

  // ------------------------------------------------------------ レース
  private startRace() {
    this.screen('<p class="loading">コースを作っています…</p>', 'panel center');
    setTimeout(() => {
      const opponents: CarParams[] = [];
      if (this.course.track) {
        for (let i = 0; i < this.opponents; i++) {
          const p = this.sameCar ? cloneParams(this.car) : cloneParams(CAR_PRESETS[i % CAR_PRESETS.length]);
          if (this.sameCar || p.color === this.car.color) p.color = COLORS[(i + 1) % COLORS.length];
          opponents.push(p);
        }
      }
      this.input.reset();
      this.touch.reset();
      this.session?.dispose();
      this.session = new Session(RAPIER, { course: this.course, player: cloneParams(this.car), opponents, laps: this.laps },
        (dt, v) => {
          // キーボードとスマホのどちらでも。キーでハンドルを切っているときはキーを優先
          const k = this.input.update(dt, v.speed), t = this.touch.update(dt, v.speed), g = this.pad;
          const steer = Math.abs(k.steer) > 0.01 ? k.steer : g.active && Math.abs(g.steer) > 0 ? g.steer : t.steer;
          return { steer, throttle: Math.max(k.throttle, t.throttle, g.throttle), brake: Math.max(k.brake, t.brake, g.brake) };
        });
      if (this.session.player) this.session.player.vehicle.manual = this.prefs.manual;
      this.view.setSession(this.session);
      this.hud.setCourse(this.session.course);
      this.hud.visible = true;
      this.touch.visible = isTouch;
      this.sound.unlock();
      this.sound.start(this.session);
      this.finishedAt = -1;
      this.resultsShown = false;
      this.overlay.style.display = 'none';
      this.overlay.innerHTML = '';
    }, 30);
  }

  private togglePause() {
    const s = this.session;
    if (!s || this.resultsShown) return;
    s.paused = !s.paused;
    if (!s.paused) { this.overlay.style.display = 'none'; return; }
    const el = this.screen(`
      <h2>一時停止</h2>
      ${this.prefsHtml()}
      <div class="buttons vertical">
        <button class="primary" data-resume>続ける</button>
        <button data-restart>最初からやり直す</button>
        <button data-car>車を変える</button>
        <button data-menu>コースを選び直す</button>
      </div>`, 'panel center');
    this.bindPrefs(el);
    this.on(el, '[data-resume]', () => this.togglePause());
    this.on(el, '[data-restart]', () => this.startRace());
    this.on(el, '[data-car]', () => { this.endSession(); this.showCarSelect(); });
    this.on(el, '[data-menu]', () => { this.endSession(); this.showCourse(); });
  }

  private prefsHtml() {
    return `<div class="prefs">
      <label class="field"><span class="field-name">音量</span><input type="range" min="0" max="1" step="0.05" value="${this.prefs.volume}" data-volume><span class="field-unit"></span></label>
      <label class="field"><span class="field-name">音を消す</span><input type="checkbox" ${this.prefs.muted ? 'checked' : ''} data-mute><span></span></label>
      <label class="field"><span class="field-name">変速</span><select data-trans><option value="auto" ${this.prefs.manual ? '' : 'selected'}>自動</option><option value="manual" ${this.prefs.manual ? 'selected' : ''}>手動（E/Q、RB/LB、画面の ▲▼）</option></select><span></span></label>
      ${isTouch ? `<label class="field"><span class="field-name">いっぱいに切る傾き</span><input type="range" min="15" max="90" step="5" value="${this.prefs.tiltRange}" data-tilt><span class="field-unit" data-tilt-text>${this.prefs.tiltRange}°</span></label>
      <label class="field"><span class="field-name">中央付近の鈍さ（遊び）</span><input type="range" min="0" max="1" step="0.05" value="${this.prefs.centerSoft}" data-soft><span class="field-unit" data-soft-text>${Math.round(this.prefs.centerSoft * 100)}%</span></label>` : ''}
    </div>`;
  }

  private bindPrefs(el: HTMLElement) {
    const vol = el.querySelector('[data-volume]') as HTMLInputElement | null;
    vol?.addEventListener('input', () => { this.prefs.volume = Number(vol.value); this.sound.volume = this.prefs.volume; savePrefs(this.prefs); });
    const trans = el.querySelector('[data-trans]') as HTMLSelectElement | null;
    trans?.addEventListener('change', () => {
      this.prefs.manual = trans.value === 'manual';
      document.body.classList.toggle('manual', this.prefs.manual);
      if (this.session?.player) this.session.player.vehicle.manual = this.prefs.manual;
      savePrefs(this.prefs);
    });
    const mute = el.querySelector('[data-mute]') as HTMLInputElement | null;
    mute?.addEventListener('change', () => this.setMuted(mute.checked));
    const tilt = el.querySelector('[data-tilt]') as HTMLInputElement | null;
    tilt?.addEventListener('input', () => {
      this.prefs.tiltRange = Number(tilt.value);
      this.touch.tiltSteer.opt.range = this.prefs.tiltRange;
    this.touch.tiltSteer.opt.centerSoft = this.prefs.centerSoft;
      (el.querySelector('[data-tilt-text]') as HTMLElement).textContent = `${tilt.value}°`;
      savePrefs(this.prefs);
    });
    const soft = el.querySelector('[data-soft]') as HTMLInputElement | null;
    soft?.addEventListener('input', () => {
      this.prefs.centerSoft = Number(soft.value);
      this.touch.tiltSteer.opt.centerSoft = this.prefs.centerSoft;
      (el.querySelector('[data-soft-text]') as HTMLElement).textContent = `${Math.round(this.prefs.centerSoft * 100)}%`;
      savePrefs(this.prefs);
    });
  }

  private setMuted(m: boolean) {
    this.prefs.muted = m;
    this.sound.muted = m;
    this.touch.setMuted(m);
    savePrefs(this.prefs);
  }

  private endSession() {
    this.sound.stop();
    this.touch.visible = false;
    this.view.clearSession();
    this.session?.dispose();
    this.session = null;
    this.hud.visible = false;
    this.view.showCar(this.car);
  }

  private showResults() {
    const s = this.session!;
    this.resultsShown = true;
    const st = s.race.standings();
    const el = this.screen(`
      <h2>結果 <span class="sub">${s.course.def.name}、${s.race.laps} 周</span></h2>
      <table class="results">
        <tr><th>順位</th><th>名前</th><th>車</th><th>タイム</th><th>最速の周</th></tr>
        ${st.map((r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.vehicle.p.name}</td>
          <td>${r.finished ? formatTime(r.finishTime) : `${r.laps} 周`}</td><td>${formatTime(r.bestLap)}</td></tr>`).join('')}
      </table>
      <div class="buttons"><button data-menu>コースを選び直す</button><button data-car>車を変える</button><button class="primary" data-again>もう一度</button></div>`, 'panel center');
    this.on(el, '[data-again]', () => this.startRace());
    this.on(el, '[data-car]', () => { this.endSession(); this.showCarSelect(); });
    this.on(el, '[data-menu]', () => { this.endSession(); this.showCourse(); });
  }
}

async function main() {
  initLayout();
  const stage = document.getElementById('stage')!;
  const overlay = document.getElementById('overlay') as HTMLDivElement;
  overlay.innerHTML = '<div class="panel center"><p class="loading">読み込み中…</p></div>';
  await RAPIER.init();
  new App(stage, overlay);
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">起動できませんでした: ${String(e)}</pre>`);
});
