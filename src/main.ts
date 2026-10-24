// 画面の流れ：タイトル → コース → 車 → 詳細設定（飛ばせる） → レース → 結果
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { Sound } from './audio/sound';
import type { VoiceMode } from './audio/voice';
import { Voice } from './audio/voice';
import { Commentator } from './game/commentary';
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
import { logoSvg } from './ui/logo';
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
interface Prefs { volume: number; muted: boolean; tiltRange: number; centerSoft: number; manual: boolean; quality: QualityPref; keySteer: number; voice: VoiceMode; duck: number }
function loadPrefs(): Prefs {
  const d: Prefs = { volume: 0.7, muted: false, tiltRange: 40, centerSoft: 1, manual: false, quality: 'auto', keySteer: 1, voice: 'all', duck: 0.4 };
  try { return { ...d, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>) }; } catch { return d; }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* 保存できなくても動く */ }
}

/** キーボードでメニューを選ぶときの割り当て（どれも CSS の選択子） */
interface NavSpec {
  /** 上下で動かすと、そのまま選ぶ一覧（コース、車） */
  list?: string;
  /** 上下で動かすだけのボタン（Enter で押す） */
  focusList?: string;
  /** 左右で切り替える種類 */
  tabs?: string;
  /** 左右で動かすボタン（種類が無いとき。決めなければ下のボタンの列） */
  sideList?: string;
  /** Enter で押すもの */
  enter?: string;
  /** Esc で押すもの */
  back?: string;
}

/** 対戦相手に配る番号（同じ番号が並ばないように） */
const RACE_NUMBERS = [7, 11, 22, 33, 44, 55, 63, 77, 88, 99];

const COLORS = ['#c8312b', '#3d6fb6', '#2f7d4a', '#f0b400', '#7b4fb0', '#e07020', '#20a0a0', '#d0d0d0'];

class App {
  private readonly view: GameView;
  private readonly hud: Hud;
  private readonly overlay: HTMLDivElement;
  private readonly input = new KeyboardInput();
  private readonly touch: TouchControls;
  private readonly pad = new GamepadInput();
  private readonly sound = new Sound();
  /** 読み上げ（メニューと実況） */
  private readonly voice = new Voice();
  private commentator: Commentator | null = null;
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
    this.input.sensitivity = this.prefs.keySteer;
    this.sound.volume = this.prefs.volume;
    this.sound.muted = this.prefs.muted;
    this.voice.volume = this.prefs.volume;
    this.voice.muted = this.prefs.muted;
    this.voice.mode = this.prefs.voice;
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
    window.addEventListener('keydown', (e) => this.onMenuKey(e));
    // メニューの効果音：押したボタンの役割で鳴らし分ける
    overlay.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const d = b.dataset;
      if ('back' in d || 'menu' in d || 'car' in d && b.closest('.buttons')) this.sound.ui('back');
      else if ('go' in d || 'again' in d || 'restart' in d || 'cardNext' in d) this.sound.ui(this.session && !this.resultsShown && !('again' in d || 'restart' in d) ? 'select' : 'start');
      else if ('tab' in d) this.sound.ui('tab');
      else if ('course' in d || 'car' in d) this.sound.ui('move');
      else this.sound.ui('select');
    }, true);
    overlay.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || isTouch || (e.relatedTarget instanceof Node && b.contains(e.relatedTarget))) return;
      this.sound.ui('hover');
    });
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

  /** 続きのある一覧は、続く側の縁を薄くする（スクロールバーの代わり） */
  private updateFades() {
    if (this.overlay.style.display === 'none') return;
    for (const el of this.overlay.querySelectorAll<HTMLElement>('.course-list, .car-list, .laps-list, .settings, .panel')) {
      const more = el.scrollHeight - el.clientHeight > 2;
      el.classList.toggle('fade-top', more && el.scrollTop > 2);
      el.classList.toggle('fade-bottom', more && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    }
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.updateFades();
    const s = this.session;
    this.pad.poll();
    if (s) {
      s.update(dt);
      if (!s.paused && !this.resultsShown) this.commentator?.update(dt);
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
    // 実況が話している間は、エンジンなどの音を 4 割ほどに下げる
    this.sound.duck = this.voice.talking ? this.prefs.duck : 1;
    this.sound.update(s, this.view.mode === 'cockpit');
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ キーボードでメニューを選ぶ
  private nav: NavSpec | null = null;
  private navRoot: HTMLElement | null = null;
  private navFocus: HTMLElement | null = null;

  private setNav(root: HTMLElement | null, spec: NavSpec | null) {
    this.navRoot = root;
    this.nav = spec;
    this.navFocus?.classList.remove('kb-focus');
    this.navFocus = null;
  }

  private onMenuKey(e: KeyboardEvent) {
    const s = this.session;
    if (s && !s.paused && !this.resultsShown) return;
    const nav = this.nav, root = this.navRoot;
    if (!nav || !root || !root.isConnected) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);
    if (typing && e.key !== 'Escape') return;
    const visible = (sel?: string) => (sel ? [...root.querySelectorAll<HTMLElement>(sel)].filter((x) => x.offsetParent !== null) : []);
    const focus = (el: HTMLElement | undefined) => {
      if (!el) return;
      this.navFocus?.classList.remove('kb-focus');
      this.navFocus = el;
      el.classList.add('kb-focus');
      el.scrollIntoView({ block: 'nearest' });
    };
    const step = (items: HTMLElement[], cur: number, d: number) => items[Math.max(0, Math.min(items.length - 1, cur < 0 ? (d > 0 ? 0 : items.length - 1) : cur + d))];
    let handled = true;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const d = e.key === 'ArrowDown' ? 1 : -1;
      const list = visible(nav.list);
      if (list.length > 0) {
        const next = step(list, list.findIndex((x) => x.classList.contains('selected')), d);
        this.navFocus?.classList.remove('kb-focus');
        this.navFocus = null;
        next?.click();
        next?.scrollIntoView({ block: 'nearest' });
      } else {
        const items = visible(nav.focusList);
        if (items.length > 0) { focus(step(items, this.navFocus ? items.indexOf(this.navFocus) : -1, d)); this.sound.ui('move'); }
        else handled = false;
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const d = e.key === 'ArrowRight' ? 1 : -1;
      const tabs = visible(nav.tabs);
      if (tabs.length > 0) step(tabs, tabs.findIndex((x) => x.classList.contains('selected')), d)?.click();
      else {
        const items = visible(nav.sideList ?? '.buttons button');
        if (items.length > 0) { focus(step(items, this.navFocus ? items.indexOf(this.navFocus) : -1, d)); this.sound.ui('move'); }
        else handled = false;
      }
    } else if (e.key === 'Enter') {
      if (this.navFocus && this.navFocus.isConnected) this.navFocus.click();
      else root.querySelector<HTMLElement>(nav.enter ?? '')?.click();
    } else if ((e.key === 'Escape' || e.key === 'Backspace') && nav.back) {
      root.querySelector<HTMLElement>(nav.back)?.click();
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  }

  /** 1 Track、2 Car、3 Tune の段の見出し */
  private steps(on: 1 | 2 | 3, title: string, sub = '') {
    const names = ['Track', 'Car', 'Tune'];
    return `<div class="steps">${names.map((n, i) => `<span class="step ${i + 1 === on ? 'on' : i + 1 < on ? 'done' : ''}"><b>${i + 1}</b>${n}</span>`).join('<i></i>')}</div>
      <h2 class="screen-title">${title}${sub ? ` <span class="sub">${sub}</span>` : ''}</h2>`;
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
    const real = COURSES.filter((c) => PLACES[c.id]).length;
    const el = this.screen(`
      ${logoSvg()}
      <p class="title-tagline">Real circuits. Real physics. Race the world.</p>
      <button class="title-start" data-go>Start</button>
      <div class="title-sub">
        <button data-prefs>Settings</button>
        ${isTouch ? '' : '<span class="title-hint">Press Enter to start</span>'}
      </div>
      <div class="title-prefs panel" hidden>${this.prefsHtml()}</div>
      <p class="title-foot"><span class="count">${real}</span> real circuits on 4 continents. ${isTouch
        ? 'Hold the phone in landscape and tilt it to steer.'
        : 'Keyboard or gamepad. ← → steer, ↑ throttle, ↓ brake.'} Tap a glowing circuit to jump in.</p>`, 'title-screen');
    this.bindPrefs(el);
    const prefs = el.querySelector('.title-prefs') as HTMLElement;
    this.on(el, '[data-prefs]', () => { prefs.hidden = !prefs.hidden; });
    const start = (courseId?: string) => {
      // 音、傾きセンサー、全画面と横向きの固定は、利用者のタップの中でしか始められない
      this.sound.unlock();
      void this.touch.enable();
      requestLandscape();
      if (courseId) {
        const c = COURSES.find((x) => x.id === courseId);
        if (c) { this.course = c; this.laps = c.laps || 3; }
      }
      this.showCourse();
      if (courseId) this.voice.menu(this.courseLine(this.course));
    };
    this.on(el, '[data-go]', () => start());
    this.setNav(el, { enter: '[data-go]' });
    // 後ろで地球儀がゆっくり回る。光る柱を押すと、そのコースを選んで次へ
    const globe = this.view.showGlobe();
    this.globe = globe;
    globe.setMarkers(this.globeMarkers());
    globe.setFraming('title');
    globe.onPick = (id) => { this.sound.ui('start'); start(id); };
  }

  /** 地球儀の柱（実在のコース） */
  private globeMarkers() {
    return COURSES.filter((c) => PLACES[c.id]).map((c) => ({ id: c.id, lat: PLACES[c.id].lat, lon: PLACES[c.id].lon, color: CAT_COLOR[c.category ?? 'original'] }));
  }

  // ------------------------------------------------------------ コース
  private courseTab: CourseCategory = 'original';
  private globe: Globe | null = null;
  private card: HTMLElement | null = null;
  private leader: HTMLElement | null = null;
  private coursePanel: HTMLElement | null = null;

  /** コースの読み上げ（実在のコースは国も） */
  private courseLine(c: CourseDef) {
    const pl = PLACES[c.id];
    const country = pl ? pl.place.split(',').pop()!.replace(/\(.*\)/, '').trim() : '';
    return country && !c.name.includes(country) ? `${c.name}, ${country}.` : `${c.name}.`;
  }

  private showCourse() {
    this.voice.menu('Choose your track.');
    this.courseTab = this.course.category ?? 'original';
    const tabs: [CourseCategory, string][] = (['original', 'international', 'technical', 'street', 'oval'] as CourseCategory[]).map((k) => [k, CAT_NAME[k]]);
    const el = this.screen(`
      ${this.steps(1, 'Choose a track')}
      <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${k === this.courseTab ? 'selected' : ''}" data-tab="${k}"><span class="dot" style="background:${CAT_COLOR[k]}"></span>${n}</button>`).join('')}</div>
      <div class="course-list"></div>
      <div class="race-options"></div>
      <div class="buttons"><button data-back>Back</button><button class="primary" data-next>Next: choose a car</button></div>
      <p class="kb-hint"><b>↑</b><b>↓</b> track&ensp;<b>←</b><b>→</b> category&ensp;<b>Enter</b> next&ensp;<b>Esc</b> back</p>`, 'panel course-panel');
    this.coursePanel = el;
    this.setNav(el, { list: '.course-row', tabs: '.tab', enter: '[data-next]', back: '[data-back]' });
    const list = el.querySelector('.course-list') as HTMLElement;
    // 出典は画面の下の細い行に出す
    const credit = document.createElement('p');
    credit.className = 'screen-credit';
    this.overlay.append(credit);
    const opts = el.querySelector('.race-options') as HTMLElement;

    // 地球儀と、選んだコースの説明のカード
    const globe = this.view.showGlobe();
    this.globe = globe;
    globe.setMarkers(this.globeMarkers());
    globe.setFraming('select');
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
      (opts.querySelector('[data-mode]') as HTMLSelectElement).onchange = (e) => {
        this.mode = (e.target as HTMLSelectElement).value as 'race' | 'attack';
        this.voice.menu(this.mode === 'attack' ? 'Time attack.' : 'Race against the A.I.');
        renderOpts();
      };
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
      this.voice.menu(this.courseLine(c));
    };
    const renderList = () => {
      const items = COURSES.filter((c) => (c.category ?? 'original') === this.courseTab);
      list.innerHTML = items.map((c, i) => `
        <button class="course-row ${c.id === this.course.id ? 'selected' : ''}" data-course="${c.id}" style="--cat:${CAT_COLOR[c.category ?? 'original']}">
          <span class="row-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="row-name">${c.name}</span>
          ${c.country ? `<span class="row-chip">${c.country}</span>` : ''}
          <span class="row-sub">${c.lengthOfficial ? `${(c.lengthOfficial / 1000).toFixed(1)} km` : ''}</span>
        </button>`).join('');
      this.on(list, '[data-course]', (b) => choose(COURSES.find((c) => c.id === b.dataset.course)!));
      requestAnimationFrame(() => list.querySelector('.course-row.selected')?.scrollIntoView({ block: 'nearest' }));
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
      this.sound.ui('select');
      choose(c);
    };
    renderList();
    renderOpts();
    renderCard();
    globe.select(PLACES[this.course.id] ? this.course.id : null);
    this.on(el, '[data-tab]', (b) => {
      setTab(b.dataset.tab as CourseCategory);
      this.voice.menu({ original: 'Original tracks.', international: 'Grand Prix circuits.', technical: 'Technical circuits.', street: 'Street circuits.', oval: 'Ovals.' }[b.dataset.tab as CourseCategory]);
    });
    this.on(el, '[data-back]', () => this.showTitle());
    this.on(el, '[data-next]', () => this.showCarSelect());
  }

  /** いまのカードの置き場所（候補の番号）。ほかの置き場所がはっきり良くなるまで動かさない */
  private cardSlot = -1;
  private cardFor = '';

  /**
   * 説明のカードを、選んだ柱の近くの、ほかの柱をなるべく隠さない所に置く（柱が無いコースは地球儀の横）。
   * 候補は柱の左右と上下の 8 か所と画面の右上と右下。隠す柱の数（表側は重く、裏側は軽く）と、柱からの遠さで比べる
   */
  private placeCard() {
    const g = this.globe, card = this.card, line = this.leader, panel = this.coursePanel;
    if (!g || !card || !line || !panel) return;
    const { w, h } = viewSize();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const left = panel.offsetLeft + panel.offsetWidth + 14;
    const s = PLACES[this.course.id] ? g.screenOf(this.course.id) : null;
    // 回している間はカードを薄くして、後ろの柱を見えるようにする
    card.classList.toggle('dragging', g.dragging);
    let x: number, y: number;
    const clampX = (v: number) => Math.max(left, Math.min(w - 12 - cw, v));
    const clampY = (v: number) => Math.max(12, Math.min(h - 12 - ch, v));
    if (s) {
      const gap = 34;
      const cands: [number, number][] = [
        [s.x + gap, s.y - ch * 0.35], [s.x - gap - cw, s.y - ch * 0.35],
        [s.x + gap, s.y - ch - gap * 0.6], [s.x - gap - cw, s.y - ch - gap * 0.6],
        [s.x + gap, s.y + gap * 0.6], [s.x - gap - cw, s.y + gap * 0.6],
        [s.x - cw / 2, s.y - ch - gap], [s.x - cw / 2, s.y + gap],
        [w - 12 - cw, 12], [w - 12 - cw, h - 12 - ch],
      ].map(([cx, cy]) => [clampX(cx), clampY(cy)]);
      const others = g.screenAll().filter((m) => m.id !== this.course.id);
      const pad = 16;
      const score = (cx: number, cy: number) => {
        let sc = 0;
        // 選んだ柱そのものは隠さない
        if (s.x > cx - pad && s.x < cx + cw + pad && s.y > cy - pad && s.y < cy + ch + pad) sc += 1000;
        for (const m of others) if (m.x > cx - pad && m.x < cx + cw + pad && m.y > cy - pad && m.y < cy + ch + pad) sc += m.front ? 10 : 1;
        const dx = Math.max(cx - s.x, 0, s.x - (cx + cw)), dy = Math.max(cy - s.y, 0, s.y - (cy + ch));
        return sc + Math.hypot(dx, dy) / 120;
      };
      if (this.cardFor !== this.course.id) { this.cardSlot = -1; this.cardFor = this.course.id; }
      let best = 0, bestScore = Infinity;
      cands.forEach(([cx, cy], i) => { const v = score(cx, cy); if (v < bestScore) { bestScore = v; best = i; } });
      // 今の置き場所が、いちばん良い所と比べて柱 1 本分より悪くなければそのまま
      if (this.cardSlot >= 0 && score(...cands[this.cardSlot]) <= bestScore + 6) best = this.cardSlot;
      this.cardSlot = best;
      [x, y] = cands[best];
    } else {
      x = clampX(w * g.centerX + w * 0.12);
      y = clampY(h / 2 - ch / 2);
    }
    // 置き場所が変わったときは、少しずつ動かす
    const prev = card.dataset.pos ? card.dataset.pos.split(',').map(Number) : [x, y];
    const k = Math.hypot(prev[0] - x, prev[1] - y) > 400 ? 1 : 0.25;
    x = prev[0] + (x - prev[0]) * k; y = prev[1] + (y - prev[1]) * k;
    card.dataset.pos = `${x},${y}`;
    card.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    card.classList.toggle('behind', !!s && !s.front);
    // 柱の頭からカードのいちばん近い縁へ細い線
    if (s && s.front) {
      const tx = Math.max(x, Math.min(x + cw, s.x)), ty = Math.max(y, Math.min(y + ch, s.y));
      const len = Math.hypot(tx - s.x, ty - s.y), ang = Math.atan2(ty - s.y, tx - s.x);
      line.style.display = len > 4 ? '' : 'none';
      line.style.width = `${len.toFixed(1)}px`;
      line.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) rotate(${ang.toFixed(4)}rad)`;
    } else {
      line.style.display = 'none';
    }
  }

  // ------------------------------------------------------------ 車
  private showCarSelect() {
    this.voice.menu('Choose your car.');
    const all = [...CAR_PRESETS.map((p) => ({ p, custom: false })), ...this.custom.map((p) => ({ p, custom: true }))];
    const el = this.screen(`
      ${this.steps(2, 'Choose a car')}
      <div class="car-list">${all.map(({ p, custom }, i) => {
        const d = computeDerived(p);
        return `
        <button class="car-item ${p.id === this.car.id && p.name === this.car.name ? 'selected' : ''}" data-car="${i}" style="--car:${p.color}">
          <span class="car-stripe"></span>
          <span class="car-main"><span class="car-name">${p.name}${custom ? '<span class="tag">Custom</span>' : ''}</span>
          <span class="car-sub">${(d.peakPowerKW * 1.3596).toFixed(0)} PS&ensp;${p.body.mass.toLocaleString('en-US')} kg</span></span>
          <span class="car-badge">${p.drive.layout}</span>
        </button>`;
      }).join('')}</div>
      <div class="car-summary"></div>
      <div class="buttons">
        <button data-back>Back</button>
        <button data-import>Import (JSON)</button>
        <button data-detail>Tune</button>
        <button class="primary" data-go>Race now</button>
      </div>
      <p class="kb-hint"><b>↑</b><b>↓</b> car&ensp;<b>←</b><b>→</b> buttons&ensp;<b>Enter</b> race&ensp;<b>Esc</b> back</p>`, 'panel narrow car-panel');
    const sum = el.querySelector('.car-summary') as HTMLElement;
    this.setNav(el, { list: '.car-item', enter: '[data-go]', back: '[data-back]' });
    requestAnimationFrame(() => el.querySelector('.car-item.selected')?.scrollIntoView({ block: 'nearest' }));
    const renderSum = () => {
      const p = this.car, d = computeDerived(p);
      const ps = d.peakPowerKW * 1.3596;
      const df = 0.5 * 1.225 * (200 / 3.6) ** 2 * p.aero.frontalArea * (p.aero.clFront + p.aero.clRear) / 9.81;
      const bar = (label: string, value: string, frac: number) => `
        <div class="stat"><span class="stat-label">${label}</span><span class="stat-bar"><i style="width:${Math.max(3, Math.min(100, frac * 100)).toFixed(0)}%"></i></span><span class="stat-value">${value}</span></div>`;
      sum.innerHTML = `
        ${bar('Power', `${ps.toFixed(0)} PS`, ps / 700)}
        ${bar('Top speed', `${d.topSpeedKmh.toFixed(0)} km/h`, (d.topSpeedKmh - 100) / 260)}
        ${bar('Power / weight', `${(ps / (p.body.mass / 1000)).toFixed(0)} PS/t`, ps / (p.body.mass / 1000) / 500)}
        ${bar('Grip', `μ ${p.tire.mu.toFixed(2)}`, (p.tire.mu - 0.7) / 0.7)}
        ${bar('Downforce', `${df.toFixed(0)} kgf @200`, df / 450)}
        <p class="car-facts">${p.drive.layout}&ensp;${p.engine.orientation === 'longitudinal' ? 'longitudinal' : 'transverse'} engine&ensp;${p.gearbox.ratios.length}-speed&ensp;${(p.body.weightFront * 100).toFixed(0)}% front weight</p>`;
    };
    renderSum();
    this.on(el, '[data-car]', (b) => {
      this.car = cloneParams(all[Number(b.dataset.car)].p);
      this.view.showCar(this.car);
      el.querySelectorAll('.car-item').forEach((c) => c.classList.toggle('selected', c === b));
      renderSum();
      const ps = computeDerived(this.car).peakPowerKW * 1.3596;
      this.voice.menu(`${this.car.name}. ${Math.round(ps / 5) * 5} horsepower.`);
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
    this.voice.menu('Tuning.');
    const el = this.screen(`
      ${this.steps(3, 'Tuning', this.car.name)}
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
    this.setNav(el, { enter: '[data-go]', back: '[data-back]' });
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
          // 番号はみな違うものにする
          const used = new Set([this.car.livery.number, ...opponents.map((o) => o.livery.number)]);
          if (p.livery.number === 0 || used.has(p.livery.number)) p.livery.number = RACE_NUMBERS.find((n) => !used.has(n)) ?? 0;
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
      // 実況（メニューだけを読む設定なら、走り出す一言だけ）
      this.voice.stop();
      this.commentator = new Commentator(this.session, (t, p) => this.voice.call(t, p), Math.floor(Math.random() * 1000) + 1);
      if (this.voice.mode === 'menu') this.voice.menu(`Let's go racing at ${this.course.name}!`);
      this.finishedAt = -1;
      this.resultsShown = false;
      this.overlay.style.display = 'none';
      this.overlay.innerHTML = '';
      this.setNav(null, null);
    }, 30);
  }

  private togglePause() {
    const s = this.session;
    if (!s || this.resultsShown) return;
    s.paused = !s.paused;
    if (!s.paused) { this.overlay.style.display = 'none'; this.setNav(null, null); return; }
    this.voice.stop();
    this.voice.menu('Paused.');
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
    this.setNav(el, { focusList: '.buttons.vertical button', enter: '[data-resume]' });
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
      <label class="field"><span class="field-name">Voice</span><select data-voice>${(['all', 'menu', 'off'] as const).map((v) => `<option value="${v}" ${this.prefs.voice === v ? 'selected' : ''}>${{ all: 'Menus and race commentary', menu: 'Menus only', off: 'Off' }[v]}</option>`).join('')}</select><span></span></label>
      <label class="field"><span class="field-name">Game sound while the voice speaks</span><input type="range" min="0.1" max="1" step="0.05" value="${this.prefs.duck}" data-duck><span class="field-unit" data-duck-text>${Math.round(this.prefs.duck * 100)}%</span></label>
      <label class="field"><span class="field-name">Transmission</span><select data-trans><option value="auto" ${this.prefs.manual ? '' : 'selected'}>Automatic</option><option value="manual" ${this.prefs.manual ? 'selected' : ''}>Manual (E/Q, RB/LB, on-screen ▲▼)</option></select><span></span></label>
      ${isTouch ? '' : `<label class="field"><span class="field-name">Keyboard steering speed</span><input type="range" min="0.5" max="2" step="0.1" value="${this.prefs.keySteer}" data-keysteer><span class="field-unit" data-keysteer-text>${Math.round(this.prefs.keySteer * 100)}%</span></label>`}
      ${isTouch ? `<label class="field"><span class="field-name">Tilt for full lock</span><input type="range" min="15" max="90" step="5" value="${this.prefs.tiltRange}" data-tilt><span class="field-unit" data-tilt-text>${this.prefs.tiltRange}°</span></label>
      <label class="field"><span class="field-name">Center deadzone</span><input type="range" min="0" max="1" step="0.05" value="${this.prefs.centerSoft}" data-soft><span class="field-unit" data-soft-text>${Math.round(this.prefs.centerSoft * 100)}%</span></label>` : ''}
    </div>`;
  }

  private bindPrefs(el: HTMLElement) {
    const vol = el.querySelector('[data-volume]') as HTMLInputElement | null;
    vol?.addEventListener('input', () => { this.prefs.volume = Number(vol.value); this.sound.volume = this.prefs.volume; this.voice.volume = this.prefs.volume; savePrefs(this.prefs); });
    const qsel = el.querySelector('[data-quality]') as HTMLSelectElement | null;
    qsel?.addEventListener('change', () => {
      this.prefs.quality = qsel.value as QualityPref;
      quality.pref = this.prefs.quality;
      this.view.applyQuality();
      this.view.refreshSky();
      this.view.resize();
      savePrefs(this.prefs);
    });
    const ks = el.querySelector('[data-keysteer]') as HTMLInputElement | null;
    ks?.addEventListener('input', () => {
      this.prefs.keySteer = Number(ks.value);
      this.input.sensitivity = this.prefs.keySteer;
      (el.querySelector('[data-keysteer-text]') as HTMLElement).textContent = `${Math.round(this.prefs.keySteer * 100)}%`;
      savePrefs(this.prefs);
    });
    const dk = el.querySelector('[data-duck]') as HTMLInputElement | null;
    dk?.addEventListener('input', () => {
      this.prefs.duck = Number(dk.value);
      (el.querySelector('[data-duck-text]') as HTMLElement).textContent = `${Math.round(this.prefs.duck * 100)}%`;
      savePrefs(this.prefs);
    });
    const vsel = el.querySelector('[data-voice]') as HTMLSelectElement | null;
    vsel?.addEventListener('change', () => {
      this.prefs.voice = vsel.value as VoiceMode;
      this.voice.mode = this.prefs.voice;
      if (this.prefs.voice === 'off') this.voice.stop(); else this.voice.menu(this.prefs.voice === 'all' ? 'Commentary on.' : 'Menu voice on.');
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
    this.voice.muted = m;
    if (m) this.voice.stop();
    this.touch.setMuted(m);
    savePrefs(this.prefs);
  }

  private endSession() {
    this.sound.stop();
    this.voice.stop();
    this.commentator = null;
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
    this.setNav(el, { focusList: '.buttons button', enter: '[data-again]' });
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
    this.setNav(el, { focusList: '.buttons button', enter: '[data-again]' });
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
