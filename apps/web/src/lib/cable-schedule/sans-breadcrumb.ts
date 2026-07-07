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

import { tableCodeFor, deratingBasis } from '@esite/shared'
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

/**
 * Honest provenance labels (2026-07 correction).
 *
 * The rating tables are the firm's transcription of the Aberdare Facts &
 * Figures booklet — F&F table numbering, for cables manufactured to the
 * SANS 1507 product standards. They are NOT tables inside SANS 10142-1:
 * the PVC ratings are numerically the same dataset as SANS 10142-1 T6.8 /
 * T6.4(a), while 10142-1 publishes NO XLPE ampacity tables at all (T6.4/6.5
 * are manufacturer data). The derating suite is F&F 6.3.x, equivalent to
 * SANS 10142-1:2017 Tables 6.10–6.16 — SANS 1507 publishes no derating
 * tables (the old '1507-1' attribution here was wrong on every count).
 */
const TABLE_LABEL: Record<string, string> = {
  TABLE_6_2:   'Aberdare F&F T6.2 — LV PVC Cu to SANS 1507-3 (ratings = SANS 10142-1 T6.8/6.4(a))',
  TABLE_6_3:   'Aberdare F&F T6.3 — LV PVC Al to SANS 1507-3 (ratings = SANS 10142-1 T6.8/6.4(a))',
  TABLE_6_4:   'Aberdare F&F T6.4 — LV XLPE Cu to SANS 1507-4 (manufacturer data; not in 10142-1)',
  TABLE_6_5:   'Aberdare F&F T6.5 — LV XLPE Al to SANS 1507-4 (manufacturer data; not in 10142-1)',
  TABLE_6_3_1: 'F&F T6.3.1 depth of laying (cf. SANS 10142-1:2017 Tables 6.10–6.16)',
  TABLE_6_3_2: 'F&F T6.3.2 soil thermal resistivity (cf. SANS 10142-1:2017 Tables 6.10–6.16)',
  TABLE_6_3_3: 'F&F T6.3.3 grouping, buried / in ducts (= SANS 10142-1:2017 Table 6.13)',
  TABLE_6_3_4: 'F&F T6.3.4 ground ambient (cf. SANS 10142-1:2017 Tables 6.10–6.16)',
  TABLE_6_3_5: 'F&F T6.3.5 air ambient (cf. SANS 10142-1:2017 Tables 6.10–6.16)',
  TABLE_6_3_6: 'F&F T6.3.6 grouping in air (cf. SANS 10142-1:2017 Tables 6.10–6.16)',
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
  /** Selects which grouping (6.3.3 buried/duct vs 6.3.6 air) and ambient
   *  (6.3.4 ground vs 6.3.5 air) tables the derate factors came from —
   *  mirrors deratingBasis in the shared lookup. Omitted → in-air. */
  installation_method?: string | null
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
      installation_method: (input as EnrichedRun).installation_method,
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

  // Which ambient / grouping tables the stored factors came from depends on
  // the installation method — same branch the shared lookup takes
  // (deratingBasis): in-air reads 6.3.5 + 6.3.6, ground/duct reads 6.3.4 +
  // the much harsher buried-grouping matrix 6.3.3.
  const basis = deratingBasis(c.installation_method ?? null)
  const temperatureTable = basis.temperatureTable
  const groupingTable = basis.inAir ? 'TABLE_6_3_6' : 'TABLE_6_3_3'

  const derateSources: SansBreadcrumb['derateSources'] = [
    {
      axis: 'temp',
      tableCode: temperatureTable,
      tableLabel: TABLE_LABEL[temperatureTable]!,
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
      tableCode: groupingTable,
      tableLabel: TABLE_LABEL[groupingTable]!,
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
  lines.push(`Base rating from ${b.ratingTableLabel}` + (b.baseRatingA != null ? ` ≈ ${b.baseRatingA} A` : ''))
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
