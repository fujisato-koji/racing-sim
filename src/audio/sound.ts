// 音。すべて Web Audio で合成する（音声ファイルを持たない）。
// エンジンは回転数と気筒数から点火の周波数を出し、アクセル開度で濁りと大きさを変える。
import type { Session } from '../game/session';
import type { Vehicle } from '../sim/vehicle';

const LOOSE = new Set(['gravel', 'sand', 'grass', 'rock']);

function noiseBuffer(ctx: AudioContext, seconds = 2) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function softClip(amount: number) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

/** 車の音の性格（諸元から決める） */
interface Character {
  cylinders: number;
  /** 点火の間隔のずれで生まれる鼓動の周波数（点火の周波数に対する比）と深さ */
  pulseRatio: number;
  pulseDepth: number;
  /** 歪みの強さ、高い音の通しやすさ、大きさ */
  drive: number;
  bright: number;
  level: number;
}

function character(v: Vehicle): Character {
  const e = v.p.engine;
  const layout = e.layout ?? 'inline';
  const ex = e.exhaust ?? 'sport';
  return {
    cylinders: e.cylinders || 4,
    // 水平対向は 2 回の点火ごと、V 型（クロスプレーン）は 4 回ごとに鼓動する
    pulseRatio: layout === 'v' ? 0.25 : 0.5,
    pulseDepth: layout === 'flat' ? 0.6 : layout === 'v' ? 0.5 : 0.12,
    drive: ex === 'quiet' ? 1.6 : ex === 'sport' ? 2.6 : 4.2,
    bright: ex === 'quiet' ? 0.65 : ex === 'sport' ? 1.0 : 1.35,
    level: ex === 'quiet' ? 0.8 : ex === 'sport' ? 1.0 : 1.15,
  };
}

class EngineVoice {
  readonly out: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly oscs: OscillatorNode[];
  private readonly mix: GainNode[];
  private readonly rough: GainNode;
  private readonly roughFilter: BiquadFilterNode;
  private readonly filter: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  private readonly src: AudioBufferSourceNode;
  private readonly pulse: OscillatorNode;
  private readonly pulseGain: GainNode;
  private readonly am: GainNode;
  private ch: Character | null = null;
  vehicle: Vehicle | null = null;

  constructor(private readonly ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = softClip(2.5);
    const sum = ctx.createGain();
    sum.gain.value = 0.5;
    // 点火の周波数の鋸波、その半分の矩形波（低いうなり）、2 倍の鋸波
    const kinds: OscillatorType[] = ['sawtooth', 'square', 'sawtooth'];
    const levels = [1, 0.45, 0.3];
    this.oscs = kinds.map((k) => { const o = ctx.createOscillator(); o.type = k; return o; });
    this.mix = levels.map((l) => { const g = ctx.createGain(); g.gain.value = l; return g; });
    this.oscs.forEach((o, i) => { o.connect(this.mix[i]); this.mix[i].connect(sum); o.start(); });
    this.oscs[2].detune.value = 7;
    // 燃焼のざらつき
    this.src = ctx.createBufferSource();
    this.src.buffer = noise;
    this.src.loop = true;
    this.roughFilter = ctx.createBiquadFilter();
    this.roughFilter.type = 'bandpass';
    this.roughFilter.Q.value = 1.2;
    this.rough = ctx.createGain();
    this.rough.gain.value = 0;
    this.src.connect(this.roughFilter).connect(this.rough).connect(sum);
    this.src.start();
    // 鼓動：音の大きさを点火の周期より遅い周期で揺らす（水平対向の「ドロドロ」、V8 の「ドドド」）
    this.am = ctx.createGain();
    this.am.gain.value = 1;
    this.pulse = ctx.createOscillator();
    this.pulse.type = 'sine';
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulse.connect(this.pulseGain).connect(this.am.gain);
    this.pulse.start();
    sum.connect(this.am).connect(this.shaper).connect(this.filter).connect(this.out).connect(this.pan).connect(dest);
  }

  set(v: Vehicle, gain: number, pan: number) {
    if (!this.ch || this.vehicle !== v) {
      this.vehicle = v;
      this.ch = character(v);
      this.shaper.curve = softClip(this.ch.drive);
    }
    const ch = this.ch, rpm = v.rpm, load = v.throttleOut;
    const t = this.ctx.currentTime, k = 0.03;
    const f = Math.max(18, ((rpm / 60) * ch.cylinders) / 2);
    this.oscs[0].frequency.setTargetAtTime(f, t, k);
    this.oscs[1].frequency.setTargetAtTime(f / 2, t, k);
    this.oscs[2].frequency.setTargetAtTime(f * 2, t, k);
    this.roughFilter.frequency.setTargetAtTime(f * 3, t, k);
    this.rough.gain.setTargetAtTime(0.15 + 0.5 * load, t, k);
    this.pulse.frequency.setTargetAtTime(f * ch.pulseRatio, t, k);
    // 鼓動は低い回転ほど目立つ
    const depth = ch.pulseDepth * (1 - Math.min(0.7, (rpm / v.p.engine.redlineRpm) * 0.7));
    this.am.gain.setTargetAtTime(1 - depth / 2, t, k);
    this.pulseGain.gain.setTargetAtTime(depth / 2, t, k);
    this.filter.frequency.setTargetAtTime((250 + rpm * 0.22 + load * 2600) * ch.bright, t, k);
    this.out.gain.setTargetAtTime(gain * ch.level * (0.35 + 0.65 * load), t, 0.05);
    this.pan.pan.setTargetAtTime(pan, t, 0.05);
  }

  silence() {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  stop() {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const end = this.ctx.currentTime + 0.4;
    for (const o of this.oscs) o.stop(end);
    this.pulse.stop(end);
    this.src.stop(end);
  }
}

/** 雑音をフィルターに通して鳴らし続ける音（タイヤの鳴き、砂利、風） */
class NoiseVoice {
  readonly gain: GainNode;
  readonly filters: BiquadFilterNode[];
  private readonly src: AudioBufferSourceNode;

  constructor(private readonly ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, filters: { type: BiquadFilterType; f: number; q: number }[]) {
    this.src = ctx.createBufferSource();
    this.src.buffer = noise;
    this.src.loop = true;
    this.src.playbackRate.value = 0.9 + Math.random() * 0.2;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    let node: AudioNode = this.src;
    this.filters = filters.map((d) => {
      const b = ctx.createBiquadFilter();
      b.type = d.type; b.frequency.value = d.f; b.Q.value = d.q;
      node.connect(b);
      node = b;
      return b;
    });
    node.connect(this.gain).connect(dest);
    this.src.start();
  }

  set(level: number, freq?: number) {
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(level, t, 0.05);
    if (freq !== undefined) this.filters[0].frequency.setTargetAtTime(freq, t, 0.05);
  }

  stop() {
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.src.stop(this.ctx.currentTime + 0.4);
  }
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** メニューの効果音の出口（レースの音とは別。レース中でなくても鳴る） */
  private uiBus: GainNode | null = null;
  private lastUi = 0;
  private noise: AudioBuffer | null = null;
  private engine: EngineVoice | null = null;
  private others: EngineVoice[] = [];
  private squeal: NoiseVoice | null = null;
  private squeal2: NoiseVoice | null = null;
  private crunch: NoiseVoice | null = null;
  private wind: NoiseVoice | null = null;
  private lastImpact = 0;
  private turbo: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private boost = 0;
  private lastThrottle = 0;
  private lastBlowoff = 0;
  private nextPop = 0;
  volume = 0.7;
  muted = false;
  /** 実況が話している間、レースの音を下げる（1 はそのまま） */
  duck = 1;
  private ducking = false;

  /** タップやクリックの処理の中で呼ぶ（ブラウザは利用者の操作なしに音を出させない） */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
        this.uiBus = this.ctx.createGain();
        this.uiBus.connect(comp);
        this.noise = noiseBuffer(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  get running() { return this.ctx?.state === 'running'; }

  /**
   * メニューの効果音（音の素材は使わず、その場で作る）。
   * hover はボタンに乗ったとき、move は一覧で選ぶとき、tab は種類の切り替え、select は決定、back は戻る、start は走り出す
   */
  ui(kind: 'hover' | 'move' | 'tab' | 'select' | 'back' | 'start') {
    const ctx = this.ctx, bus = this.uiBus, nz = this.noise;
    if (!ctx || !bus || !nz || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    // 続けて鳴らしすぎない（キーを押し続けたとき）
    if (kind === 'hover' && t - this.lastUi < 0.06) return;
    this.lastUi = t;
    bus.gain.value = this.volume;
    const tone = (type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak: number, lp = 6000) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + at);
      o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      f.type = 'lowpass'; f.frequency.value = lp;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(peak, t + at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(f).connect(g).connect(bus);
      o.start(t + at); o.stop(t + at + dur + 0.02);
    };
    const whoosh = (at: number, dur: number, f0: number, f1: number, peak: number) => {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = nz;
      f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(f0, t + at);
      f.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(peak, t + at + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      src.connect(f).connect(g).connect(bus);
      src.start(t + at, Math.random()); src.stop(t + at + dur + 0.02);
    };
    if (kind === 'hover') tone('sine', 2400, 2000, 0, 0.03, 0.025);
    else if (kind === 'move') { tone('triangle', 1500, 1150, 0, 0.05, 0.08); whoosh(0, 0.06, 3000, 5000, 0.03); }
    else if (kind === 'tab') { tone('square', 700, 700, 0, 0.04, 0.035, 2500); tone('square', 1050, 1050, 0.045, 0.06, 0.035, 2500); }
    else if (kind === 'select') { tone('triangle', 880, 880, 0, 0.09, 0.12); tone('triangle', 1320, 1320, 0.06, 0.16, 0.1); whoosh(0, 0.18, 1200, 4000, 0.05); }
    else if (kind === 'back') { tone('triangle', 900, 520, 0, 0.12, 0.1); whoosh(0, 0.12, 3000, 900, 0.03); }
    else if (kind === 'start') {
      // 吹け上がるうなりと、上がっていく風の音、最後に明るい和音
      tone('sawtooth', 70, 210, 0, 0.55, 0.12, 900);
      tone('sawtooth', 105, 315, 0, 0.55, 0.06, 1400);
      whoosh(0, 0.6, 400, 6000, 0.14);
      for (const [f, d] of [[440, 0], [554, 0.02], [659, 0.04], [880, 0.06]] as const) tone('triangle', f, f, 0.45 + d, 0.7, 0.07, 5000);
    }
  }

  start(s: Session) {
    this.stop();
    const ctx = this.ctx, m = this.master, nz = this.noise;
    if (!ctx || !m || !nz) return;
    this.engine = new EngineVoice(ctx, m, nz);
    // ターボの高い音（過給が上がるほど高く大きく）
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(m);
    this.turbo.start();
    this.boost = 0;
    this.others = s.racers.length > 1 ? [0, 1, 2].map(() => new EngineVoice(ctx, m, nz)) : [];
    this.squeal = new NoiseVoice(ctx, m, nz, [{ type: 'bandpass', f: 950, q: 9 }, { type: 'peaking', f: 1900, q: 4 }]);
    this.squeal2 = new NoiseVoice(ctx, m, nz, [{ type: 'bandpass', f: 1400, q: 12 }]);
    this.crunch = new NoiseVoice(ctx, m, nz, [{ type: 'lowpass', f: 700, q: 0.7 }, { type: 'highpass', f: 90, q: 0.7 }]);
    this.wind = new NoiseVoice(ctx, m, nz, [{ type: 'lowpass', f: 500, q: 0.5 }, { type: 'highpass', f: 70, q: 0.5 }]);
  }

  stop() {
    this.engine?.stop();
    if (this.turbo && this.ctx) { this.turboGain!.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); this.turbo.stop(this.ctx.currentTime + 0.3); }
    this.turbo = null; this.turboGain = null;
    for (const o of this.others) o.stop();
    this.squeal?.stop(); this.squeal2?.stop(); this.crunch?.stop(); this.wind?.stop();
    this.engine = null; this.others = []; this.squeal = null; this.squeal2 = null; this.crunch = null; this.wind = null;
  }

  /** 毎フレーム呼ぶ */
  update(s: Session | null, cockpit: boolean) {
    const ctx = this.ctx, m = this.master;
    if (!ctx || !m) return;
    const on = s && !s.paused && !this.muted;
    // 下げるときは速く（0.08 秒）、戻すときはゆっくり（0.35 秒）
    const down = this.duck < 1;
    m.gain.setTargetAtTime(on ? this.volume * this.duck : 0, ctx.currentTime, down || !this.ducking ? 0.08 : 0.35);
    this.ducking = down;
    if (!s || !this.engine) return;
    const me = s.player?.vehicle;
    if (!me) return;

    this.engine.set(me, cockpit ? 0.55 : 0.45, 0);
    this.updateTurboAndPops(me, ctx.currentTime);

    // 近い 3 台のエンジンを左右に振って鳴らす
    const near = s.racers.filter((r) => r.vehicle !== me)
      .map((r) => ({ v: r.vehicle, d: r.vehicle.pos.distanceTo(me.pos) }))
      .filter((x) => x.d < 90).sort((a, b) => a.d - b.d).slice(0, this.others.length);
    this.others.forEach((voice, i) => {
      const n = near[i];
      if (!n) { voice.silence(); return; }
      const rel = n.v.pos.clone().sub(me.pos);
      const pan = Math.max(-0.85, Math.min(0.85, rel.dot(me.right) / Math.max(4, n.d)));
      voice.set(n.v, 0.35 / (1 + n.d / 7), pan);
    });

    // タイヤ：舗装では鳴き、未舗装では砂利を踏む音
    let slipHard = 0, loose = 0;
    for (const w of me.wheels) {
      if (!w.contact) continue;
      if (LOOSE.has(w.surface.id)) loose = Math.max(loose, 1);
      else slipHard = Math.max(slipHard, w.slipSpeed);
    }
    const speed = Math.abs(me.speed);
    const sq = Math.max(0, Math.min(1, (slipHard - 1.3) / 6));
    this.squeal?.set(sq * 0.5, 850 + sq * 350);
    this.squeal2?.set(sq * sq * 0.25);
    const slipLoose = Math.max(...me.wheels.map((w) => (w.contact && LOOSE.has(w.surface.id) ? w.slipSpeed : 0)));
    this.crunch?.set(loose * Math.min(0.45, speed * 0.012 + slipLoose * 0.03), 400 + Math.min(2200, speed * 35));
    const wv = Math.min(1, (speed / 70) ** 2);
    this.wind?.set(wv * (cockpit ? 0.18 : 0.3), 300 + speed * 18);

    // 衝突
    const now = ctx.currentTime;
    const hits = s.pw.impacts.splice(0, s.pw.impacts.length);
    let best: (typeof hits)[number] | null = null, bestLevel = 0;
    for (const h of hits) {
      const d = Math.hypot(h.x - me.pos.x, h.y - me.pos.y, h.z - me.pos.z);
      const base = h.prop === 'cone' ? h.force / 3000 : h.prop === 'tire' ? h.force / 30000 : h.force / 150000;
      const level = Math.min(1, Math.sqrt(Math.max(0, base))) / (1 + d / 12);
      if (level > bestLevel) { bestLevel = level; best = h; }
    }
    if (best && bestLevel > 0.04 && now - this.lastImpact > 0.12) {
      this.lastImpact = now;
      const rel = me.pos.clone().set(best.x - me.pos.x, 0, best.z - me.pos.z);
      const pan = rel.lengthSq() > 1 ? Math.max(-0.8, Math.min(0.8, rel.dot(me.right) / rel.length())) : 0;
      this.impact(bestLevel, best.prop, pan);
    }
  }

  /** ターボの音、アクセルを戻したときの「プシュ」、排気がはじける音 */
  private updateTurboAndPops(v: Vehicle, now: number) {
    const e = v.p.engine, red = e.redlineRpm;
    const thr = v.throttleOut;
    if (e.turbo && this.turbo && this.turboGain) {
      const target = thr * Math.max(0, Math.min(1, (v.rpm - 0.3 * red) / (0.4 * red)));
      const tau = target > this.boost ? 0.6 : 0.15;
      this.boost += (target - this.boost) * Math.min(1, 1 / 60 / tau);
      this.turbo.frequency.setTargetAtTime(2400 + 4200 * this.boost, now, 0.05);
      this.turboGain.gain.setTargetAtTime(0.05 * this.boost * this.boost, now, 0.05);
      if (this.lastThrottle > 0.6 && thr < 0.15 && this.boost > 0.45 && now - this.lastBlowoff > 1) {
        this.lastBlowoff = now;
        this.burst(0.28 * this.boost, 0.35, 2600, 'bandpass', 1.4);
      }
    }
    // 排気音が「レース」の車は、高回転でアクセルを戻すと排気がはじける
    if (e.exhaust === 'race' && thr < 0.05 && v.rpm > 0.55 * red && v.shifting <= 0 && now > this.nextPop) {
      this.nextPop = now + 0.06 + Math.random() * 0.22;
      this.burst(0.35 + Math.random() * 0.3, 0.06, 900 + Math.random() * 600, 'lowpass', 0.8, true);
    }
    this.lastThrottle = thr;
  }

  private burst(level: number, dur: number, freq: number, type: BiquadFilterType, q: number, thump = false) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5, dur + 0.05);
    if (thump) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
      const og = ctx.createGain();
      og.gain.setValueAtTime(level * 0.8, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(og).connect(this.master!);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  private impact(level: number, prop: string | null, pan: number) {
    const ctx = this.ctx!, nz = this.noise!, m = this.master!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = nz;
    src.playbackRate.value = prop === 'cone' ? 1.6 : 0.8 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = prop === 'cone' ? 2600 : prop === 'tire' ? 500 : 350 + 1600 * level;
    const g = ctx.createGain();
    const dur = prop === 'cone' ? 0.12 : 0.18 + 0.3 * level;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(m);
    src.start(t, Math.random() * 1.5, dur + 0.05);
    // 重い衝突には低い「どん」
    if (prop !== 'cone' && level > 0.25) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.8 * level, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(og).connect(p);
      o.start(t);
      o.stop(t + 0.32);
    }
  }
}
