// タイヤの力。滑り率と滑り角をそれぞれ最大摩擦の滑りで割って合成し、
// 合成した滑りの向きに力を出す（前後と横で摩擦を取り合う）。
import type { CarParams } from './params';
import { DEG } from './params';
import type { Surface } from './surfaces';

/** 合成した滑り rho（最大摩擦の滑りで割った値）に対する、最大摩擦との比 */
export function slipCurve(rho: number, slide: number, falloff: number): number {
  if (rho <= 1) return Math.sin((rho * Math.PI) / 2);
  const t = (rho - 1) / falloff;
  return slide + (1 - slide) * Math.exp(-t * t);
}

export interface TireOut {
  fx: number;
  fy: number;
  /** 最大摩擦力 [N] */
  limit: number;
  /** 最大摩擦の滑りで割った前後の滑り */
  sx: number;
  sy: number;
}

/**
 * @param kappa 滑り率（緩和長を通した値）
 * @param tanAlpha 滑り角の正接（緩和長を通した値）。正なら右向きの力
 * @param fz 垂直荷重 [N]
 * @param fz0 基準荷重 [N]（荷重による摩擦の低下の基準）
 */
export function tireForce(p: CarParams, s: Surface, kappa: number, tanAlpha: number, fz: number, fz0: number, out: TireOut): void {
  const t = p.tire;
  const kp = t.peakSlip * s.slipScale;
  const ap = t.peakAngleDeg * DEG * s.slipScale;
  const sx = kappa / kp;
  const sy = Math.atan(tanAlpha) / ap;
  const rho = Math.hypot(sx, sy);
  const mu = t.mu * s.mu * Math.max(0.5, 1 - t.loadSensitivity * (fz / fz0 - 1));
  const limit = mu * fz;
  out.limit = limit;
  out.sx = sx;
  out.sy = sy;
  if (rho < 1e-9 || fz <= 0) { out.fx = 0; out.fy = 0; return; }
  const f = limit * slipCurve(rho, s.slide ?? t.slide, t.falloff);
  out.fx = (f * sx) / rho;
  out.fy = (f * sy) / rho;
}

/** 緩和長の状態がとりうる上限（これ以上は滑っているだけで力は増えない） */
export function deflectionLimits(p: CarParams, s: Surface): { kappaMax: number; tanAlphaMax: number } {
  const span = 1 + 3 * p.tire.falloff;
  const kappaMax = p.tire.peakSlip * s.slipScale * span;
  const alphaMax = Math.min(80 * DEG, p.tire.peakAngleDeg * DEG * s.slipScale * span);
  return { kappaMax, tanAlphaMax: Math.tan(alphaMax) };
}
