/**
 * Inverter (engine spec §3.5):
 *   P_ac = min(P_dc × η(P_dc / P_dc,rated), P_ac,rated)
 *   clipping = max(0, P_dc × η − P_ac,rated)
 * η is linearly interpolated on the catalogue curve (load fraction → efficiency), held flat
 * beyond its ends. Default: flat Euro-efficiency 97.5 %.
 */

export interface EfficiencyPoint {
  loadFraction: number
  efficiency: number
}

export const FLAT_EURO_EFFICIENCY: readonly EfficiencyPoint[] = [{ loadFraction: 0, efficiency: 0.975 }]

export interface InverterSpec {
  id: string
  acRatedKw: number
  /** DC rating the efficiency curve's load fraction refers to. Defaults to acRatedKw. */
  dcRatedKw?: number
  efficiencyCurve?: readonly EfficiencyPoint[]
}

export function validateCurve(curve: readonly EfficiencyPoint[]): void {
  if (curve.length === 0) throw new Error('efficiency curve is empty')
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i]!
    if (!(p.efficiency > 0 && p.efficiency <= 1)) throw new Error(`efficiency must be in (0, 1], got ${p.efficiency}`)
    if (i > 0 && !(p.loadFraction > curve[i - 1]!.loadFraction)) throw new Error('efficiency curve load fractions must increase')
  }
}

export function efficiencyAt(curve: readonly EfficiencyPoint[], loadFraction: number): number {
  const first = curve[0]!
  if (curve.length === 1 || loadFraction <= first.loadFraction) return first.efficiency
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!
    const b = curve[i]!
    if (loadFraction <= b.loadFraction) {
      return a.efficiency + ((b.efficiency - a.efficiency) * (loadFraction - a.loadFraction)) / (b.loadFraction - a.loadFraction)
    }
  }
  return curve[curve.length - 1]!.efficiency
}

export function inverterOutput(pDcKw: number, inv: InverterSpec): { pAcKw: number; clippedKw: number } {
  if (pDcKw <= 0) return { pAcKw: 0, clippedKw: 0 }
  const curve = inv.efficiencyCurve ?? FLAT_EURO_EFFICIENCY
  const eta = efficiencyAt(curve, pDcKw / (inv.dcRatedKw ?? inv.acRatedKw))
  const unclipped = pDcKw * eta
  const pAcKw = Math.min(unclipped, inv.acRatedKw)
  return { pAcKw, clippedKw: unclipped - pAcKw }
}
