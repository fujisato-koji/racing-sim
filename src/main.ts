// 画面の流れ：タイトル → コース → 車 → 詳細設定（飛ばせる） → レース → 結果
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { Sound } from './audio/sound';
import { GamepadInput } from './game/gamepad';
import { KeyboardInput } from './game/input';
import { TouchControls } from './game/touch';
import { Session } from './game/session';
import { drawTraces } from './game/telemetry';
import { GameView } from './render/view';
import type { CourseCategory, CourseDef } from './sim/course';
import { COURSES } from './sim/courses';
import { PLACES } from './sim/tracks/places';
import type { CarParams } from './sim/params';
import { cloneParams, computeDerived } from './sim/params';
import { CAR_PRESETS } from './sim/presets';
import { Hud, formatTime } from './ui/hud';
import { initLayout, isTouch, requestLandscape, viewSize } from './ui/layout';
import type { Globe } from './render/globe';
import { loadScenery } from './render/scenery';
import { themeOf } from './render/themes';
import { polarSampler } from './sim/terrain-sampler';
import type { BuildingsData } from './sim/osm-buildings';
import { decodeBuildings } from './sim/osm-buildings';

const BUILDING_FILES = import.meta.glob<BuildingsData>('./sim/buildings/*.json', { import: 'default' });
async function loadBuildings(id: string) {
  const f = BUILDING_FILES[`./sim/buildings/${id}.json`];
  try { return f ? decodeBuildings(await f()) : undefined; } catch { return undefined; }
}
import type { QualityPref } from './render/quality';
import { quality } from './render/quality';
import { buildSettingsForm, renderDerived } from './ui/settings';
import { exportCar, importCar, loadCustomCars, saveCustomCars } from './ui/storage';

/** 種類ごとの色（地球儀の柱、一覧の点、説明のカード） */
const CAT_COLOR: Record<CourseCategory, string> = { original: '#e8ecf2', international: '#ffb000', technical: '#3fd06a', street: '#ff4fa3', oval: '#3fc3ff' };
const CAT_NAME: Record<CourseCategory, string> = { original: 'Original', international: 'Grand Prix', technical: 'Technical', street: 'Street', oval: 'Oval' };

/** コースの形の小さな図（制御点を結ぶ） */
function drawThumb(cv: HTMLCanvasElement, c: CourseDef, color = '#e8ecf2') {
  const g = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const pts = c.track?.points;
  if (!pts) {
    g.strokeStyle = '#9aa4b2'; g.lineWidth = 2; g.strokeRect(W * 0.3, H * 0.15, W * 0.4, H * 0.7);
    g.fillStyle = '#e0b020'; for (const k of [0.4, 0.5, 0.6]) g.fillRect(W * k - 3, H * 0.55, 6, 6);
    return;
  }
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const sc = Math.min((W - 16) / (x1 - x0), (H - 16) / (z1 - z0));
  const ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
  g.strokeStyle = color; g.lineWidth = 2.5; g.lineJoin = 'round';
  g.shadowColor = color; g.shadowBlur = 6;
  g.beginPath();
  pts.forEach(([x, z], i) => { const px = ox + (x - x0) * sc, pz = oz + (z - z0) * sc; if (i === 0) g.moveTo(px, pz); else g.lineTo(px, pz); });
  g.closePath(); g.stroke();
  g.shadowBlur = 0;
  const [sx, sz] = pts[0];
  g.fillStyle = '#ffb000'; g.beginPath(); g.arc(ox + (sx - x0) * sc, oz + (sz - z0) * sc, 4, 0, Math.PI * 2); g.fill();
}

const PREFS = 'racing-sim.prefs.v1';
interface Prefs { volume: number; muted: boolean; tiltRange: number; centerSoft: number; manual: boolean; quality: QualityPref }
function loadPrefs(): Prefs {
  const d: Prefs = { volume: 0.7, muted: false, tiltRange: 40, centerSoft: 1, manual: false, quality: 'auto' };
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
  private mode: 'race' | 'attack' = 'race';
  private car: CarParams = cloneParams(CAR_PRESETS[2]);
  private custom: CarParams[] = loadCustomCars();
  private finishedAt = -1;
  private resultsShown = false;
  private last = performance.now();

  constructor(stage: HTMLElement, overlay: HTMLDivElement) {
    quality.pref = this.prefs.quality;
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
      if (this.globe) this.placeCard();
    }
    this.sound.update(s, this.view.mode === 'cockpit');
    requestAnimationFrame((t) => this.frame(t));
  }

  private screen(html: string, cls = 'panel') {
    // 地球儀はコースを選ぶ画面だけ
    if (this.globe) { this.view.hideGlobe(); this.globe = null; this.card = null; this.leader = null; }
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
      <h1 class="game-title">Apex <span>Atlas</span></h1>
      <p class="tagline">Real circuits. Real physics. Race the world.</p>
      <p class="lead">Pick a circuit on the globe and race it. Tire friction, suspension, the drivetrain from engine to wheels, and aerodynamics are all simulated.</p>
      <div class="buttons title-start"><button class="primary" data-go>Start</button></div>
      ${this.prefsHtml()}
      <p class="note">${isTouch
        ? 'Hold the phone in landscape and tilt it like a steering wheel. Right pedal is throttle, left pedal is brake. Shifting is automatic.'
        : 'Play with a keyboard or gamepad. ← → steer, ↑ throttle, ↓ brake. In manual mode, E shifts up and Q shifts down.'}</p>`);
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
  private courseTab: CourseCategory = 'original';
  private globe: Globe | null = null;
  private card: HTMLElement | null = null;
  private leader: HTMLElement | null = null;
  private coursePanel: HTMLElement | null = null;

  private showCourse() {
    this.courseTab = this.course.category ?? 'original';
    const tabs: [CourseCategory, string][] = (['original', 'international', 'technical', 'street', 'oval'] as CourseCategory[]).map((k) => [k, CAT_NAME[k]]);
    const el = this.screen(`
      <h2>1. Choose a track</h2>
      <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${k === this.courseTab ? 'selected' : ''}" data-tab="${k}"><span class="dot" style="background:${CAT_COLOR[k]}"></span>${n}</button>`).join('')}</div>
      <div class="course-list"></div>
      <p class="note credit"></p>
      <div class="race-options"></div>
      <div class="buttons"><button data-back>Back</button><button class="primary" data-next>Next: choose a car</button></div>`, 'panel course-panel');
    this.coursePanel = el;
    const list = el.querySelector('.course-list') as HTMLElement;
    const credit = el.querySelector('.credit') as HTMLElement;
    const opts = el.querySelector('.race-options') as HTMLElement;

    // 地球儀と、選んだコースの説明のカード
    const globe = this.view.showGlobe();
    this.globe = globe;
    globe.setMarkers(COURSES.filter((c) => PLACES[c.id]).map((c) => ({ id: c.id, lat: PLACES[c.id].lat, lon: PLACES[c.id].lon, color: CAT_COLOR[c.category ?? 'original'] })));
    this.leader = document.createElement('div');
    this.leader.className = 'globe-leader';
    this.leader.style.pointerEvents = 'none';
    this.card = document.createElement('div');
    this.card.className = 'globe-card';
    this.overlay.append(this.leader, this.card);

    const renderOpts = () => {
      credit.textContent = this.course.credit ?? '';
      if (!this.course.track) { opts.innerHTML = '<p class="note">Free drive (no laps or opponents)</p>'; return; }
      const attack = this.mode === 'attack';
      opts.innerHTML = `
        <label class="field"><span class="field-name">Mode</span><select data-mode>
          <option value="race" ${attack ? '' : 'selected'}>Race vs AI</option>
          <option value="attack" ${attack ? 'selected' : ''}>Time attack</option></select></label>
        ${attack ? '<p class="note">Drive solo and keep lapping until you stop. Laps where you were reset to the track do not count. Your best lap is kept in this browser and runs alongside you next time as a translucent ghost car.</p>' : `
        <label class="field"><span class="field-name">Laps</span><input type="number" min="1" max="20" value="${this.laps}" data-laps></label>
        <label class="field"><span class="field-name">Opponents</span><input type="number" min="0" max="7" value="${this.opponents}" data-opp></label>
        <label class="field"><span class="field-name">Opponent cars</span><select data-same>
          <option value="mixed" ${this.sameCar ? '' : 'selected'}>Mixed</option>
          <option value="same" ${this.sameCar ? 'selected' : ''}>Same as mine</option></select></label>`}`;
      (opts.querySelector('[data-mode]') as HTMLSelectElement).onchange = (e) => { this.mode = (e.target as HTMLSelectElement).value as 'race' | 'attack'; renderOpts(); };
      if (attack) return;
      (opts.querySelector('[data-laps]') as HTMLInputElement).oninput = (e) => { this.laps = Math.max(1, Math.min(20, Number((e.target as HTMLInputElement).value) || 1)); };
      (opts.querySelector('[data-opp]') as HTMLInputElement).oninput = (e) => { this.opponents = Math.max(0, Math.min(7, Number((e.target as HTMLInputElement).value) || 0)); };
      (opts.querySelector('[data-same]') as HTMLSelectElement).onchange = (e) => { this.sameCar = (e.target as HTMLSelectElement).value === 'same'; };
    };
    const renderCard = () => {
      const c = this.course, pl = PLACES[c.id], cat = c.category ?? 'original', color = CAT_COLOR[cat];
      const stats = pl && c.lengthOfficial ? `<div class="gc-stats">
          <div><b>${(c.lengthOfficial / 1000).toFixed(3)}</b><small>km lap</small></div>
          <div><b>${(c.rise ?? 0).toFixed(0)}</b><small>m elevation</small></div>
          <div><b>${pl.opened}</b><small>opened</small></div></div>` : '';
      const card = this.card!;
      card.innerHTML = `
        <div class="gc-cat" style="color:${color}">${CAT_NAME[cat]}</div>
        <div class="gc-name">${c.name}${c.nameEn ? `<span>${c.nameEn}</span>` : ''}</div>
        <div class="gc-place">${pl ? pl.place : 'Original track made for this game'}</div>
        <div class="gc-mood">${themeOf(c.id).mood}</div>
        <canvas width="440" height="220" data-card-thumb></canvas>
        ${stats}
        <p class="gc-blurb">${pl ? pl.blurb : c.description}</p>
        <button class="primary" data-card-next>Choose this track</button>`;
      drawThumb(card.querySelector('[data-card-thumb]') as HTMLCanvasElement, c, color);
      (card.querySelector('[data-card-next]') as HTMLElement).onclick = () => this.showCarSelect();
      card.classList.remove('pop');
      void card.offsetWidth;
      card.classList.add('pop');
    };
    const choose = (c: CourseDef, fly = true) => {
      this.course = c;
      this.laps = c.laps || 3;
      for (const r of list.querySelectorAll<HTMLElement>('.course-row')) r.classList.toggle('selected', r.dataset.course === c.id);
      globe.select(PLACES[c.id] ? c.id : null, fly);
      renderOpts();
      renderCard();
    };
    const renderList = () => {
      const items = COURSES.filter((c) => (c.category ?? 'original') === this.courseTab);
      list.innerHTML = items.map((c) => `
        <button class="course-row ${c.id === this.course.id ? 'selected' : ''}" data-course="${c.id}">
          <span class="dot" style="background:${CAT_COLOR[c.category ?? 'original']}"></span>
          <span class="row-name">${c.name}</span>
          <span class="row-sub">${c.country ?? ''}${c.lengthOfficial ? ` ${(c.lengthOfficial / 1000).toFixed(1)} km` : ''}</span>
        </button>`).join('');
      this.on(list, '[data-course]', (b) => choose(COURSES.find((c) => c.id === b.dataset.course)!));
    };
    const setTab = (t: CourseCategory) => {
      this.courseTab = t;
      for (const x of el.querySelectorAll<HTMLElement>('.tab')) x.classList.toggle('selected', x.dataset.tab === t);
      renderList();
    };
    globe.onPick = (id) => {
      const c = COURSES.find((x) => x.id === id);
      if (!c) return;
      if ((c.category ?? 'original') !== this.courseTab) setTab(c.category ?? 'original');
      choose(c);
    };
    renderList();
    renderOpts();
    renderCard();
    globe.select(PLACES[this.course.id] ? this.course.id : null);
    this.on(el, '[data-tab]', (b) => setTab(b.dataset.tab as CourseCategory));
    this.on(el, '[data-back]', () => this.showTitle());
    this.on(el, '[data-next]', () => this.showCarSelect());
  }

  /** 説明のカードを、選んだ柱の横に置く（柱が無いコースは地球儀の横） */
  private placeCard() {
    const g = this.globe, card = this.card, line = this.leader, panel = this.coursePanel;
    if (!g || !card || !line || !panel) return;
    const { w, h } = viewSize();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const left = panel.offsetLeft + panel.offsetWidth + 14;
    const s = PLACES[this.course.id] ? g.screenOf(this.course.id) : null;
    let x: number, y: number;
    if (s) {
      x = s.x + 46;
      if (x + cw > w - 12) x = s.x - 46 - cw;
      y = s.y - ch * 0.35;
    } else {
      x = w * g.centerX + w * 0.12;
      y = h / 2 - ch / 2;
    }
    x = Math.max(left, Math.min(w - 12 - cw, x));
    y = Math.max(12, Math.min(h - 12 - ch, y));
    card.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    card.classList.toggle('behind', !!s && !s.front);
    // 柱の頭からカードの縁へ細い線
    if (s && s.front) {
      const tx = x < s.x ? x + cw : x, ty = Math.max(y + 18, Math.min(y + ch - 18, s.y));
      const len = Math.hypot(tx - s.x, ty - s.y), ang = Math.atan2(ty - s.y, tx - s.x);
      line.style.display = '';
      line.style.width = `${len.toFixed(1)}px`;
      line.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) rotate(${ang.toFixed(4)}rad)`;
    } else {
      line.style.display = 'none';
    }
  }

  // ------------------------------------------------------------ 車
  private showCarSelect() {
    const all = [...CAR_PRESETS.map((p) => ({ p, custom: false })), ...this.custom.map((p) => ({ p, custom: true }))];
    const el = this.screen(`
      <h2>2. Choose a car</h2>
      <div class="car-list">${all.map(({ p, custom }, i) => `
        <button class="car-item ${p.id === this.car.id && p.name === this.car.name ? 'selected' : ''}" data-car="${i}">
          <span class="swatch" style="background:${p.color}"></span>${p.name}${custom ? '<span class="tag">Custom</span>' : ''}
        </button>`).join('')}</div>
      <div class="car-summary"></div>
      <div class="buttons">
        <button data-back>Back</button>
        <button data-import>Import (JSON)</button>
        <button data-detail>Tune</button>
        <button class="primary" data-go>Race now</button>
      </div>`, 'panel narrow');
    const sum = el.querySelector('.car-summary') as HTMLElement;
    const renderSum = () => {
      const d = computeDerived(this.car);
      sum.innerHTML = `<table class="derived">
        <tr><th>Drive</th><td>${this.car.drive.layout}(${this.car.engine.orientation === 'longitudinal' ? 'longitudinal' : 'transverse'} engine)</td></tr>
        <tr><th>Mass</th><td>${this.car.body.mass} kg(${(this.car.body.weightFront * 100).toFixed(0)}% front)</td></tr>
        <tr><th>Peak power</th><td>${d.peakPowerKW.toFixed(0)} kW (${(d.peakPowerKW * 1.3596).toFixed(0)} PS)</td></tr>
        <tr><th>Est. top speed</th><td>${d.topSpeedKmh.toFixed(0)} km/h</td></tr>
        <tr><th>Gearbox</th><td>${this.car.gearbox.ratios.length}-speed automatic</td></tr></table>`;
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
      <h2>3. Tuning <span class="sub">${this.car.name}</span></h2>
      <div class="settings">
        <div class="settings-side"><div class="derived-box"></div></div>
        <div class="settings-form"></div>
      </div>
      <div class="buttons">
        <button data-back>Back</button>
        <button data-save>Save as custom</button>
        <button data-export>Export (JSON)</button>
        <button class="primary" data-go>Race with these settings</button>
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
        if (CAR_PRESETS.some((c) => c.name === p.name)) p.name = `${p.name} (edited)`;
        this.custom.push(p);
        this.car = cloneParams(p);
      }
      status.textContent = saveCustomCars(this.custom) ? `Saved "${p.name}" (in this browser only)` : 'This browser cannot save. Export it instead.';
    });
  }

  // ------------------------------------------------------------ レース
  private startRace() {
    this.screen('<p class="loading">Building the track…</p>', 'panel center');
    setTimeout(async () => {
      const [scenery, buildings] = await Promise.all([loadScenery(this.course.id), loadBuildings(this.course.id)]);
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
      this.session = new Session(RAPIER, { course: this.course, player: cloneParams(this.car), opponents, laps: this.laps, mode: this.course.track ? this.mode : 'race',
        terrain: scenery ? polarSampler(scenery, themeOf(this.course.id).seaLevel ?? 0) : undefined, buildings },
        (dt, v) => {
          // キーボードとスマホのどちらでも。キーでハンドルを切っているときはキーを優先
          const k = this.input.update(dt, v.speed), t = this.touch.update(dt, v.speed), g = this.pad;
          const steer = Math.abs(k.steer) > 0.01 ? k.steer : g.active && Math.abs(g.steer) > 0 ? g.steer : t.steer;
          return { steer, throttle: Math.max(k.throttle, t.throttle, g.throttle), brake: Math.max(k.brake, t.brake, g.brake) };
        });
      if (this.session.player) this.session.player.vehicle.manual = this.prefs.manual;
      this.view.setSession(this.session, scenery);
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
    const a = s.attack;
    const el = this.screen(`
      <h2>Paused</h2>
      ${a ? this.telemetryHtml() : ''}
      ${this.prefsHtml()}
      ${a ? `<label class="field"><span class="field-name">Ghost</span><input type="checkbox" ${this.view.showGhost ? 'checked' : ''} data-ghost><span></span></label>` : ''}
      <div class="buttons vertical">
        <button class="primary" data-resume>Resume</button>
        ${a ? '<button data-finish>Finish (see lap times)</button>' : ''}
        <button data-restart>Restart</button>
        <button data-car>Change car</button>
        <button data-menu>Change track</button>
      </div>`, 'panel center');
    this.bindPrefs(el);
    this.drawTelemetry(el);
    const gh = el.querySelector('[data-ghost]') as HTMLInputElement | null;
    gh?.addEventListener('change', () => { this.view.showGhost = gh.checked; });
    this.on(el, '[data-finish]', () => this.showResults());
    this.on(el, '[data-resume]', () => this.togglePause());
    this.on(el, '[data-restart]', () => this.startRace());
    this.on(el, '[data-car]', () => { this.endSession(); this.showCarSelect(); });
    this.on(el, '[data-menu]', () => { this.endSession(); this.showCourse(); });
  }

  private prefsHtml() {
    return `<div class="prefs">
      <label class="field"><span class="field-name">Volume</span><input type="range" min="0" max="1" step="0.05" value="${this.prefs.volume}" data-volume><span class="field-unit"></span></label>
      <label class="field"><span class="field-name">Mute</span><input type="checkbox" ${this.prefs.muted ? 'checked' : ''} data-mute><span></span></label>
      <label class="field"><span class="field-name">Graphics</span><select data-quality>${(['auto', 'low', 'medium', 'high'] as const).map((q) => `<option value="${q}" ${this.prefs.quality === q ? 'selected' : ''}>${{ auto: 'Auto (lowers resolution when slow)', low: 'Low', medium: 'Medium', high: 'High' }[q]}</option>`).join('')}</select><span></span></label>
      <label class="field"><span class="field-name">Transmission</span><select data-trans><option value="auto" ${this.prefs.manual ? '' : 'selected'}>Automatic</option><option value="manual" ${this.prefs.manual ? 'selected' : ''}>Manual (E/Q, RB/LB, on-screen ▲▼)</option></select><span></span></label>
      ${isTouch ? `<label class="field"><span class="field-name">Tilt for full lock</span><input type="range" min="15" max="90" step="5" value="${this.prefs.tiltRange}" data-tilt><span class="field-unit" data-tilt-text>${this.prefs.tiltRange}°</span></label>
      <label class="field"><span class="field-name">Center deadzone</span><input type="range" min="0" max="1" step="0.05" value="${this.prefs.centerSoft}" data-soft><span class="field-unit" data-soft-text>${Math.round(this.prefs.centerSoft * 100)}%</span></label>` : ''}
    </div>`;
  }

  private bindPrefs(el: HTMLElement) {
    const vol = el.querySelector('[data-volume]') as HTMLInputElement | null;
    vol?.addEventListener('input', () => { this.prefs.volume = Number(vol.value); this.sound.volume = this.prefs.volume; savePrefs(this.prefs); });
    const qsel = el.querySelector('[data-quality]') as HTMLSelectElement | null;
    qsel?.addEventListener('change', () => {
      this.prefs.quality = qsel.value as QualityPref;
      quality.pref = this.prefs.quality;
      this.view.applyQuality();
      this.view.refreshSky();
      this.view.resize();
      savePrefs(this.prefs);
    });
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

  /** テレメトリの図（最速の周と、いちばん新しい周） */
  private telemetryHtml() {
    const a = this.session?.attack;
    if (!a || (!a.bestTrace && !a.lastTrace)) return '<p class="note">Complete a lap and your speed, throttle, brake and gap to your best lap will show up here.</p>';
    return `<canvas class="telemetry" width="760" height="300" data-telemetry></canvas>
      <p class="note"><span style="color:#5ab0ff">━</span> Best lap&emsp;<span style="color:#ffb000">━</span> Latest lap&emsp;<span style="color:#3fd06a">━</span> Throttle&emsp;<span style="color:#ff5a5a">━</span> Brake<br>Bottom row: gap to your best lap (higher means slower)</p>`;
  }

  private drawTelemetry(el: HTMLElement) {
    const a = this.session?.attack;
    const cv = el.querySelector('[data-telemetry]') as HTMLCanvasElement | null;
    if (a && cv) drawTraces(cv, a.bestTrace, a.lastTrace);
  }

  private showAttackResults() {
    const s = this.session!;
    const a = s.attack!;
    this.resultsShown = true;
    s.paused = true;
    const rows = a.laps.map((l, i) => `<tr class="${l.best ? 'me' : ''}"><td>${i + 1}</td><td>${formatTime(l.time)}</td><td>${l.best ? 'New best' : l.valid ? '' : 'No time (reset)'}</td></tr>`).join('');
    const el = this.screen(`
      <h2>Time attack <span class="sub">${s.course.def.name}, ${s.player!.vehicle.p.name}</span></h2>
      <p>Best in this browser <b>${formatTime(a.best?.time ?? NaN)}</b></p>
      ${a.laps.length ? `<div class="laps-list"><table class="results"><tr><th>Lap</th><th>Time</th><th></th></tr>${rows}</table></div>` : '<p class="note">No completed laps.</p>'}
      ${this.telemetryHtml()}
      <div class="buttons"><button data-menu>Change track</button><button data-car>Change car</button><button class="primary" data-again>Race again</button></div>`, 'panel center');
    this.drawTelemetry(el);
    this.on(el, '[data-again]', () => this.startRace());
    this.on(el, '[data-car]', () => { this.endSession(); this.showCarSelect(); });
    this.on(el, '[data-menu]', () => { this.endSession(); this.showCourse(); });
  }

  private showResults() {
    const s = this.session!;
    if (s.attack) { this.showAttackResults(); return; }
    this.resultsShown = true;
    const st = s.race.standings();
    const el = this.screen(`
      <h2>Results <span class="sub">${s.course.def.name}, ${s.race.laps} laps</span></h2>
      <table class="results">
        <tr><th>Pos</th><th>Name</th><th>Car</th><th>Time</th><th>Best lap</th></tr>
        ${st.map((r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.vehicle.p.name}</td>
          <td>${r.finished ? formatTime(r.finishTime) : `${r.laps} laps`}</td><td>${formatTime(r.bestLap)}</td></tr>`).join('')}
      </table>
      <div class="buttons"><button data-menu>Change track</button><button data-car>Change car</button><button class="primary" data-again>Race again</button></div>`, 'panel center');
    this.on(el, '[data-again]', () => this.startRace());
    this.on(el, '[data-car]', () => { this.endSession(); this.showCarSelect(); });
    this.on(el, '[data-menu]', () => { this.endSession(); this.showCourse(); });
  }
}

async function main() {
  initLayout();
  const stage = document.getElementById('stage')!;
  const overlay = document.getElementById('overlay') as HTMLDivElement;
  overlay.innerHTML = '<div class="panel center"><p class="loading">Loading…</p></div>';
  await RAPIER.init();
  new App(stage, overlay);
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">Could not start: ${String(e)}</pre>`);
});
