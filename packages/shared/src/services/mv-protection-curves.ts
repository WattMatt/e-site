/**
 * mv-protection-curves.ts
 * ESITE — Medium Voltage function. Pure-TS calculation core for inverse-time
 * protection curves (IEC 60255-151 + IEEE C37.112) and the TMS/TD grading
 * solver. Authored in the `packages/shared` pure-service style: plain inputs →
 * plain outputs, no DB, fully unit-tested (see mv-protection-curves.test.ts).
 *
 * This file is DECOUPLED from the cable-schedule domain. It depends on nothing
 * but its inputs and belongs to the MV equipment / protection module.
 *
 * Every constant is traceable to a standard and asserted by the test suite.
 * Cross-verified to <1e-9 against the Python reference mv_curve_engine.py.
 */

// --- Curve constant tables (traceable to the standards) ---------------------

/** IEC 60255-151:  t = TMS * k / (M^alpha - 1) */
export const IEC_CONSTANTS = {
  SI: { k: 0.14, alpha: 0.02 }, // Standard Inverse
  VI: { k: 13.5, alpha: 1.0 }, // Very Inverse
  EI: { k: 80.0, alpha: 2.0 }, // Extremely Inverse
  LTI: { k: 120.0, alpha: 1.0 }, // Long-Time Inverse
  STI: { k: 0.05, alpha: 0.04 }, // Short-Time Inverse
} as const;

/** IEEE C37.112:  t = TD * (A / (M^p - 1) + B) */
export const IEEE_CONSTANTS = {
  MI: { A: 0.0515, B: 0.114, p: 0.02 }, // Moderately Inverse
  VI: { A: 19.61, B: 0.491, p: 2.0 }, // Very Inverse
  EI: { A: 28.2, B: 0.1217, p: 2.0 }, // Extremely Inverse
} as const;

export type IecCurve = keyof typeof IEC_CONSTANTS;
export type IeeeCurve = keyof typeof IEEE_CONSTANTS;

export class CurveError extends Error {}

// --- Operating-time calculations --------------------------------------------

/** IEC 60255-151 inverse-time operating time (s). M = I/Is must be > 1. */
export function iecTime(curve: IecCurve, M: number, tms: number): number {
  const c = IEC_CONSTANTS[curve];
  if (!c) throw new CurveError(`Unknown IEC curve: ${curve}`);
  if (M <= 1) throw new CurveError("M must be > 1 (no operation at/below pickup)");
  if (tms <= 0) throw new CurveError("TMS must be > 0");
  return (tms * c.k) / (Math.pow(M, c.alpha) - 1);
}

/**
 * IEEE C37.112 inverse-time operating time (s).
 * @param tdNormaliser pass 7 for relays implementing the TD/7 form; default 1.
 */
export function ieeeTime(
  curve: IeeeCurve,
  M: number,
  td: number,
  tdNormaliser = 1,
): number {
  const c = IEEE_CONSTANTS[curve];
  if (!c) throw new CurveError(`Unknown IEEE curve: ${curve}`);
  if (M <= 1) throw new CurveError("M must be > 1 (no operation at/below pickup)");
  if (td <= 0) throw new CurveError("TD must be > 0");
  return (td / tdNormaliser) * (c.A / (Math.pow(M, c.p) - 1) + c.B);
}

/** Definite-time element: fixed delay once I > Is. */
export function dtTime(tSet: number): number {
  if (tSet < 0) throw new CurveError("Definite-time delay must be >= 0");
  return tSet;
}

/**
 * ANSI 49 thermal overload operating time (s).
 * t = tau * ln[(I^2 - Ip^2) / (I^2 - (k*Itheta)^2)], valid for I > k*Itheta.
 */
export function thermalTime(
  tau: number,
  I: number,
  iTheta: number,
  k = 1.05,
  iPrior = 0,
): number {
  const threshold = k * iTheta;
  if (I <= threshold) throw new CurveError("I must exceed k*Itheta for a thermal trip");
  return tau * Math.log((I * I - iPrior * iPrior) / (I * I - threshold * threshold));
}

// --- Grading solver ---------------------------------------------------------

/** Inverse of iecTime: TMS that yields tRequired at multiple M. */
export function solveIecTms(curve: IecCurve, M: number, tRequired: number): number {
  const c = IEC_CONSTANTS[curve];
  if (!c) throw new CurveError(`Unknown IEC curve: ${curve}`);
  if (M <= 1) throw new CurveError("M must be > 1");
  return (tRequired * (Math.pow(M, c.alpha) - 1)) / c.k;
}

/** Inverse of ieeeTime: TD that yields tRequired at multiple M. */
export function solveIeeeTd(
  curve: IeeeCurve,
  M: number,
  tRequired: number,
  tdNormaliser = 1,
): number {
  const c = IEEE_CONSTANTS[curve];
  if (!c) throw new CurveError(`Unknown IEEE curve: ${curve}`);
  if (M <= 1) throw new CurveError("M must be > 1");
  return (tRequired * tdNormaliser) / (c.A / (Math.pow(M, c.p) - 1) + c.B);
}

/** Round a raw setting UP to the next settable step, clamped to range. */
export function snapToStep(value: number, step: number, vmin: number, vmax: number): number {
  if (value < vmin) return vmin;
  if (value > vmax) throw new CurveError(`Solved setting ${value} exceeds max ${vmax}`);
  let snapped = vmin + Math.ceil((value - vmin) / step - 1e-9) * step;
  if (snapped < value) snapped += step;
  return Math.min(Number(snapped.toFixed(6)), vmax);
}

// --- Grading verdict --------------------------------------------------------

export interface GradePair {
  gradingCurrentA: number;
  downstreamTimeS: number;
  upstreamTimeS: number;
}

export function achievedMargin(p: GradePair): number {
  return p.upstreamTimeS - p.downstreamTimeS;
}

export function gradeVerdict(
  p: GradePair,
  requiredMarginS: number,
  marginalBandS = 0.05,
): "ok" | "marginal" | "fails" {
  const m = achievedMargin(p);
  if (m >= requiredMarginS - 1e-9) return "ok";
  if (m >= requiredMarginS - marginalBandS) return "marginal";
  return "fails";
}
