/**
 * The JSON the Load profile page and its exports are built from. Everything is computed on the
 * server; the browser only draws it (no load maths in the client bundle).
 */
import type { ImportQuality, NmdBasis, SiteProfileKpis } from '@esite/shared/load-profile'

export type SourceKind = 'meter' | 'tenant_schedule' | 'admd' | 'library_meter'
export type { LoadRole } from '@esite/shared/load-profile'
import type { LoadRole } from '@esite/shared/load-profile'

export interface SourceView {
  id: string
  kind: SourceKind
  label: string
  included: boolean
  status: 'ok' | 'error'
  error: string | null
  /** meter */
  fileName: string | null
  format: string | null
  column: string | null
  kvaColumn: string | null
  intervalMin: number | null
  conversion: string | null
  quality: ImportQuality | null
  filled: { gapShort: number; gapDayType: number; ownShape: number } | null
  window: { start: string; end: string } | null
  /** synthetic */
  params: Record<string, unknown> | null
  detail: string | null
  /** this source's own contribution over the reference year */
  annualKwh: number | null
  peakKw: number | null
  role: LoadRole
  /** true when this source is part of the profile's sum (its role and the bulk rule allow it) */
  counted: boolean
}

export interface MdMonthView { month: string; kva: number; kw: number | null; at: string | null; source: string }

export interface AnalysisView {
  kpis: SiteProfileKpis
  monthlyKwh: number[]
  dayTypeProfiles: { weekday: number[]; saturday: number[]; sunday: number[] }
  seasonal: { high: number[]; low: number[] }
  avgDayByMonth: number[][]
  annual: Array<{ day: string; min: number; mean: number; max: number }>
  ldc: Array<{ pct: number; kw: number }>
  heatmap: { dates: string[]; cells: number[][] }
  md: { months: MdMonthView[]; peak: { kva: number; kw: number | null; at: string; source: string }; intervalMin: number; basis: 'single' | 'coincident' | 'largest_single_meter' | 'sum_of_meter_peaks' } | null
  nmd: { kva: number; basis: NmdBasis; basisKva: number; rule: string }
  composition: { measuredKwh: number; syntheticKwh: number }
  /** The 8 760 hourly kW values (exports only; the page does not send them to the browser). */
  hourly?: number[]
}

export interface CostLineView { label: string; quantity: number; quantityUnit: string; rate: number; rateUnit: string; amount: number }
export interface CostMonthView {
  month: number
  tou: { peak: number; standard: number; off_peak: number }
  kwh: number
  mdKva: number | null
  totalExclVat: number
  vat: number
  totalInclVat: number
  lines: CostLineView[]
}
export type CostView =
  | {
      ok: true
      tariffId: string
      label: string
      calendarAssumedEskom: boolean
      /** false when costed under the neutral calendar (no seasonal/TOU charges): the period split is meaningless. */
      touSplit: boolean
      calendarNote: string | null
      nmdKva: number
      /** true when no NMD was confirmed: costing then uses the highest demand itself (no headroom). */
      nmdIsSuggestion: boolean
      months: CostMonthView[]
      annual: { kwh: number; tou: { peak: number; standard: number; off_peak: number }; totalExclVat: number; vat: number; totalInclVat: number }
      notModelled: Array<{ component: string; reason: string }>
      demandNote: string
    }
  | { ok: false; tariffId: string; error: string }

export interface LoadProfileView {
  projectId: string
  projectName: string
  canEdit: boolean
  profileId: string | null
  settings: { referenceYear: number; powerFactor: number; nmdKva: number | null; tariffId: string | null }
  sources: SourceView[]
  tenants: { count: number; withArea: number; totalAreaM2: number }
  analysis: AnalysisView | null
  cost: CostView | null
  /** Which sources make up the profile and why (bulk vs tenants, what is shown but not added). */
  compositionNote: string | null
}
