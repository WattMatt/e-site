/**
 * Cable calculations — pure functions over raw row data.
 *
 * Mirrors the workbook formulas (§5 of the spec) exactly:
 *
 *   volt_drop_pct = ohm_per_km × (length_m / 100) × load_a × (10 / voltage_v)
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
  from_board_id: string | null
  to_board_id: string
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
 * Single-cable volt drop percentage. Uses the workbook shorthand:
 *
 *     vd% = Ω/km × (length_m / 100) × load_a × (10 / voltage_v)
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
  return ohmPerKm * (lengthM / 100) * loadA * (10 / voltageV)
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
 * the supply's `to_board_id` node.
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
  const supplyByFromBoard = new Map<string, SupplyForCalc[]>()
  for (const s of supplies) {
    if (s.from_board_id) {
      const list = supplyByFromBoard.get(s.from_board_id) ?? []
      list.push(s)
      supplyByFromBoard.set(s.from_board_id, list)
    }
  }

  const roots = supplies.filter((s) => s.from_source_id != null)
  const visiting = new Set<string>()

  function walk(supply: SupplyForCalc, accumulatedVd: number) {
    if (visiting.has(supply.id)) return        // cycle guard
    visiting.add(supply.id)
    const here = accumulatedVd + voltDropPctForSupply(supply, cables, mode)
    out.set(supply.id, here)
    const downstream = supplyByFromBoard.get(supply.to_board_id) ?? []
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
