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

/** 車体の柄。stripes は中央の 2 本線、side は横の帯、rally は横の斜めの色面とゼッケン、flash は横の斜めの稲妻、twotone は上下の塗り分け */
export type LiveryStyle = 'none' | 'stripes' | 'side' | 'rally' | 'flash' | 'twotone';

export interface Livery {
  style: LiveryStyle;
  /** ゼッケンの番号（0 なら付けない） */
  number: number;
  /** 線や色面の色 */
  color2: string;
  /** 番号の地の色 */
  plate: string;
}

export interface CarParams {
  id: string;
  name: string;
  color: string;
  livery: Livery;
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
    /** 車体の型（見た目だけ） */
    style: 'hatch' | 'sedan' | 'coupe' | 'suv' | 'kei' | 'super';
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
  if (sagFront > p.front.travel * 0.8) warnings.push('Front springs are too soft, nearly bottoming out at standstill');
  if (sagRear > p.rear.travel * 0.8) warnings.push('Rear springs are too soft, nearly bottoming out at standstill');
  if (stabilityFactor < 1.1) warnings.push('Center of gravity is high, so the car rolls over easily');
  if (p.body.groundClearance >= p.body.height * p.body.beltLine) warnings.push('Ground clearance is higher than the window bottom edge');
  if (p.front.tireRadius * 2 > p.body.height) warnings.push('Tires are taller than the car');
  for (let i = 1; i < p.gearbox.ratios.length; i++) {
    if (p.gearbox.ratios[i] >= p.gearbox.ratios[i - 1]) { warnings.push('Gear ratios do not decrease with each gear'); break; }
  }
  if (p.gearbox.ratios.length === 0) warnings.push('No gear ratios defined');
  if (p.engine.idleRpm >= p.engine.redlineRpm) warnings.push('Idle rpm is at or above the redline');
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
  { value: 'open', label: 'Open' },
  { value: 'lsd', label: 'LSD' },
  { value: 'locked', label: 'Locked' },
];

function axleFields(axle: 'front' | 'rear', name: string): FieldDef[] {
  const g = `Suspension and tires (${name})`;
  return [
    { path: `${axle}.track`, label: 'Track width', group: g, kind: 'number', unit: 'm', min: 1.0, max: 2.2, step: 0.01 },
    { path: `${axle}.tireRadius`, label: 'Tire radius', group: g, kind: 'number', unit: 'm', min: 0.2, max: 0.6, step: 0.005 },
    { path: `${axle}.tireWidth`, label: 'Tire width', group: g, kind: 'number', unit: 'm', min: 0.1, max: 0.45, step: 0.005 },
    { path: `${axle}.wheelMass`, label: 'Tire and wheel mass', group: g, kind: 'number', unit: 'kg', min: 5, max: 60, step: 0.5 },
    { path: `${axle}.spring`, label: 'Spring rate', group: g, kind: 'number', unit: 'N/m', min: 5000, max: 300000, step: 500 },
    { path: `${axle}.damperBump`, label: 'Damping (bump)', group: g, kind: 'number', unit: 'N·s/m', min: 200, max: 20000, step: 100 },
    { path: `${axle}.damperRebound`, label: 'Damping (rebound)', group: g, kind: 'number', unit: 'N·s/m', min: 200, max: 20000, step: 100 },
    { path: `${axle}.travel`, label: 'Travel', group: g, kind: 'number', unit: 'm', min: 0.05, max: 0.5, step: 0.005 },
    { path: `${axle}.antiRoll`, label: 'Anti-roll bar', group: g, kind: 'number', unit: 'N/m', min: 0, max: 150000, step: 500 },
    { path: `${axle}.rollCenter`, label: 'Roll center height', group: g, kind: 'number', unit: 'm', min: 0, max: 0.4, step: 0.005 },
    { path: `${axle}.brakeTorque`, label: 'Brake torque (per wheel)', group: g, kind: 'number', unit: 'N·m', min: 0, max: 6000, step: 50 },
  ];
}

export const FIELDS: FieldDef[] = [
  { path: 'name', label: 'Name', group: 'Body', kind: 'text' },
  { path: 'color', label: 'Color', group: 'Body', kind: 'color' },
  { path: 'livery.style', label: 'Livery', group: 'Body', kind: 'select', options: [
    { value: 'none', label: 'Plain' }, { value: 'stripes', label: 'Racing stripes' }, { value: 'side', label: 'Side stripe' },
    { value: 'rally', label: 'Rally' }, { value: 'flash', label: 'Flash' }, { value: 'twotone', label: 'Two-tone' }] },
  { path: 'livery.color2', label: 'Livery color', group: 'Body', kind: 'color' },
  { path: 'livery.number', label: 'Race number (0 for none)', group: 'Body', kind: 'number', min: 0, max: 99, step: 1 },
  { path: 'livery.plate', label: 'Number plate color', group: 'Body', kind: 'color' },
  { path: 'body.length', label: 'Length', group: 'Body', kind: 'number', unit: 'm', min: 2.5, max: 6, step: 0.01 },
  { path: 'body.width', label: 'Width', group: 'Body', kind: 'number', unit: 'm', min: 1.2, max: 2.4, step: 0.01 },
  { path: 'body.height', label: 'Height', group: 'Body', kind: 'number', unit: 'm', min: 0.9, max: 2.2, step: 0.01 },
  { path: 'body.groundClearance', label: 'Ground clearance', group: 'Body', kind: 'number', unit: 'm', min: 0.05, max: 0.5, step: 0.005 },
  { path: 'body.frontOverhang', label: 'Front overhang', group: 'Body', kind: 'number', unit: 'm', min: 0.3, max: 1.5, step: 0.01 },
  { path: 'wheelbase', label: 'Wheelbase', group: 'Body', kind: 'number', unit: 'm', min: 1.8, max: 3.6, step: 0.005 },
  { path: 'body.cabinFront', label: 'Window start', group: 'Body', kind: 'number', unit: '%', min: 0.05, max: 0.7, step: 0.01, scale: 100 },
  { path: 'body.cabinRear', label: 'Window end', group: 'Body', kind: 'number', unit: '%', min: 0.4, max: 1.0, step: 0.01, scale: 100 },
  { path: 'body.beltLine', label: 'Window bottom edge', group: 'Body', kind: 'number', unit: '%', min: 0.3, max: 0.8, step: 0.01, scale: 100 },
  { path: 'body.mass', label: 'Car mass', group: 'Body', kind: 'number', unit: 'kg', min: 400, max: 4000, step: 5 },
  { path: 'body.weightFront', label: 'Front weight distribution', group: 'Body', kind: 'number', unit: '%', min: 0.3, max: 0.7, step: 0.005, scale: 100 },
  { path: 'body.cgHeight', label: 'CoG height', group: 'Body', kind: 'number', unit: 'm', min: 0.2, max: 1.2, step: 0.005 },
  { path: 'body.inertiaScale', label: 'Moment of inertia multiplier', group: 'Body', kind: 'number', min: 0.5, max: 1.5, step: 0.01 },
  { path: 'body.style', label: 'Body style', group: 'Body', kind: 'select', options: [
    { value: 'kei', label: 'Kei (tall, short nose)' }, { value: 'hatch', label: 'Hatchback' }, { value: 'sedan', label: 'Sedan (with wing)' },
    { value: 'coupe', label: 'Coupe (sloping rear)' }, { value: 'suv', label: 'SUV' }, { value: 'super', label: 'Mid-engine (low and long)' }] },
  { path: 'body.driverSide', label: 'Driver seat', group: 'Body', kind: 'select', options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }] },
  ...axleFields('front', 'Front'),
  ...axleFields('rear', 'Rear'),
  { path: 'tire.mu', label: 'Friction coefficient', group: 'Tire grip', kind: 'number', min: 0.3, max: 2.0, step: 0.01 },
  { path: 'tire.peakSlip', label: 'Slip ratio at peak grip', group: 'Tire grip', kind: 'number', min: 0.03, max: 0.3, step: 0.005 },
  { path: 'tire.peakAngleDeg', label: 'Slip angle at peak grip', group: 'Tire grip', kind: 'number', unit: '°', min: 2, max: 20, step: 0.1 },
  { path: 'tire.slide', label: 'Friction ratio when fully sliding', group: 'Tire grip', kind: 'number', min: 0.4, max: 1.0, step: 0.01 },
  { path: 'tire.falloff', label: 'Falloff width after peak grip', group: 'Tire grip', kind: 'number', min: 0.3, max: 5, step: 0.05 },
  { path: 'tire.loadSensitivity', label: 'Load sensitivity of friction', group: 'Tire grip', kind: 'number', min: 0, max: 0.4, step: 0.01 },
  { path: 'tire.relaxLength', label: 'Relaxation length (lateral)', group: 'Tire grip', kind: 'number', unit: 'm', min: 0.1, max: 1.5, step: 0.01 },
  { path: 'steer.maxAngleDeg', label: 'Max steering angle', group: 'Steering', kind: 'number', unit: '°', min: 10, max: 50, step: 0.5 },
  { path: 'steer.ackermann', label: 'Ackermann ratio', group: 'Steering', kind: 'number', unit: '%', min: 0, max: 1, step: 0.05, scale: 100 },
  { path: 'steer.ratio', label: 'Steering ratio', group: 'Steering', kind: 'number', min: 6, max: 30, step: 0.1 },
  { path: 'engine.torqueCurve', label: 'Torque curve (rpm:N·m)', group: 'Engine', kind: 'curve' },
  { path: 'engine.idleRpm', label: 'Idle rpm', group: 'Engine', kind: 'number', unit: 'rpm', min: 500, max: 2000, step: 50 },
  { path: 'engine.redlineRpm', label: 'Redline', group: 'Engine', kind: 'number', unit: 'rpm', min: 3000, max: 20000, step: 100 },
  { path: 'engine.inertia', label: 'Rotating inertia', group: 'Engine', kind: 'number', unit: 'kg·m²', min: 0.03, max: 1.0, step: 0.01 },
  { path: 'engine.engineBrake', label: 'Engine braking', group: 'Engine', kind: 'number', unit: 'N·m', min: 0, max: 300, step: 5 },
  { path: 'engine.cylinders', label: 'Cylinders', group: 'Engine', kind: 'number', min: 1, max: 16, step: 1 },
  { path: 'engine.layout', label: 'Cylinder layout', group: 'Engine', kind: 'select', options: [{ value: 'inline', label: 'Inline' }, { value: 'v', label: 'V' }, { value: 'flat', label: 'Flat (boxer)' }] },
  { path: 'engine.turbo', label: 'Turbo', group: 'Engine', kind: 'bool' },
  { path: 'engine.exhaust', label: 'Exhaust note', group: 'Engine', kind: 'select', options: [{ value: 'quiet', label: 'Quiet' }, { value: 'sport', label: 'Sport' }, { value: 'race', label: 'Race (pops on lift-off)' }] },
  { path: 'engine.orientation', label: 'Engine orientation', group: 'Engine', kind: 'select', options: [{ value: 'longitudinal', label: 'Longitudinal' }, { value: 'transverse', label: 'Transverse' }] },
  { path: 'gearbox.ratios', label: 'Gear ratios (from 1st)', group: 'Gearbox', kind: 'list' },
  { path: 'gearbox.reverse', label: 'Reverse gear ratio', group: 'Gearbox', kind: 'number', min: 1, max: 6, step: 0.01 },
  { path: 'gearbox.finalDrive', label: 'Final drive', group: 'Gearbox', kind: 'number', min: 1.5, max: 8, step: 0.01 },
  { path: 'gearbox.efficiency', label: 'Transmission efficiency', group: 'Gearbox', kind: 'number', unit: '%', min: 0.6, max: 1, step: 0.01, scale: 100 },
  { path: 'gearbox.shiftTime', label: 'Shift time', group: 'Gearbox', kind: 'number', unit: 's', min: 0.02, max: 1, step: 0.01 },
  { path: 'drive.layout', label: 'Drive layout', group: 'Drive layout and differentials', kind: 'select', options: ['FF', 'FR', 'MR', 'RR', '4WD'].map((v) => ({ value: v, label: v })) },
  { path: 'drive.frontDiff.type', label: 'Front differential', group: 'Drive layout and differentials', kind: 'select', options: diffOptions },
  { path: 'drive.frontDiff.preload', label: 'Front diff preload', group: 'Drive layout and differentials', kind: 'number', unit: 'N·m', min: 0, max: 500, step: 5 },
  { path: 'drive.frontDiff.lock', label: 'Front diff lock ratio', group: 'Drive layout and differentials', kind: 'number', unit: '%', min: 0, max: 1, step: 0.05, scale: 100 },
  { path: 'drive.rearDiff.type', label: 'Rear differential', group: 'Drive layout and differentials', kind: 'select', options: diffOptions },
  { path: 'drive.rearDiff.preload', label: 'Rear diff preload', group: 'Drive layout and differentials', kind: 'number', unit: 'N·m', min: 0, max: 500, step: 5 },
  { path: 'drive.rearDiff.lock', label: 'Rear diff lock ratio', group: 'Drive layout and differentials', kind: 'number', unit: '%', min: 0, max: 1, step: 0.05, scale: 100 },
  { path: 'drive.centerDiff.type', label: 'Center differential (4WD)', group: 'Drive layout and differentials', kind: 'select', options: diffOptions },
  { path: 'drive.centerDiff.preload', label: 'Center diff preload', group: 'Drive layout and differentials', kind: 'number', unit: 'N·m', min: 0, max: 500, step: 5 },
  { path: 'drive.centerDiff.lock', label: 'Center diff lock ratio', group: 'Drive layout and differentials', kind: 'number', unit: '%', min: 0, max: 1, step: 0.05, scale: 100 },
  { path: 'drive.frontShare', label: 'Front torque split (4WD)', group: 'Drive layout and differentials', kind: 'number', unit: '%', min: 0.1, max: 0.9, step: 0.05, scale: 100 },
  { path: 'aero.cd', label: 'Drag coefficient (Cd)', group: 'Aerodynamics', kind: 'number', min: 0.15, max: 1.2, step: 0.01 },
  { path: 'aero.frontalArea', label: 'Frontal area', group: 'Aerodynamics', kind: 'number', unit: 'm²', min: 1.0, max: 5.0, step: 0.01 },
  { path: 'aero.clFront', label: 'Downforce coefficient (front)', group: 'Aerodynamics', kind: 'number', min: -0.3, max: 3, step: 0.01 },
  { path: 'aero.clRear', label: 'Downforce coefficient (rear)', group: 'Aerodynamics', kind: 'number', min: -0.3, max: 3, step: 0.01 },
  { path: 'aero.centerOffset', label: 'Aero center position (positive ahead of CoG)', group: 'Aerodynamics', kind: 'number', unit: 'm', min: -1.5, max: 1.5, step: 0.01 },
  { path: 'assists.abs', label: 'ABS', group: 'Driver aids', kind: 'bool' },
  { path: 'assists.tcs', label: 'Traction control (includes engine braking control)', group: 'Driver aids', kind: 'bool' },
  { path: 'assists.esc', label: 'Stability control (ESC)', group: 'Driver aids', kind: 'bool' },
  { path: 'assists.steerAssist', label: 'Steering assist (keeps the front wheels from exceeding the peak-grip slip angle)', group: 'Driver aids', kind: 'bool' },
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
