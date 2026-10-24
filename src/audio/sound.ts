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

class EngineVoice {
  readonly out: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly oscs: OscillatorNode[];
  private readonly mix: GainNode[];
  private readonly rough: GainNode;
  private readonly roughFilter: BiquadFilterNode;
  private readonly filter: BiquadFilterNode;
  private readonly src: AudioBufferSourceNode;
  vehicle: Vehicle | null = null;

  constructor(private readonly ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.5);
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
    sum.connect(shaper).connect(this.filter).connect(this.out).connect(this.pan).connect(dest);
  }

  set(rpm: number, load: number, cylinders: number, gain: number, pan: number) {
    const t = this.ctx.currentTime, k = 0.03;
    const f = Math.max(18, ((rpm / 60) * cylinders) / 2);
    this.oscs[0].frequency.setTargetAtTime(f, t, k);
    this.oscs[1].frequency.setTargetAtTime(f / 2, t, k);
    this.oscs[2].frequency.setTargetAtTime(f * 2, t, k);
    this.roughFilter.frequency.setTargetAtTime(f * 3, t, k);
    this.rough.gain.setTargetAtTime(0.15 + 0.5 * load, t, k);
    this.filter.frequency.setTargetAtTime(250 + rpm * 0.22 + load * 2600, t, k);
    this.out.gain.setTargetAtTime(gain * (0.35 + 0.65 * load), t, 0.05);
    this.pan.pan.setTargetAtTime(pan, t, 0.05);
  }

  stop() {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const end = this.ctx.currentTime + 0.4;
    for (const o of this.oscs) o.stop(end);
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
  private noise: AudioBuffer | null = null;
  private engine: EngineVoice | null = null;
  private others: EngineVoice[] = [];
  private squeal: NoiseVoice | null = null;
  private squeal2: NoiseVoice | null = null;
  private crunch: NoiseVoice | null = null;
  private wind: NoiseVoice | null = null;
  private lastImpact = 0;
  volume = 0.7;
  muted = false;

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
        this.noise = noiseBuffer(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  get running() { return this.ctx?.state === 'running'; }

  start(s: Session) {
    this.stop();
    const ctx = this.ctx, m = this.master, nz = this.noise;
    if (!ctx || !m || !nz) return;
    this.engine = new EngineVoice(ctx, m, nz);
    this.engine.vehicle = s.player?.vehicle ?? null;
    this.others = s.racers.length > 1 ? [0, 1, 2].map(() => new EngineVoice(ctx, m, nz)) : [];
    this.squeal = new NoiseVoice(ctx, m, nz, [{ type: 'bandpass', f: 950, q: 9 }, { type: 'peaking', f: 1900, q: 4 }]);
    this.squeal2 = new NoiseVoice(ctx, m, nz, [{ type: 'bandpass', f: 1400, q: 12 }]);
    this.crunch = new NoiseVoice(ctx, m, nz, [{ type: 'lowpass', f: 700, q: 0.7 }, { type: 'highpass', f: 90, q: 0.7 }]);
    this.wind = new NoiseVoice(ctx, m, nz, [{ type: 'lowpass', f: 500, q: 0.5 }, { type: 'highpass', f: 70, q: 0.5 }]);
  }

  stop() {
    this.engine?.stop();
    for (const o of this.others) o.stop();
    this.squeal?.stop(); this.squeal2?.stop(); this.crunch?.stop(); this.wind?.stop();
    this.engine = null; this.others = []; this.squeal = null; this.squeal2 = null; this.crunch = null; this.wind = null;
  }

  /** 毎フレーム呼ぶ */
  update(s: Session | null, cockpit: boolean) {
    const ctx = this.ctx, m = this.master;
    if (!ctx || !m) return;
    const on = s && !s.paused && !this.muted;
    m.gain.setTargetAtTime(on ? this.volume : 0, ctx.currentTime, 0.08);
    if (!s || !this.engine) return;
    const me = s.player?.vehicle;
    if (!me) return;

    this.engine.set(me.rpm, me.throttleOut, me.p.engine.cylinders || 4, cockpit ? 0.55 : 0.45, 0);

    // 近い 3 台のエンジンを左右に振って鳴らす
    const near = s.racers.filter((r) => r.vehicle !== me)
      .map((r) => ({ v: r.vehicle, d: r.vehicle.pos.distanceTo(me.pos) }))
      .filter((x) => x.d < 90).sort((a, b) => a.d - b.d).slice(0, this.others.length);
    this.others.forEach((voice, i) => {
      const n = near[i];
      if (!n) { voice.set(800, 0, 4, 0, 0); return; }
      const rel = n.v.pos.clone().sub(me.pos);
      const pan = Math.max(-0.85, Math.min(0.85, rel.dot(me.right) / Math.max(4, n.d)));
      voice.set(n.v.rpm, n.v.throttleOut, n.v.p.engine.cylinders || 4, 0.35 / (1 + n.d / 7), pan);
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
