/**
 * Shared (size, conductor) cost aggregation for cable-schedule exports.
 *
 * Excel / PDF / CSV cost renderers previously reimplemented this map +
 * sort + cost-line seeding three times. Three independent reviewers
 * flagged the duplication on T1/T2/T3 of the 2026-05-18 exports build —
 * with a fourth caller (Avery label sheet) now landed, the case for
 * extraction crosses the YAGNI threshold.
 *
 * Returns one row per distinct (size, conductor) pair found in either
 * the cables iteration OR the costLines table. Sorted by size asc,
 * then conductor alphabetical (AL before CU).
 */

interface CableInput {
  size_mm2: number
  conductor: 'CU' | 'AL'
  confirmed_length_m: number | null
  measured_length_m: number | null
}

interface CostLineInput {
  size_mm2: number
  conductor: 'CU' | 'AL'
}

export interface CostAggregate {
  size: number
  conductor: 'CU' | 'AL'
  totalLength: number
  /** number of cables contributing (0 if seeded from costLines with no matching cable) */
  count: number
}

export function aggregateCostByMaterialKey(
  cables: readonly CableInput[],
  costLines: readonly CostLineInput[],
): CostAggregate[] {
  const totalsByKey = new Map<string, CostAggregate>()

  // Iterate cables — primary source of length + count
  for (const c of cables) {
    const key = `${c.size_mm2}|${c.conductor}`
    const agg = totalsByKey.get(key) ?? {
      size: c.size_mm2,
      conductor: c.conductor,
      totalLength: 0,
      count: 0,
    }
    const len = c.confirmed_length_m ?? c.measured_length_m ?? 0
    agg.totalLength += len
    agg.count += 1
    totalsByKey.set(key, agg)
  }

  // Seed cost_lines so (size, conductor) pairs that have rates but no
  // matching cables still surface as zero-length zero-count rows
  for (const cl of costLines) {
    const key = `${cl.size_mm2}|${cl.conductor}`
    if (!totalsByKey.has(key)) {
      totalsByKey.set(key, {
        size: cl.size_mm2,
        conductor: cl.conductor,
        totalLength: 0,
        count: 0,
      })
    }
  }

  // Sort: size asc primary, then conductor alphabetical
  // (AL before CU since 'A' < 'C' — gives Al rows above Cu at same size)
  return Array.from(totalsByKey.values()).sort((a, b) => {
    if (a.size !== b.size) return a.size - b.size
    return a.conductor.localeCompare(b.conductor)
  })
}
