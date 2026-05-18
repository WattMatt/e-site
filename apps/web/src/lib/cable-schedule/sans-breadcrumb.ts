/**
 * Derive the SANS lookup breadcrumb for a cable run / strand — which table
 * was used for the base current rating, which derate tables fed each axis,
 * and the multiplicative chain from base rating → final derated rating.
 *
 * Pure projection of fields already stored on `EnrichedCable` / `EnrichedRun`
 * (size_mm2, conductor, insulation, cores, ambient_temp_c, depth_mm,
 * grouped_with, derate_*, derated_current_rating_a). No DB lookup — the
 * authoritative computation lives in cable-entities.actions.ts at the
 * moment a cable is created or its inputs change.
 *
 * This is the A3 audit gap: surface the SANS table coverage so an
 * engineer reviewing the schedule can verify "yes, this 240 mm² XLPE
 * Cu cable was rated against SANS 10142-1 Table 6.4 with derates from
 * 6.3.1 / 6.3.2 / 6.3.4 / 6.3.6".
 */

import { tableCodeFor } from '@esite/shared'
import type { EnrichedRun, EnrichedCable } from './export-payload'

export interface SansBreadcrumb {
  /** Bundled SANS rating-table code, e.g. 'TABLE_6_4'. Null when no
   *  mapping exists (PILC / single-core; engineer must fill manually). */
  ratingTableCode: string | null
  /** Pretty-printable form, e.g. '10142-1 T6.4'. */
  ratingTableLabel: string | null
  /** Derate table codes (always SANS 1507 LV — fixed per axis). Each may be
   *  null if the corresponding derate was not applied (factor null/1). */
  derateSources: Array<{
    axis: 'temp' | 'depth' | 'thermal' | 'grouping'
    tableCode: string
    tableLabel: string
    factor: number | null
    inputValue: number | null
    inputUnit: string
  }>
  /** Final derated rating in amps, copied from the row. */
  deratedRatingA: number | null
  /** Base rating before derates, in amps. Back-computed:
   *  derated ÷ (f_depth × f_thermal × f_grouping × f_temp). */
  baseRatingA: number | null
}

const TABLE_LABEL: Record<string, string> = {
  TABLE_6_2:   '10142-1 T6.2 (LV PVC, Cu)',
  TABLE_6_3:   '10142-1 T6.3 (LV PVC, Al)',
  TABLE_6_4:   '10142-1 T6.4 (LV XLPE, Cu)',
  TABLE_6_5:   '10142-1 T6.5 (LV XLPE, Al)',
  TABLE_6_3_1: '1507-1 T6.3.1 (depth)',
  TABLE_6_3_2: '1507-1 T6.3.2 (thermal resistivity)',
  TABLE_6_3_4: '1507-1 T6.3.4 (ground / ambient temp)',
  TABLE_6_3_6: '1507-1 T6.3.6 (grouping, touching)',
}

/** Subset of run / strand fields the breadcrumb needs. */
type Sansable = Pick<
  EnrichedCable,
  | 'size_mm2'
  | 'cores'
  | 'conductor'
  | 'insulation'
  | 'ambient_temp_c'
  | 'depth_mm'
  | 'grouped_with'
  | 'derated_current_rating_a'
> & {
  derate_depth?: number | null
  derate_thermal?: number | null
  derate_grouping?: number | null
  derate_temp?: number | null
}

/** Coerce a run or a strand into the minimal subset the breadcrumb needs. */
function toSansable(input: EnrichedRun | EnrichedCable | Sansable): Sansable {
  // EnrichedRun + EnrichedCable both expose size_mm2 / cores / conductor /
  // insulation directly. The derate_* fields and ambient_temp_c live on the
  // first strand only (run header reads from cables[0]); fall back through
  // it when called with a bare run.
  if ('cables' in input && Array.isArray((input as EnrichedRun).cables)) {
    const head = (input as EnrichedRun).cables[0] as (EnrichedCable & Partial<Sansable>) | undefined
    return {
      size_mm2: (input as EnrichedRun).size_mm2,
      cores: (input as EnrichedRun).cores,
      conductor: (input as EnrichedRun).conductor,
      insulation: (input as EnrichedRun).insulation,
      ambient_temp_c: head?.ambient_temp_c ?? 30,
      depth_mm: (input as EnrichedRun).depth_mm,
      grouped_with: (input as EnrichedRun).grouped_with,
      derated_current_rating_a: head?.derated_current_rating_a ?? null,
      derate_depth:    head?.derate_depth ?? null,
      derate_thermal:  head?.derate_thermal ?? null,
      derate_grouping: head?.derate_grouping ?? null,
      derate_temp:     head?.derate_temp ?? null,
    }
  }
  return input as Sansable
}

export function sansBreadcrumb(input: EnrichedRun | EnrichedCable | Sansable): SansBreadcrumb {
  const c = toSansable(input)
  const ratingTableCode = tableCodeFor(c.conductor, c.insulation, c.cores)
  const ratingTableLabel = ratingTableCode ? TABLE_LABEL[ratingTableCode] ?? ratingTableCode : null

  const derateSources: SansBreadcrumb['derateSources'] = [
    {
      axis: 'temp',
      tableCode: 'TABLE_6_3_4',
      tableLabel: TABLE_LABEL.TABLE_6_3_4!,
      factor: c.derate_temp ?? null,
      inputValue: c.ambient_temp_c ?? null,
      inputUnit: '°C',
    },
    {
      axis: 'depth',
      tableCode: 'TABLE_6_3_1',
      tableLabel: TABLE_LABEL.TABLE_6_3_1!,
      factor: c.derate_depth ?? null,
      inputValue: c.depth_mm ?? null,
      inputUnit: 'mm',
    },
    {
      axis: 'thermal',
      tableCode: 'TABLE_6_3_2',
      tableLabel: TABLE_LABEL.TABLE_6_3_2!,
      factor: c.derate_thermal ?? null,
      // thermal_resistivity_kmw isn't on EnrichedCable / Run today
      inputValue: null,
      inputUnit: 'K·m/W',
    },
    {
      axis: 'grouping',
      tableCode: 'TABLE_6_3_6',
      tableLabel: TABLE_LABEL.TABLE_6_3_6!,
      factor: c.derate_grouping ?? null,
      inputValue: c.grouped_with ?? null,
      inputUnit: 'cables',
    },
  ]

  const product = derateSources.reduce((p, d) => p * (d.factor ?? 1), 1)
  const deratedRatingA = c.derated_current_rating_a ?? null
  const baseRatingA =
    deratedRatingA != null && product > 0
      ? Math.round(deratedRatingA / product)
      : null

  return { ratingTableCode, ratingTableLabel, derateSources, deratedRatingA, baseRatingA }
}

/**
 * Render the breadcrumb as a plain-text tooltip body. The grid passes this
 * to `title=` on the rating cell; the SansCoverageBadge formats the same
 * data with HTML structure.
 */
export function sansBreadcrumbAsTooltip(b: SansBreadcrumb): string {
  if (!b.ratingTableCode) {
    return 'No SANS rating mapping for this conductor / insulation / cores combination. ' +
           'Engineer must enter Ω/km and rating manually, or pick a different size.'
  }
  const lines: string[] = []
  lines.push(`Base rating from SANS ${b.ratingTableLabel}` + (b.baseRatingA != null ? ` ≈ ${b.baseRatingA} A` : ''))
  for (const d of b.derateSources) {
    if (d.factor == null) continue
    const lhs = d.inputValue != null ? `${d.inputValue} ${d.inputUnit}` : ''
    lines.push(`  × ${d.factor.toFixed(2)} (${d.tableLabel}${lhs ? ` @ ${lhs}` : ''})`)
  }
  if (b.deratedRatingA != null) {
    lines.push(`= ${b.deratedRatingA} A derated`)
  }
  return lines.join('\n')
}
