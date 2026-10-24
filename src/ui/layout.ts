// スマホでは横向きで表示する。縦向きのままのときは画面全体を 90° 回して横向きに描く
// （iPhone の Safari は画面の向きを固定できないため）。

export const isTouch = (() => {
  try {
    // 画面に触れるノートパソコン（マウスもある）はスマホ扱いしない
    return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && !matchMedia('(any-pointer: fine)').matches);
  } catch {
    return false;
  }
})();

let forced = false;
const listeners: (() => void)[] = [];

/** 画面を回しているか */
export function isForcedLandscape() { return forced; }

/** ゲームが使う幅と高さ（回しているときは入れ替える） */
export function viewSize() {
  const w = window.innerWidth, h = window.innerHeight;
  return forced ? { w: h, h: w } : { w, h };
}

/** 画面の座標（clientX、clientY）を、ゲームの画面の座標に直す（回しているときは 90° 戻す） */
export function toView(cx: number, cy: number): [number, number] {
  return forced ? [cy, window.innerWidth - cx] : [cx, cy];
}

export function onLayoutChange(f: () => void) { listeners.push(f); }

function apply() {
  const portrait = window.innerHeight > window.innerWidth;
  const next = isTouch && portrait;
  if (next !== forced) {
    forced = next;
    document.body.classList.toggle('forced-landscape', forced);
  }
  for (const f of listeners) f();
}

export function initLayout() {
  if (isTouch) document.body.classList.add('touch');
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 200));
}

/** タップの処理の中で呼ぶ。全画面にして横向きに固定する（できる端末だけ） */
export function requestLandscape() {
  if (!isTouch) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const lock = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {});
  };
  try {
    if (document.fullscreenElement) { lock(); return; }
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    // 全画面にできない端末では、縦向きなら画面を回して表示する
  }
}
