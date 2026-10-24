// 車の詳細設定の画面。項目は FIELDS の定義から作る。
import type { CarParams, FieldDef } from '../sim/params';
import { FIELDS, computeDerived, engineTorque, getPath, setPath } from '../sim/params';

function decimals(step = 1) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function parseCurve(text: string): [number, number][] | null {
  const pairs = text.split(/[,\n、]+/).map((t) => t.trim()).filter(Boolean);
  const out: [number, number][] = [];
  for (const p of pairs) {
    const m = p.match(/^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    out.push([Number(m[1]), Number(m[2])]);
  }
  for (let i = 1; i < out.length; i++) if (out[i][0] <= out[i - 1][0]) return null;
  return out.length >= 2 ? out : null;
}

function parseList(text: string): number[] | null {
  const v = text.split(/[,\s、]+/).filter(Boolean).map(Number);
  return v.length > 0 && v.every((x) => isFinite(x) && x > 0) ? v : null;
}

function fieldInput(f: FieldDef, p: CarParams, changed: () => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'field';
  const name = document.createElement('span');
  name.className = 'field-name';
  name.textContent = f.label;
  row.appendChild(name);
  const value = getPath(p, f.path);
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const set = (v: unknown) => { setPath(p, f.path, v); changed(); };
  switch (f.kind) {
    case 'number': {
      const el = document.createElement('input');
      el.type = 'number';
      const k = f.scale ?? 1;
      el.step = String((f.step ?? 1) * k);
      if (f.min !== undefined) el.min = String(f.min * k);
      if (f.max !== undefined) el.max = String(f.max * k);
      el.value = ((value as number) * k).toFixed(decimals((f.step ?? 1) * k));
      el.addEventListener('input', () => {
        const x = Number(el.value);
        const ok = el.value !== '' && isFinite(x) && (f.min === undefined || x >= f.min * k) && (f.max === undefined || x <= f.max * k);
        el.classList.toggle('bad', !ok);
        if (ok) set(x / k);
      });
      input = el;
      break;
    }
    case 'select': {
      const el = document.createElement('select');
      for (const o of f.options ?? []) {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        el.appendChild(opt);
      }
      el.value = String(value);
      el.addEventListener('change', () => set(el.value));
      input = el;
      break;
    }
    case 'bool': {
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = Boolean(value);
      el.addEventListener('change', () => set(el.checked));
      input = el;
      break;
    }
    case 'color': {
      const el = document.createElement('input');
      el.type = 'color';
      el.value = String(value);
      el.addEventListener('input', () => set(el.value));
      input = el;
      break;
    }
    case 'curve': {
      const el = document.createElement('textarea');
      el.rows = 3;
      el.value = (value as [number, number][]).map(([r, t]) => `${r}:${t}`).join(', ');
      el.addEventListener('input', () => {
        const c = parseCurve(el.value);
        el.classList.toggle('bad', !c);
        if (c) set(c);
      });
      input = el;
      row.classList.add('wide');
      break;
    }
    case 'list': {
      const el = document.createElement('input');
      el.type = 'text';
      el.value = (value as number[]).join(', ');
      el.addEventListener('input', () => {
        const c = parseList(el.value);
        el.classList.toggle('bad', !c);
        if (c) set(c);
      });
      input = el;
      row.classList.add('wide');
      break;
    }
    default: {
      const el = document.createElement('input');
      el.type = 'text';
      el.value = String(value);
      el.addEventListener('input', () => set(el.value));
      input = el;
    }
  }
  row.appendChild(input);
  if (f.unit) {
    const u = document.createElement('span');
    u.className = 'field-unit';
    u.textContent = f.unit;
    row.appendChild(u);
  }
  return row;
}

/** 設定の欄を作る。値を変えるたびに onChange を呼ぶ */
export function buildSettingsForm(container: HTMLElement, p: CarParams, onChange: () => void) {
  container.innerHTML = '';
  const groups = new Map<string, FieldDef[]>();
  for (const f of FIELDS) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group)!.push(f);
  }
  let first = true;
  for (const [name, fields] of groups) {
    const d = document.createElement('details');
    d.open = first;
    first = false;
    const s = document.createElement('summary');
    s.textContent = name;
    d.appendChild(s);
    const grid = document.createElement('div');
    grid.className = 'fields';
    for (const f of fields) grid.appendChild(fieldInput(f, p, onChange));
    d.appendChild(grid);
    container.appendChild(d);
  }
}

/** 入力値から出る目安と注意 */
export function renderDerived(el: HTMLElement, p: CarParams) {
  const d = computeDerived(p);
  const ps = d.peakPowerKW * 1.3596;
  el.innerHTML = `
    <table class="derived">
      <tr><th>最高出力</th><td>${d.peakPowerKW.toFixed(0)} kW（${ps.toFixed(0)} PS）／ ${d.peakPowerRpm.toFixed(0)} rpm</td></tr>
      <tr><th>最大トルク</th><td>${d.peakTorque.toFixed(0)} N·m ／ ${d.peakTorqueRpm.toFixed(0)} rpm</td></tr>
      <tr><th>出力重量比</th><td>${d.powerToWeight.toFixed(0)} kW/t</td></tr>
      <tr><th>最高速の見込み</th><td>${d.topSpeedKmh.toFixed(0)} km/h</td></tr>
      <tr><th>サスの固有振動数</th><td>前 ${d.freqFront.toFixed(2)} Hz、後 ${d.freqRear.toFixed(2)} Hz</td></tr>
      <tr><th>静止時の沈み込み</th><td>前 ${(d.sagFront * 1000).toFixed(0)} mm、後 ${(d.sagRear * 1000).toFixed(0)} mm</td></tr>
      <tr><th>ハンドルの回転</th><td>端から端まで ${d.lockToLock.toFixed(1)} 回転</td></tr>
      <tr><th>横転のしにくさ</th><td>${d.stabilityFactor.toFixed(2)}（トレッド ÷ 重心高の 2 倍。1.1 未満は横転しやすい）</td></tr>
    </table>
    ${d.warnings.length ? `<ul class="warnings">${d.warnings.map((w) => `<li>${w}</li>`).join('')}</ul>` : ''}
    <canvas class="torque-chart" width="560" height="120"></canvas>`;
  const cv = el.querySelector('canvas')!;
  const g = cv.getContext('2d')!;
  const W = cv.width, H = cv.height, pad = 30;
  const rmax = p.engine.redlineRpm * 1.05;
  let tmax = 1, pmax = 1;
  for (let r = 500; r <= rmax; r += 50) {
    tmax = Math.max(tmax, engineTorque(p, r));
    pmax = Math.max(pmax, (engineTorque(p, r) * r * 2 * Math.PI) / 60000);
  }
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(pad, 6); g.lineTo(pad, H - pad); g.lineTo(W - 6, H - pad); g.stroke();
  const x = (r: number) => pad + ((W - pad - 6) * r) / rmax;
  const curve = (f: (r: number) => number, max: number, color: string) => {
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    for (let r = 500; r <= rmax; r += 50) {
      const y = H - pad - ((H - pad - 8) * f(r)) / max;
      if (r === 500) g.moveTo(x(r), y); else g.lineTo(x(r), y);
    }
    g.stroke();
  };
  curve((r) => engineTorque(p, r), tmax, '#5ab0ff');
  curve((r) => (engineTorque(p, r) * r * 2 * Math.PI) / 60000, pmax, '#ffb347');
  g.strokeStyle = 'rgba(255,80,80,0.8)';
  g.beginPath(); g.moveTo(x(p.engine.redlineRpm), 6); g.lineTo(x(p.engine.redlineRpm), H - pad); g.stroke();
  g.fillStyle = '#ccc'; g.font = '12px sans-serif';
  g.fillText(`トルク（最大 ${tmax.toFixed(0)} N·m）`, pad + 8, 18);
  g.fillStyle = '#ffb347'; g.fillText(`出力（最大 ${pmax.toFixed(0)} kW）`, pad + 8, 34);
  g.fillStyle = '#999'; g.fillText(`${Math.round(rmax / 1000)}000 rpm`, W - 70, H - 10);
}
