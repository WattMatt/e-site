import type { LoadBasis } from './site-series'

export const DIVERSITY_DISABLED_REASON = 'Measured data already reflects diversity'

/** MD_synth = k × Σ_t max_h synth_t[h]. Never applied to hourly energy (WM cut energy by 20 % that way). */
export function designMaxDemandSynth(synths: Float64Array[], k = 1): number {
  if (!(k > 0 && k <= 1)) throw new RangeError('The diversity factor must be in (0, 1].')
  let total = 0
  for (const s of synths) {
    let max = 0
    for (let i = 0; i < s.length; i++) if (s[i] > max) max = s[i]
    total += max
  }
  return k * total
}

/** Diversity is for synthesised load only; S1/S2 are measured, S4 is scaled to bills. */
export function diversityApplies(basis: LoadBasis): boolean {
  return basis === 'S3'
}
