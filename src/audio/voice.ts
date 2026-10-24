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

export type VoiceMode = 'all' | 'menu' | 'off';

export class Voice {
  private voice: SpeechSynthesisVoice | null = null;
  private current = -1;
  private queued: { text: string; priority: number } | null = null;
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
    const pick = () => { this.voice = pickVoice(synth.getVoices()); };
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

  /** 読み上げを止める（一時停止、レースを抜けたとき） */
  stop() {
    this.queued = null;
    this.current = -1;
    this.speakingFlag = false;
    this.seq++;
    try { this.synth?.cancel(); } catch { /* 止められなくても困らない */ }
  }

  private speak(text: string, priority: number, isMenu: boolean) {
    const synth = this.synth;
    if (!synth || this.muted || this.volume <= 0) return;
    const busy = synth.speaking || synth.pending;
    if (busy && this.current >= 0) {
      if (isMenu || priority > this.current) {
        synth.cancel();
      } else {
        // 同じくらいの大事さなら、次に 1 つだけ待たせる
        if (priority >= 2 && (!this.queued || priority >= this.queued.priority)) this.queued = { text, priority };
        return;
      }
    }
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'en-GB';
    // 実況は少し速く、大事な所ほど高く勢いよく
    u.rate = isMenu ? 1.05 : priority >= 3 ? 1.18 : 1.12;
    u.pitch = isMenu ? 1 : priority >= 3 ? 1.15 : 1.05;
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
      if (q) this.speak(q.text, q.priority, false);
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
