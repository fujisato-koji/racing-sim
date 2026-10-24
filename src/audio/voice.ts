// 読み上げ（ブラウザの音声合成）。メニューの読み上げと、レースの実況に使う。
// 声は端末に入っている英語の声から選ぶ（イギリス英語の男性の声を優先）。ブラウザによっては、その会社の音声合成のサービスで読む声がある。
// 優先度：0 メニュー、1 ふつうの実況、2 順位や周回、3 ファイナルラップ、4 ゴール。読んでいる途中に高い優先度が来たら切り替える。

/** よく合う声の名前（先にあるほど優先） */
const PREFERRED = [
  /Microsoft (Ryan|Thomas|Brian|Andrew|Guy|Christopher|Eric).*Natural/i,
  /Google UK English Male/i,
  /Daniel/i,
  /Microsoft (George|Ryan)/i,
  /Google US English/i,
  /Microsoft (Aria|Jenny|Sonia|Libby).*Natural/i,
  /Alex\b/i,
  /Samantha/i,
];

/** 副操縦士の声（実況の声とは別の声を選ぶ。女性の声を優先） */
const PREFERRED2 = [
  /Microsoft (Aria|Jenny|Sonia|Libby|Ava|Emma|Natasha).*Natural/i,
  /Google US English/i,
  /Google UK English Female/i,
  /Samantha|Karen|Moira|Serena|Tessa|Zira|Hazel|Susan/i,
];

export type VoiceMode = 'all' | 'menu' | 'off';

export class Voice {
  private voice: SpeechSynthesisVoice | null = null;
  private voice2: SpeechSynthesisVoice | null = null;
  /** 副操縦士の声を出すか */
  codriverOn = true;
  private current = -1;
  private queued: { text: string; priority: number; second?: boolean } | null = null;
  mode: VoiceMode = 'all';
  private speakingFlag = false;
  /** いま読んでいる文の番号（止めた前の文の終わりの知らせを無視するため） */
  private seq = 0;

  /** 読んでいる最中か（その間、エンジンなどの音を下げる）。ブラウザが読んでいないと言えば読んでいない扱い */
  get talking() {
    const synth = this.synth;
    return this.speakingFlag && !!synth && (synth.speaking || synth.pending);
  }
  volume = 0.7;
  muted = false;

  constructor() {
    const synth = this.synth;
    if (!synth) return;
    const pick = () => {
      const list = synth.getVoices();
      this.voice = pickVoice(list);
      const en = list.filter((v) => /^en([-_]|$)/i.test(v.lang) && v !== this.voice);
      this.voice2 = null;
      for (const re of PREFERRED2) { const v = en.find((x) => re.test(x.name)); if (v) { this.voice2 = v; break; } }
      this.voice2 ??= en[0] ?? null;
    };
    pick();
    synth.addEventListener?.('voiceschanged', pick);
  }

  private get synth(): SpeechSynthesis | null {
    try { return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null; } catch { return null; }
  }

  /** いま使う声の名前（設定の画面に出す） */
  get voiceName() { return this.voice?.name ?? ''; }

  /** メニューの読み上げ。前のメニューの読み上げは止めて、新しいものだけを読む */
  menu(text: string) {
    if (this.mode === 'off') return;
    this.speak(text, 0, true);
  }

  /** 実況。優先度の低いものは、読んでいる途中なら捨てる */
  call(text: string, priority: number) {
    if (this.mode !== 'all') return;
    this.speak(text, priority, false);
  }

  /** 副操縦士。この先の曲がりとブレーキ。実況より優先する */
  codriver(text: string, priority: number) {
    if (this.mode === 'off' || !this.codriverOn) return;
    this.speak(text, priority, false, true);
  }

  /** 読み上げを止める（一時停止、レースを抜けたとき） */
  stop() {
    this.queued = null;
    this.current = -1;
    this.speakingFlag = false;
    this.seq++;
    try { this.synth?.cancel(); } catch { /* 止められなくても困らない */ }
  }

  private speak(text: string, priority: number, isMenu: boolean, second = false) {
    const synth = this.synth;
    if (!synth || this.muted || this.volume <= 0) return;
    const busy = synth.speaking || synth.pending;
    if (busy && this.current >= 0) {
      if (isMenu || priority > this.current) {
        synth.cancel();
      } else {
        // 同じくらいの大事さなら、次に 1 つだけ待たせる
        if (priority >= 2 && (!this.queued || priority >= this.queued.priority)) this.queued = { text, priority, second };
        return;
      }
    }
    const u = new SpeechSynthesisUtterance(text);
    const vo = second ? this.voice2 ?? this.voice : this.voice;
    if (vo) { u.voice = vo; u.lang = vo.lang; } else u.lang = 'en-GB';
    // 実況は少し速く、大事な所ほど高く勢いよく。副操縦士は速く平らに（別の声が無ければ高さで分ける）
    u.rate = second ? 1.25 : isMenu ? 1.05 : priority >= 3 ? 1.18 : 1.12;
    u.pitch = second ? (this.voice2 ? 1 : 1.35) : isMenu ? 1 : priority >= 3 ? 1.15 : 1.05;
    // 声は音量の設定が標準（0.7）のとき最大。それより上げても声はこれ以上大きくならないので、ゲームの音を下げて釣り合わせる
    u.volume = Math.min(1, this.volume / 0.7);
    this.current = priority;
    this.speakingFlag = true;
    const id = ++this.seq;
    u.onend = () => {
      if (id !== this.seq) return;
      this.current = -1;
      this.speakingFlag = false;
      const q = this.queued;
      this.queued = null;
      if (q) this.speak(q.text, q.priority, false, q.second);
    };
    u.onerror = () => { if (id === this.seq) { this.current = -1; this.speakingFlag = false; } };
    try { synth.speak(u); } catch { this.current = -1; this.speakingFlag = false; }
  }
}

export function pickVoice(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = list.filter((v) => /^en([-_]|$)/i.test(v.lang));
  for (const re of PREFERRED) {
    const v = en.find((x) => re.test(x.name));
    if (v) return v;
  }
  return en.find((v) => /en[-_]GB/i.test(v.lang)) ?? en.find((v) => /en[-_]US/i.test(v.lang)) ?? en[0] ?? null;
}
