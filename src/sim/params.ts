// 車の諸元。単位は SI（m、kg、N、s）。角度だけは入力しやすいように度で持つ。
export type DriveLayout = 'FF' | 'FR' | 'MR' | 'RR' | '4WD';
export type DiffType = 'open' | 'lsd' | 'locked';

export interface DiffParams {
  type: DiffType;
  /** 初期締結トルク [N·m] */
  preload: number;
  /** 入力トルクに比例する締結の割合 0〜1 */
  lock: number;
}

export interface AxleParams {
  /** トレッド [m] */
  track: number;
  /** タイヤ半径 [m] */
  tireRadius: number;
  /** タイヤ幅 [m] */
  tireWidth: number;
  /** タイヤとホイール1本の質量 [kg] */
  wheelMass: number;
  /** ばね定数（輪上換算） [N/m] */
  spring: number;
  /** 減衰（縮み側） [N·s/m] */
  damperBump: number;
  /** 減衰（伸び側） [N·s/m] */
  damperRebound: number;
  /** ストローク [m] */
  travel: number;
  /** スタビライザー（輪上換算） [N/m] */
  antiRoll: number;
  /** ロールセンター高 [m] */
  rollCenter: number;
  /** 1輪あたりの最大制動トルク [N·m] */
  brakeTorque: number;
}

export interface CarParams {
  id: string;
  name: string;
  color: string;
  body: {
    length: number;
    width: number;
    height: number;
    groundClearance: number;
    frontOverhang: number;
    /** 窓の始まり（前端からの長さの割合） */
    cabinFront: number;
    /** 窓の終わり（前端からの長さの割合） */
    cabinRear: number;
    /** 窓の下端（全高に対する割合） */
    beltLine: number;
    mass: number;
    /** 前軸の荷重の割合 0〜1 */
    weightFront: number;
    cgHeight: number;
    /** 慣性モーメントの倍率（箱で近似した値に掛ける） */
    inertiaScale: number;
    driverSide: 'right' | 'left';
  };
  wheelbase: number;
  front: AxleParams;
  rear: AxleParams;
  tire: {
    mu: number;
    peakSlip: number;
    peakAngleDeg: number;
    /** 滑り切ったときの摩擦と最大摩擦の比 */
    slide: number;
    /** 最大摩擦を過ぎてから落ちるまでの幅（最大摩擦の滑りに対する倍率） */
    falloff: number;
    loadSensitivity: number;
    /** 横方向の緩和長 [m]（前後方向はこの半分） */
    relaxLength: number;
  };
  steer: {
    maxAngleDeg: number;
    /** アッカーマン率 0〜1 */
    ackermann: number;
    /** ステアリングギア比（ハンドルの回転角 ÷ タイヤの切れ角） */
    ratio: number;
  };
  engine: {
    /** [回転数 rpm, トルク N·m] の並び */
    torqueCurve: [number, number][];
    idleRpm: number;
    redlineRpm: number;
    inertia: number;
    /** レブリミット付近のエンジンブレーキ [N·m] */
    engineBrake: number;
    orientation: 'longitudinal' | 'transverse';
    /** 気筒数（エンジン音の高さに使う） */
    cylinders: number;
    /** 気筒の並び（エンジン音の鼓動に使う） */
    layout: 'inline' | 'v' | 'flat';
    /** ターボ（過給の音に使う） */
    turbo: boolean;
    /** 排気音の性格 */
    exhaust: 'quiet' | 'sport' | 'race';
  };
  gearbox: {
    ratios: number[];
    reverse: number;
    finalDrive: number;
    efficiency: number;
    shiftTime: number;
  };
  drive: {
    layout: DriveLayout;
    frontDiff: DiffParams;
    rearDiff: DiffParams;
    centerDiff: DiffParams;
    /** 4WD の前輪へのトルク配分 0〜1 */
    frontShare: number;
  };
  aero: {
    cd: number;
    frontalArea: number;
    /** ダウンフォース係数（前、正が下向き） */
    clFront: number;
    clRear: number;
    /** 空力中心の重心からの前後位置 [m]（前が正） */
    centerOffset: number;
  };
  assists: {
    abs: boolean;
    tcs: boolean;
    /** 横滑り防止 */
    esc: boolean;
    steerAssist: boolean;
  };
}

export const G = 9.81;
export const RHO = 1.225;
export const DEG = Math.PI / 180;

export function cloneParams(p: CarParams): CarParams {
  return JSON.parse(JSON.stringify(p)) as CarParams;
}

export function drivenAxles(layout: DriveLayout): { front: boolean; rear: boolean } {
  return { front: layout === 'FF' || layout === '4WD', rear: layout !== 'FF' };
}

// ---------------------------------------------------------------- 幾何
/** 重心を原点とした車体座標（右 +x、上 +y、前 -z）での各部の位置 */
export interface CarGeometry {
  /** 重心から前軸までの距離 */
  a: number;
  /** 重心から後軸までの距離 */
  b: number;
  frontAxleZ: number;
  rearAxleZ: number;
  groundY: number;
  bodyFrontZ: number;
  bodyRearZ: number;
  bodyBottomY: number;
  bodyTopY: number;
  beltY: number;
  cabinFrontZ: number;
  cabinRearZ: number;
  eye: [number, number, number];
  inertia: [number, number, number];
}

export function carGeometry(p: CarParams): CarGeometry {
  const a = p.wheelbase * (1 - p.body.weightFront);
  const b = p.wheelbase - a;
  const frontAxleZ = -a;
  const rearAxleZ = b;
  const groundY = -p.body.cgHeight;
  const bodyFrontZ = frontAxleZ - p.body.frontOverhang;
  const bodyRearZ = bodyFrontZ + p.body.length;
  const bodyBottomY = groundY + p.body.groundClearance;
  const bodyTopY = groundY + p.body.height;
  const beltY = groundY + p.body.height * p.body.beltLine;
  const cabinFrontZ = bodyFrontZ + p.body.length * p.body.cabinFront;
  const cabinRearZ = bodyFrontZ + p.body.length * p.body.cabinRear;
  const side = p.body.driverSide === 'right' ? 1 : -1;
  const eyeZ = cabinFrontZ + (cabinRearZ - cabinFrontZ) * 0.42;
  const eyeY = beltY + (bodyTopY - beltY) * 0.62;
  const eye: [number, number, number] = [side * p.body.width * 0.2, eyeY, eyeZ];
  // 箱で近似。質量は中心に寄っているので 0.85 を掛ける
  const m = p.body.mass, L = p.body.length, W = p.body.width, H = p.body.height * 0.8;
  const k = 0.85 * p.body.inertiaScale;
  const inertia: [number, number, number] = [
    (k * m * (H * H + L * L)) / 12, // ピッチ（x 軸まわり）
    (k * m * (W * W + L * L)) / 12, // ヨー（y 軸まわり）
    (k * m * (W * W + H * H)) / 12, // ロール（z 軸まわり）
  ];
  return { a, b, frontAxleZ, rearAxleZ, groundY, bodyFrontZ, bodyRearZ, bodyBottomY, bodyTopY, beltY, cabinFrontZ, cabinRearZ, eye, inertia };
}

// ---------------------------------------------------------------- エンジン
export function engineTorque(p: CarParams, rpm: number): number {
  const c = p.engine.torqueCurve;
  if (c.length === 0) return 0;
  if (rpm <= c[0][0]) return c[0][1] * Math.max(0, rpm / c[0][0]);
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  // 表の外はレブリミットの 500 rpm 先で 0 に落とす
  const last = c[c.length - 1];
  const end = Math.max(p.engine.redlineRpm, last[0]) + 500;
  return Math.max(0, last[1] * (1 - (rpm - last[0]) / (end - last[0])));
}

export function peakValues(p: CarParams) {
  let peakTorque = 0, peakTorqueRpm = 0, peakPower = 0, peakPowerRpm = 0;
  for (let rpm = p.engine.idleRpm; rpm <= p.engine.redlineRpm; rpm += 25) {
    const t = engineTorque(p, rpm);
    const pw = (t * rpm * 2 * Math.PI) / 60;
    if (t > peakTorque) { peakTorque = t; peakTorqueRpm = rpm; }
    if (pw > peakPower) { peakPower = pw; peakPowerRpm = rpm; }
  }
  return { peakTorque, peakTorqueRpm, peakPower, peakPowerRpm };
}

// ---------------------------------------------------------------- 目安の計算
export interface Derived {
  frontCornerLoad: number;
  rearCornerLoad: number;
  sagFront: number;
  sagRear: number;
  freqFront: number;
  freqRear: number;
  peakTorque: number;
  peakTorqueRpm: number;
  peakPowerKW: number;
  peakPowerRpm: number;
  powerToWeight: number;
  topSpeedKmh: number;
  stabilityFactor: number;
  /** ハンドルを端から端まで回す回転数 */
  lockToLock: number;
  warnings: string[];
}

/** 平地のアスファルトで、駆動力と抵抗が釣り合う速さ [m/s] */
export function estimateTopSpeed(p: CarParams, rolling = 0.012): number {
  const pk = peakValues(p);
  const r = drivenAxles(p.drive.layout).rear ? p.rear.tireRadius : p.front.tireRadius;
  let top = 0;
  for (let v = 1; v < 150; v += 0.25) {
    let fDrive = 0;
    for (const g of p.gearbox.ratios) {
      const rpm = ((v / r) * g * p.gearbox.finalDrive * 60) / (2 * Math.PI);
      if (rpm > p.engine.redlineRpm) continue;
      const t = engineTorque(p, Math.max(rpm, pk.peakTorqueRpm * 0.5));
      fDrive = Math.max(fDrive, (t * g * p.gearbox.finalDrive * p.gearbox.efficiency) / r);
    }
    const q = 0.5 * RHO * v * v;
    const down = q * p.aero.frontalArea * (p.aero.clFront + p.aero.clRear);
    const fRes = q * p.aero.cd * p.aero.frontalArea + rolling * (p.body.mass * G + down);
    if (fDrive >= fRes) top = v;
    else if (top > 0) break;
  }
  return top;
}

export function computeDerived(p: CarParams): Derived {
  const w = p.body.mass * G;
  const frontCornerLoad = (w * p.body.weightFront) / 2;
  const rearCornerLoad = (w * (1 - p.body.weightFront)) / 2;
  const sagFront = frontCornerLoad / p.front.spring;
  const sagRear = rearCornerLoad / p.rear.spring;
  const freq = (k: number, load: number) => Math.sqrt(k / (load / G)) / (2 * Math.PI);
  const pk = peakValues(p);
  const stabilityFactor = Math.min(p.front.track, p.rear.track) / (2 * p.body.cgHeight);
  const warnings: string[] = [];
  if (sagFront > p.front.travel * 0.8) warnings.push('前のばねが柔らかすぎ、止まっているだけで底付きに近い');
  if (sagRear > p.rear.travel * 0.8) warnings.push('後のばねが柔らかすぎ、止まっているだけで底付きに近い');
  if (stabilityFactor < 1.1) warnings.push('重心が高く、横転しやすい');
  if (p.body.groundClearance >= p.body.height * p.body.beltLine) warnings.push('最低地上高が窓の下端より高い');
  if (p.front.tireRadius * 2 > p.body.height) warnings.push('タイヤが車高より大きい');
  for (let i = 1; i < p.gearbox.ratios.length; i++) {
    if (p.gearbox.ratios[i] >= p.gearbox.ratios[i - 1]) { warnings.push('ギア比が段ごとに小さくなっていない'); break; }
  }
  if (p.gearbox.ratios.length === 0) warnings.push('ギア比が無い');
  if (p.engine.idleRpm >= p.engine.redlineRpm) warnings.push('アイドル回転数がレブリミット以上');
  return {
    frontCornerLoad, rearCornerLoad, sagFront, sagRear,
    freqFront: freq(p.front.spring, frontCornerLoad),
    freqRear: freq(p.rear.spring, rearCornerLoad),
    peakTorque: pk.peakTorque, peakTorqueRpm: pk.peakTorqueRpm,
    peakPowerKW: pk.peakPower / 1000, peakPowerRpm: pk.peakPowerRpm,
    powerToWeight: pk.peakPower / 1000 / (p.body.mass / 1000),
    topSpeedKmh: estimateTopSpeed(p) * 3.6,
    stabilityFactor,
    lockToLock: (2 * p.steer.maxAngleDeg * p.steer.ratio) / 360,
    warnings,
  };
}

// ---------------------------------------------------------------- 設定画面の定義
export type FieldKind = 'number' | 'select' | 'bool' | 'text' | 'color' | 'curve' | 'list';

export interface FieldDef {
  path: string;
  label: string;
  group: string;
  kind: FieldKind;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** 表示の倍率（0〜1 を % で見せるなど） */
  scale?: number;
  options?: { value: string; label: string }[];
}

const diffOptions = [
  { value: 'open', label: 'オープン' },
  { value: 'lsd', label: 'LSD' },
  { value: 'locked', label: '直結' },
];

function axleFields(axle: 'front' | 'rear', name: string): FieldDef[] {
  const g = `サスペンションとタイヤ（${name}）`;
  return [
    { path: `${axle}.track`, label: 'トレッド', group: g, kind: 'number', unit: 'm', min: 1.0, max: 2.2, step: 0.01 },
    { path: `${axle}.tireRadius`, label: 'タイヤ半径', group: g, kind: 'number', unit: 'm', min: 0.2, max: 0.6, step: 0.005 },
    { path: `${axle}.tireWidth`, label: 'タイヤ幅', group: g, kind: 'number', unit: 'm', min: 0.1, max: 0.45, step: 0.005 },
    { path: `${axle}.wheelMass`, label: 'タイヤとホイールの質量', group: g, kind: 'number', unit: 'kg', min: 5, max: 60, step: 0.5 },
    { path: `${axle}.spring`, label: 'ばね定数', group: g, kind: 'number', unit: 'N/m', min: 5000, max: 300000, step: 500 },
    { path: `${axle}.damperBump`, label: '減衰（縮み）', group: g, kind: 'number', unit: 'N·s/m', min: 200, max: 20000, step: 100 },
    { path: `${axle}.damperRebound`, label: '減衰（伸び）', group: g, kind: 'number', unit: 'N·s/m', min: 200, max: 20000, step: 100 },
    { path: `${axle}.travel`, label: 'ストローク', group: g, kind: 'number', unit: 'm', min: 0.05, max: 0.5, step: 0.005 },
    { path: `${axle}.antiRoll`, label: 'スタビライザー', group: g, kind: 'number', unit: 'N/m', min: 0, max: 150000, step: 500 },
    { path: `${axle}.rollCenter`, label: 'ロールセンター高', group: g, kind: 'number', unit: 'm', min: 0, max: 0.4, step: 0.005 },
    { path: `${axle}.brakeTorque`, label: '制動トルク（1輪）', group: g, kind: 'number', unit: 'N·m', min: 0, max: 6000, step: 50 },
  ];
}

export const FIELDS: FieldDef[] = [
  { path: 'name', label: '名前', group: '車体', kind: 'text' },
  { path: 'color', label: '色', group: '車体', kind: 'color' },
  { path: 'body.length', label: '全長', group: '車体', kind: 'number', unit: 'm', min: 2.5, max: 6, step: 0.01 },
  { path: 'body.width', label: '全幅', group: '車体', kind: 'number', unit: 'm', min: 1.2, max: 2.4, step: 0.01 },
  { path: 'body.height', label: '全高', group: '車体', kind: 'number', unit: 'm', min: 0.9, max: 2.2, step: 0.01 },
  { path: 'body.groundClearance', label: '最低地上高', group: '車体', kind: 'number', unit: 'm', min: 0.05, max: 0.5, step: 0.005 },
  { path: 'body.frontOverhang', label: 'フロントオーバーハング', group: '車体', kind: 'number', unit: 'm', min: 0.3, max: 1.5, step: 0.01 },
  { path: 'wheelbase', label: 'ホイールベース', group: '車体', kind: 'number', unit: 'm', min: 1.8, max: 3.6, step: 0.005 },
  { path: 'body.cabinFront', label: '窓の始まり', group: '車体', kind: 'number', unit: '%', min: 0.05, max: 0.7, step: 0.01, scale: 100 },
  { path: 'body.cabinRear', label: '窓の終わり', group: '車体', kind: 'number', unit: '%', min: 0.4, max: 1.0, step: 0.01, scale: 100 },
  { path: 'body.beltLine', label: '窓の下端', group: '車体', kind: 'number', unit: '%', min: 0.3, max: 0.8, step: 0.01, scale: 100 },
  { path: 'body.mass', label: '車両質量', group: '車体', kind: 'number', unit: 'kg', min: 400, max: 4000, step: 5 },
  { path: 'body.weightFront', label: '前軸の荷重配分', group: '車体', kind: 'number', unit: '%', min: 0.3, max: 0.7, step: 0.005, scale: 100 },
  { path: 'body.cgHeight', label: '重心高', group: '車体', kind: 'number', unit: 'm', min: 0.2, max: 1.2, step: 0.005 },
  { path: 'body.inertiaScale', label: '慣性モーメントの倍率', group: '車体', kind: 'number', min: 0.5, max: 1.5, step: 0.01 },
  { path: 'body.driverSide', label: '運転席', group: '車体', kind: 'select', options: [{ value: 'right', label: '右' }, { value: 'left', label: '左' }] },
  ...axleFields('front', '前'),
  ...axleFields('rear', '後'),
  { path: 'tire.mu', label: '摩擦係数', group: 'タイヤの摩擦', kind: 'number', min: 0.3, max: 2.0, step: 0.01 },
  { path: 'tire.peakSlip', label: '最大摩擦の滑り率', group: 'タイヤの摩擦', kind: 'number', min: 0.03, max: 0.3, step: 0.005 },
  { path: 'tire.peakAngleDeg', label: '最大摩擦の滑り角', group: 'タイヤの摩擦', kind: 'number', unit: '°', min: 2, max: 20, step: 0.1 },
  { path: 'tire.slide', label: '滑り切ったときの摩擦の比', group: 'タイヤの摩擦', kind: 'number', min: 0.4, max: 1.0, step: 0.01 },
  { path: 'tire.falloff', label: '最大摩擦の後の落ち方の幅', group: 'タイヤの摩擦', kind: 'number', min: 0.3, max: 5, step: 0.05 },
  { path: 'tire.loadSensitivity', label: '荷重による摩擦の低下', group: 'タイヤの摩擦', kind: 'number', min: 0, max: 0.4, step: 0.01 },
  { path: 'tire.relaxLength', label: '緩和長（横）', group: 'タイヤの摩擦', kind: 'number', unit: 'm', min: 0.1, max: 1.5, step: 0.01 },
  { path: 'steer.maxAngleDeg', label: '最大切れ角', group: '操舵', kind: 'number', unit: '°', min: 10, max: 50, step: 0.5 },
  { path: 'steer.ackermann', label: 'アッカーマン率', group: '操舵', kind: 'number', unit: '%', min: 0, max: 1, step: 0.05, scale: 100 },
  { path: 'steer.ratio', label: 'ステアリングギア比', group: '操舵', kind: 'number', min: 6, max: 30, step: 0.1 },
  { path: 'engine.torqueCurve', label: 'トルク曲線（rpm:N·m）', group: 'エンジン', kind: 'curve' },
  { path: 'engine.idleRpm', label: 'アイドル回転数', group: 'エンジン', kind: 'number', unit: 'rpm', min: 500, max: 2000, step: 50 },
  { path: 'engine.redlineRpm', label: 'レブリミット', group: 'エンジン', kind: 'number', unit: 'rpm', min: 3000, max: 20000, step: 100 },
  { path: 'engine.inertia', label: '回転部の慣性', group: 'エンジン', kind: 'number', unit: 'kg·m²', min: 0.03, max: 1.0, step: 0.01 },
  { path: 'engine.engineBrake', label: 'エンジンブレーキ', group: 'エンジン', kind: 'number', unit: 'N·m', min: 0, max: 300, step: 5 },
  { path: 'engine.cylinders', label: '気筒数', group: 'エンジン', kind: 'number', min: 1, max: 16, step: 1 },
  { path: 'engine.layout', label: '気筒の並び', group: 'エンジン', kind: 'select', options: [{ value: 'inline', label: '直列' }, { value: 'v', label: 'V 型' }, { value: 'flat', label: '水平対向' }] },
  { path: 'engine.turbo', label: 'ターボ', group: 'エンジン', kind: 'bool' },
  { path: 'engine.exhaust', label: '排気音', group: 'エンジン', kind: 'select', options: [{ value: 'quiet', label: '静か' }, { value: 'sport', label: 'スポーツ' }, { value: 'race', label: 'レース（戻すとはじける）' }] },
  { path: 'engine.orientation', label: '搭載の向き', group: 'エンジン', kind: 'select', options: [{ value: 'longitudinal', label: '縦置き' }, { value: 'transverse', label: '横置き' }] },
  { path: 'gearbox.ratios', label: 'ギア比（1速から）', group: '変速機', kind: 'list' },
  { path: 'gearbox.reverse', label: '後退のギア比', group: '変速機', kind: 'number', min: 1, max: 6, step: 0.01 },
  { path: 'gearbox.finalDrive', label: '最終減速比', group: '変速機', kind: 'number', min: 1.5, max: 8, step: 0.01 },
  { path: 'gearbox.efficiency', label: '伝達効率', group: '変速機', kind: 'number', unit: '%', min: 0.6, max: 1, step: 0.01, scale: 100 },
  { path: 'gearbox.shiftTime', label: '変速にかかる時間', group: '変速機', kind: 'number', unit: 's', min: 0.02, max: 1, step: 0.01 },
  { path: 'drive.layout', label: '駆動方式', group: '駆動方式とデフ', kind: 'select', options: ['FF', 'FR', 'MR', 'RR', '4WD'].map((v) => ({ value: v, label: v })) },
  { path: 'drive.frontDiff.type', label: '前デフ', group: '駆動方式とデフ', kind: 'select', options: diffOptions },
  { path: 'drive.frontDiff.preload', label: '前デフの初期締結', group: '駆動方式とデフ', kind: 'number', unit: 'N·m', min: 0, max: 500, step: 5 },
  { path: 'drive.frontDiff.lock', label: '前デフの締結率', group: '駆動方式とデフ', kind: 'number', unit: '%', min: 0, max: 1, step: 0.05, scale: 100 },
  { path: 'drive.rearDiff.type', label: '後デフ', group: '駆動方式とデフ', kind: 'select', options: diffOptions },
  { path: 'drive.rearDiff.preload', label: '後デフの初期締結', group: '駆動方式とデフ', kind: 'number', unit: 'N·m', min: 0, max: 500, step: 5 },
  { path: 'drive.rearDiff.lock', label: '後デフの締結率', group: '駆動方式とデフ', kind: 'number', unit: '%', min: 0, max: 1, step: 0.05, scale: 100 },
  { path: 'drive.centerDiff.type', label: 'センターデフ（4WD）', group: '駆動方式とデフ', kind: 'select', options: diffOptions },
  { path: 'drive.centerDiff.preload', label: 'センターデフの初期締結', group: '駆動方式とデフ', kind: 'number', unit: 'N·m', min: 0, max: 500, step: 5 },
  { path: 'drive.centerDiff.lock', label: 'センターデフの締結率', group: '駆動方式とデフ', kind: 'number', unit: '%', min: 0, max: 1, step: 0.05, scale: 100 },
  { path: 'drive.frontShare', label: '前輪へのトルク配分（4WD）', group: '駆動方式とデフ', kind: 'number', unit: '%', min: 0.1, max: 0.9, step: 0.05, scale: 100 },
  { path: 'aero.cd', label: '抗力係数 Cd', group: '空力', kind: 'number', min: 0.15, max: 1.2, step: 0.01 },
  { path: 'aero.frontalArea', label: '前面投影面積', group: '空力', kind: 'number', unit: 'm²', min: 1.0, max: 5.0, step: 0.01 },
  { path: 'aero.clFront', label: 'ダウンフォース係数（前）', group: '空力', kind: 'number', min: -0.3, max: 3, step: 0.01 },
  { path: 'aero.clRear', label: 'ダウンフォース係数（後）', group: '空力', kind: 'number', min: -0.3, max: 3, step: 0.01 },
  { path: 'aero.centerOffset', label: '空力中心の位置（重心より前が正）', group: '空力', kind: 'number', unit: 'm', min: -1.5, max: 1.5, step: 0.01 },
  { path: 'assists.abs', label: 'ABS', group: '運転の補助', kind: 'bool' },
  { path: 'assists.tcs', label: 'トラクションコントロール（エンジンブレーキの制御を含む）', group: '運転の補助', kind: 'bool' },
  { path: 'assists.esc', label: '横滑り防止（ESC）', group: '運転の補助', kind: 'bool' },
  { path: 'assists.steerAssist', label: '切れ角の補助（前輪が最大摩擦の滑り角を超えないようにする）', group: '運転の補助', kind: 'bool' },
];

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj);
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as Record<string, unknown>;
  target[last] = value;
}
