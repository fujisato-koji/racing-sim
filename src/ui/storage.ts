// 自作の車の保存。ブラウザ内（使えないときは保存しないだけ）と、JSON ファイルの書き出しと読み込み。
import type { CarParams } from '../sim/params';
import { cloneParams } from '../sim/params';
import { CAR_PRESETS } from '../sim/presets';

const KEY = 'racing-sim.cars.v1';

export function loadCustomCars(): CarParams[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown[];
    return list.map((x) => normalize(x));
  } catch {
    return [];
  }
}

export function saveCustomCars(list: CarParams[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** 足りない項目は基準車の値で埋める（古い版で書き出したファイルも読めるように） */
export function normalize(x: unknown): CarParams {
  const base = cloneParams(CAR_PRESETS[1]);
  const merge = (a: Record<string, unknown>, b: unknown) => {
    if (!b || typeof b !== 'object') return;
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      if (!(k in a)) continue;
      const cur = a[k];
      if (Array.isArray(cur)) { if (Array.isArray(v)) a[k] = v; }
      else if (cur && typeof cur === 'object') merge(cur as Record<string, unknown>, v);
      else if (typeof v === typeof cur) a[k] = v;
    }
  };
  merge(base as unknown as Record<string, unknown>, x);
  return base;
}

export function exportCar(p: CarParams) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replace(/[\\/:*?"<>|\s]+/g, '_') || 'car'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importCar(): Promise<CarParams | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        resolve(normalize(JSON.parse(await f.text())));
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
