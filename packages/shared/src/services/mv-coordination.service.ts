/**
 * mv-coordination.service.ts — protection grading + TCC plot data (pure TS).
 * Builds on the verified curve engine (mv-protection-curves.ts).
 */
import {
  iecTime,
  ieeeTime,
  dtTime,
  achievedMargin,
  gradeVerdict,
  type IecCurve,
  type IeeeCurve,
} from './mv-protection-curves'

export type CurveStd = 'IEC' | 'IEEE' | 'DT'

export interface DeviceModel {
  id: string
  label: string
  std: CurveStd
  curve?: IecCurve | IeeeCurve
  pickupA: number
  tms?: number
  td?: number
  dtS?: number
  instMultiple?: number // high-set / instantaneous (ANSI 50) pickup, as ×pickupA
  instTimeS?: number // high-set operate time (s); defaults to DEFAULT_INST_TIME_S
}

/** Default high-set/instantaneous operate time (numerical-relay element). */
export const DEFAULT_INST_TIME_S = 0.05

/**
 * Operating time (s) at a given current; null if at/below pickup.
 *
 * A relay with a high-set/instantaneous element (ANSI 50) trips on whichever of
 * its elements is faster: above instMultiple×pickup the time floors at instTimeS,
 * so deviceTime returns min(IDMT, instTimeS). This is what lets gradePair surface
 * an upstream 50 that overreaches the downstream zone.
 */
export function deviceTime(d: DeviceModel, currentA: number): number | null {
  if (currentA <= d.pickupA) return null
  const M = currentA / d.pickupA
  let t: number
  if (d.std === 'IEC') t = iecTime(d.curve as IecCurve, M, d.tms ?? 1)
  else if (d.std === 'IEEE') t = ieeeTime(d.curve as IeeeCurve, M, d.td ?? 1)
  else t = dtTime(d.dtS ?? 0)
  if (d.instMultiple != null && currentA >= d.instMultiple * d.pickupA) {
    t = Math.min(t, d.instTimeS ?? DEFAULT_INST_TIME_S)
  }
  return t
}

export interface TccPoint {
  currentA: number
  timeS: number
}

/** Log-spaced operating-time samples for plotting (below-pickup points omitted). */
export function tccSeries(
  d: DeviceModel,
  range: { minA: number; maxA: number; points?: number },
): TccPoint[] {
  const n = range.points ?? 200
  const out: TccPoint[] = []
  for (let i = 0; i <= n; i++) {
    const currentA = range.minA * Math.pow(range.maxA / range.minA, i / n)
    const t = deviceTime(d, currentA)
    if (t != null && Number.isFinite(t)) out.push({ currentA, timeS: t })
  }
  return out
}

export interface DiscriminationCheck {
  upstreamId: string
  downstreamId: string
  atFaultA: number
  downstreamTimeS: number
  upstreamTimeS: number
  marginS: number
  verdict: 'ok' | 'marginal' | 'fails'
}

/** Grade an upstream/downstream pair at a common fault current. */
export function gradePair(
  up: DeviceModel,
  down: DeviceModel,
  faultA: number,
  requiredMarginS: number,
): DiscriminationCheck {
  const dt = deviceTime(down, faultA)
  const ut = deviceTime(up, faultA)
  if (dt == null || ut == null) {
    throw new Error(`gradePair: a device does not operate at ${faultA} A`)
  }
  const pair = { gradingCurrentA: faultA, downstreamTimeS: dt, upstreamTimeS: ut }
  return {
    upstreamId: up.id,
    downstreamId: down.id,
    atFaultA: faultA,
    downstreamTimeS: dt,
    upstreamTimeS: ut,
    marginS: achievedMargin(pair),
    verdict: gradeVerdict(pair, requiredMarginS),
  }
}

export function coordinateStudy(
  pairs: { up: DeviceModel; down: DeviceModel; faultA: number }[],
  requiredMarginS: number,
): DiscriminationCheck[] {
  return pairs.map((p) => gradePair(p.up, p.down, p.faultA, requiredMarginS))
}
