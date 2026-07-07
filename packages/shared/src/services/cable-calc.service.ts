/**
 * Cable calculations — pure functions over raw row data.
 *
 * Volt drop follows the SANS 10142-1 mV/A/m convention:
 *
 *   volt_drop_pct = phase_factor × ohm_per_km × (length_m / 100) × load_a × (10 / voltage_v)
 *
 * where phase_factor is 2 for single-phase (drop over flow + return
 * conductor) and √3 for three-phase (line-to-line drop, balanced load) —
 * the same factors SANS builds into its 1φ / 3φ mV/A/m columns (1φ = 2·z,
 * 3φ = √3·z). The pre-2026-07 workbook shorthand omitted the phase factor
 * and understated every drop (×2 at 230 V, ×√3 at 400 V).
 *
 * For supplies with N parallel cables, the effective resistance per
 * conductor is divided by N. Cumulative volt drop is computed by walking
 * the supply tree from RMU/Source toward the leaf board.
 *
 * No DB access — these helpers take plain inputs and return plain outputs
 * so the schedule grid (server-rendered first pass) and any later
 * spreadsheet-export code can both call into them.
 */

export interface CableForCalc {
  id: string
  supply_id: string
  cable_no: number
  size_mm2: number
  ohm_per_km: number | null
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY'
  derate_depth: number | null
  derate_thermal: number | null
  derate_grouping: number | null
  derate_temp: number | null
}

export interface SupplyForCalc {
  id: string
  from_source_id: string | null
  from_node_id: string | null
  to_node_id: string
  voltage_v: number
  design_load_a: number
}

/**
 * Length-selection mode per spec §15.6 / §15.7. Drives which length the
 * VD + cost calculations use.
 *
 *   'design'    — measured length always (tender / budget estimate basis)
 *   'as-built'  — confirmed if signed off, else measured  (default — what
 *                 the workbook already produces and the spec calls
 *                 "active length")
 *   'worst'     — max(measured, confirmed) per cable (engineer's
 *                 compliance buffer view)
 */
export type LengthMode = 'design' | 'as-built' | 'worst'

/**
 * Active length per the given mode. Returns null when no length is set
 * at all.
 */
export function activeLengthM(
  cable: CableForCalc,
  mode: LengthMode = 'as-built',
): number | null {
  const meas = cable.measured_length_m == null ? null : Number(cable.measured_length_m)
  const conf = cable.confirmed_length_m == null ? null : Number(cable.confirmed_length_m)
  if (mode === 'design') return meas
  if (mode === 'worst') {
    if (meas != null && conf != null) return Math.max(meas, conf)
    return conf ?? meas
  }
  // 'as-built' (default)
  if (cable.length_status === 'CONFIRMED' && conf != null) return conf
  return meas
}

/**
 * Phase factor for the SANS volt-drop formula. 230 V supplies are
 * single-phase — the current flows out and back, so the loop drop is
 * 2 × the per-conductor drop. 400 V and above are three-phase — the
 * balanced line-to-line drop is √3 × the per-conductor drop. These are
 * exactly the multipliers SANS 10142-1 bakes into its published 1φ / 3φ
 * mV/A/m columns.
 */
export function phaseFactor(voltageV: number): number {
  return voltageV < 380 ? 2 : Math.sqrt(3)
}

/**
 * Single-cable volt drop percentage per SANS 10142-1:
 *
 *     vd% = phase_factor × Ω/km × (length_m / 100) × load_a × (10 / voltage_v)
 *
 * ohm_per_km is the cable's AC impedance z per conductor at operating
 * temperature (the reference tables' impedance column); using scalar z
 * rather than r·cosφ + x·sinφ matches the tables' own mV/A/m columns and
 * is marginally conservative at lagging power factors.
 *
 * Caller is responsible for applying parallel-cable divisor when
 * appropriate (use voltDropPctForSupply for the N-cables-in-parallel case).
 */
export function voltDropPctSingle(
  ohmPerKm: number,
  lengthM: number,
  loadA: number,
  voltageV: number,
): number {
  if (!Number.isFinite(ohmPerKm) || !Number.isFinite(lengthM) || voltageV <= 0) return 0
  return phaseFactor(voltageV) * ohmPerKm * (lengthM / 100) * loadA * (10 / voltageV)
}

/**
 * Volt-drop percentage for one supply with its (1 or more) parallel cables.
 * The effective conductor resistance per parallel cable is Ω/km ÷ N when
 * the cables are the same size. When parallel cables are different sizes
 * (allowed per §6), we treat the supply VD as the parallel-combined drop:
 * 1 / (Σ 1 / vd_i) — equivalent to combining the conductors as parallel
 * resistors carrying a shared load.
 */
export function voltDropPctForSupply(
  supply: SupplyForCalc,
  cables: CableForCalc[],
  mode: LengthMode = 'as-built',
): number {
  const live = cables.filter((c) => c.supply_id === supply.id && c.ohm_per_km != null)
  if (live.length === 0) return 0

  // Same-size parallel cables: effective Ω/km = Ω/km / N. We detect this
  // by checking if every cable has the same size + ohm_per_km.
  const firstSize = live[0]!.size_mm2
  const firstOhm = live[0]!.ohm_per_km!
  const sameAll = live.every((c) => c.size_mm2 === firstSize && c.ohm_per_km === firstOhm)
  if (sameAll) {
    const len = avgActiveLength(live, mode)
    if (len == null) return 0
    return voltDropPctSingle(firstOhm / live.length, len, supply.design_load_a, supply.voltage_v)
  }

  // Mixed sizes — combine VDs as 1 / Σ(1 / vd_i). Falls back to a simple
  // sum-of-conductances approximation when length data is incomplete.
  let inv = 0
  for (const c of live) {
    const len = activeLengthM(c, mode)
    if (len == null) continue
    const vd = voltDropPctSingle(c.ohm_per_km!, len, supply.design_load_a, supply.voltage_v)
    if (vd > 0) inv += 1 / vd
  }
  return inv > 0 ? 1 / inv : 0
}

function avgActiveLength(cables: CableForCalc[], mode: LengthMode = 'as-built'): number | null {
  const lens: number[] = []
  for (const c of cables) {
    const l = activeLengthM(c, mode)
    if (l != null) lens.push(l)
  }
  if (lens.length === 0) return null
  return lens.reduce((s, v) => s + v, 0) / lens.length
}

/**
 * Cumulative VD% from every Source through the supply tree to every leaf
 * board. Returns a map keyed by supply_id of the cumulative percentage at
 * the supply's `to_node_id` node.
 *
 * Walks downwards from supplies whose origin is a Source; recurses through
 * each board's outgoing supplies. Detects cycles (shouldn't happen but
 * worth guarding against malformed data) and stops there to avoid an
 * infinite loop.
 */
export function computeCumulativeVdMap(
  supplies: SupplyForCalc[],
  cables: CableForCalc[],
  mode: LengthMode = 'as-built',
): Map<string, number> {
  const out = new Map<string, number>()
  const supplyByFromNode = new Map<string, SupplyForCalc[]>()
  for (const s of supplies) {
    if (s.from_node_id) {
      const list = supplyByFromNode.get(s.from_node_id) ?? []
      list.push(s)
      supplyByFromNode.set(s.from_node_id, list)
    }
  }

  const roots = supplies.filter((s) => s.from_source_id != null)
  const visiting = new Set<string>()

  function walk(supply: SupplyForCalc, accumulatedVd: number) {
    if (visiting.has(supply.id)) return        // cycle guard
    visiting.add(supply.id)
    const here = accumulatedVd + voltDropPctForSupply(supply, cables, mode)
    out.set(supply.id, here)
    const downstream = supplyByFromNode.get(supply.to_node_id) ?? []
    for (const down of downstream) walk(down, here)
    visiting.delete(supply.id)
  }

  for (const r of roots) walk(r, 0)
  return out
}

/**
 * 1-second short-circuit capacity vs the source fault level. Returns the
 * passing margin (cable rating − required) and a tone.
 *
 * Required SC current at the cable = fault_level_ka (the source's prospective
 * fault current). The cable's tabulated 1 s SC rating must equal or exceed
 * it. Per IEC convention SC duration is < 1 s in typical LV networks but
 * we use the conservative 1 s table value as the comparison basis.
 */
/**
 * Adiabatic conductor constant k (IEC 60364-4-43 Table 43A, the basis of
 * SANS 10142-1 §6.7 fault-withstand): PVC 70→160 °C (140 °C above
 * 300 mm²), XLPE 90→250 °C. XLPE-Al uses 92 — the value the app's own
 * reference library (Aberdare Facts & Figures Table 6.9) displays, 2 %
 * conservative against IEC's 94. PILC returns null: MV paper cables carry
 * tabulated short-circuit ratings in the SANS 97 reference tables instead
 * of an adiabatic estimate.
 */
export function adiabaticK(
  conductor: 'CU' | 'AL',
  insulation: 'PVC' | 'XLPE' | 'PILC',
  sizeMm2: number,
): number | null {
  if (insulation === 'PVC') {
    if (conductor === 'CU') return sizeMm2 > 300 ? 103 : 115
    return sizeMm2 > 300 ? 68 : 76
  }
  if (insulation === 'XLPE') return conductor === 'CU' ? 143 : 92
  return null
}

/**
 * 1-second short-circuit withstand of one conductor in kA, from the
 * adiabatic equation I = k·S/√t at t = 1 s. Feed the result to
 * shortCircuitCheck against the revision's fault_level_ka.
 */
export function withstand1sKa(
  conductor: 'CU' | 'AL',
  insulation: 'PVC' | 'XLPE' | 'PILC',
  sizeMm2: number,
): number | null {
  const k = adiabaticK(conductor, insulation, sizeMm2)
  if (k == null || !Number.isFinite(sizeMm2) || sizeMm2 <= 0) return null
  return (k * sizeMm2) / 1000
}

/**
 * SANS 10142-1 §6.7.1.1 coordination: the protective device rating In must
 * not exceed the cable set's derated capacity Iz, and the design load Ib
 * must not exceed In. Missing breaker data → 'unknown' (nothing to check).
 */
export function breakerCoordinationCheck(
  designLoadA: number | null,
  breakerRatingA: number | null,
  deratedCapacityA: number | null,
): { ok: boolean; tone: 'ok' | 'warning' | 'danger' | 'unknown'; reason: string | null } {
  if (breakerRatingA == null || breakerRatingA <= 0) {
    return { ok: true, tone: 'unknown', reason: null }
  }
  if (deratedCapacityA != null && deratedCapacityA > 0 && breakerRatingA > deratedCapacityA) {
    return {
      ok: false,
      tone: 'danger',
      reason: `In ${breakerRatingA} A > Iz ${Math.round(deratedCapacityA)} A`,
    }
  }
  if (designLoadA != null && designLoadA > breakerRatingA) {
    return {
      ok: false,
      tone: 'warning',
      reason: `Ib ${designLoadA} A > In ${breakerRatingA} A`,
    }
  }
  return { ok: true, tone: 'ok', reason: null }
}

export function shortCircuitCheck(
  cable1sRatingKa: number | null,
  faultLevelKa: number | null,
): { ok: boolean; marginKa: number | null; tone: 'ok' | 'warning' | 'danger' | 'unknown' } {
  if (cable1sRatingKa == null || faultLevelKa == null || faultLevelKa <= 0) {
    return { ok: true, marginKa: null, tone: 'unknown' }
  }
  const margin = cable1sRatingKa - faultLevelKa
  if (margin < 0) return { ok: false, marginKa: margin, tone: 'danger' }
  if (margin < faultLevelKa * 0.10) return { ok: true, marginKa: margin, tone: 'warning' }
  return { ok: true, marginKa: margin, tone: 'ok' }
}

/**
 * Derated current rating for a cable. Pulls the base rating from the
 * `rating_direct_buried` column when installation_method is direct-buried;
 * caller can pass any baseRating and the helper applies the four derate
 * factors as a product (§5.3).
 *
 * Returns null when baseRating is missing or any factor is undefined.
 */
export function deratedRating(
  baseRatingA: number | null | undefined,
  factors: {
    depth?: number | null
    thermal?: number | null
    grouping?: number | null
    temperature?: number | null
  },
): number | null {
  if (baseRatingA == null || !Number.isFinite(baseRatingA)) return null
  // A factor that is explicitly null means a SANS derate table is genuinely
  // missing — we cannot honestly derate, so return null rather than silently
  // treating it as 1. An omitted (undefined) factor still defaults to 1.
  if (
    factors.depth === null || factors.thermal === null ||
    factors.grouping === null || factors.temperature === null
  ) {
    return null
  }
  const product =
    (factors.depth ?? 1) *
    (factors.thermal ?? 1) *
    (factors.grouping ?? 1) *
    (factors.temperature ?? 1)
  if (!Number.isFinite(product) || product <= 0) return null
  return baseRatingA * product
}

/**
 * Utilisation percentage = load / derated rating × 100. Returns null when
 * either input is missing.
 */
export function utilisationPct(
  loadA: number,
  deratedA: number | null,
): number | null {
  if (deratedA == null || deratedA <= 0) return null
  return (loadA / deratedA) * 100
}

/** Threshold-driven status colour. Used by the schedule grid. */
export function vdTone(vdPct: number): 'ok' | 'warning' | 'danger' {
  if (vdPct > 5) return 'danger'
  if (vdPct > 3) return 'warning'
  return 'ok'
}

export function utilisationTone(util: number | null): 'ok' | 'warning' | 'danger' {
  if (util == null) return 'ok'
  if (util > 80) return 'danger'
  if (util > 65) return 'warning'
  return 'ok'
}

/**
 * Result of sizing a parallel cable set against a design load.
 */
export interface ParallelSetResult {
  /** Number of cables in parallel (1..maxN). */
  count: number
  /** Per-cable derated rating at this group size, in A. */
  perCableRatingA: number
  /** count * perCableRatingA, in A. */
  combinedRatingA: number
  /** True when even maxN cables cannot carry the design load. */
  insufficient: boolean
}

/**
 * Smallest number of parallel cables that carries `designLoadA`.
 *
 * Pure + grouping-aware: `ratingForN(n)` must return the per-cable derated
 * rating *when n cables are grouped together* (the grouping derate factor
 * worsens as n rises, so the caller bakes that into ratingForN). Iterates
 * n = 1..maxN and returns the first n where n * ratingForN(n) >= designLoadA.
 * If maxN is still short, returns that n with `insufficient: true`.
 * Returns null when no base rating resolves (ratingForN(1) is null/<=0).
 */
export function requiredParallelSet(
  designLoadA: number,
  ratingForN: (n: number) => number | null,
  maxN = 16,
): ParallelSetResult | null {
  const r1 = ratingForN(1)
  if (r1 == null || !Number.isFinite(r1) || r1 <= 0) return null

  for (let n = 1; n <= maxN; n++) {
    const r = ratingForN(n)
    if (r == null || !Number.isFinite(r) || r <= 0) continue
    if (n * r >= designLoadA) {
      return { count: n, perCableRatingA: r, combinedRatingA: n * r, insufficient: false }
    }
  }

  const rMaxRaw = ratingForN(maxN)
  const rMax = rMaxRaw != null && Number.isFinite(rMaxRaw) && rMaxRaw > 0 ? rMaxRaw : 0
  return { count: maxN, perCableRatingA: rMax, combinedRatingA: rMax * maxN, insufficient: true }
}

/**
 * Combined current capacity of a supply's parallel cable set: the sum of
 * each cable's already-stored derated rating (each parallel cable's stored
 * value already includes its grouping derate). Null ratings count as 0.
 */
export function supplyParallelCapacity(
  cables: Array<{ derated_current_rating_a: number | null }>,
): number {
  return cables.reduce((sum, c) => sum + (c.derated_current_rating_a ?? 0), 0)
}
