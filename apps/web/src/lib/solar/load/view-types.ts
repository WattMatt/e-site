// apps/web/src/lib/solar/load/view-types.ts
/**
 * View models the Load tab's server loaders hand to client components. JSON only (a function prop
 * across the server → client boundary fails at render, CLAUDE.md 2026-09-22). Type-only imports.
 */
import type { BillsForm, LoadSettingsForm } from '@esite/shared'
import type { BulkReconciliation, MdMonth, ParentReconciliation, SiteLoadCoverage, SiteProfileCharts } from '@esite/shared/solar-load'

export type MeterKind = 'tenant' | 'bulk' | 'council' | 'generator' | 'solar' | 'common' | 'vacant' | 'check' | 'virtual' | 'water' | 'unknown'
export const METER_KIND_OPTIONS: ReadonlyArray<{ value: MeterKind; label: string }> = [
  { value: 'tenant', label: 'Tenant' }, { value: 'bulk', label: 'Bulk' }, { value: 'council', label: 'Council' },
  { value: 'generator', label: 'Generator' }, { value: 'solar', label: 'Solar' }, { value: 'common', label: 'Common area' },
  { value: 'vacant', label: 'Vacant' }, { value: 'check', label: 'Check' }, { value: 'virtual', label: 'Virtual (multi-serial)' },
  { value: 'water', label: 'Water' }, { value: 'unknown', label: 'Unknown' },
]
/** Units the commit route accepts (== COMMITTABLE_UNITS in meter-import/commit.ts; contract-tested). */
export const UNIT_OPTIONS = ['kW', 'W', 'MW', 'kWh', 'Wh', 'MWh', 'kvar', 'kvarh', 'kVA', 'kVAh', 'V', 'A', 'PF'] as const
export const ARCHETYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'retail', label: 'Retail' }, { value: 'fast_food', label: 'Fast food' }, { value: 'restaurant', label: 'Restaurant' },
  { value: 'supermarket', label: 'Supermarket (refrigeration)' }, { value: 'office_bank', label: 'Bank / office' },
  { value: 'gym', label: 'Gym' }, { value: 'anchor_24h', label: 'Anchor (24 h)' }, { value: 'vacant', label: 'Vacant' },
]

export interface NodeOption { id: string; label: string; shopNumber: string | null }

export interface MeterView {
  id: string
  label: string
  kind: MeterKind
  siteLabel: string | null
  serials: string[]
  nodeId: string | null
  tenantLabel: string | null
  shopNo: string | null
  areaM2: number | null
  supplyPointConfirmed: boolean
  updatedAt: string
  primaryChannelId: string | null
  intervalMin: number | null
  periodStart: string | null
  periodEnd: string | null
  completeness: number | null
  peakKw: number | null
  annualKwh: number | null
  fileIds: string[]
  otherStudyLinks: number
  status: 'imported' | 'no_data'
}
export interface RegisterRowView {
  id: string
  siteLabel: string | null
  fileName: string | null
  tenantName: string | null
  shopNo: string | null
  areaM2: number | null
  matchMethod: string
  confirmed: boolean
  fileImported: boolean
}
export interface MetersView {
  studyId: string | null
  orgId: string
  meters: MeterView[]
  nodes: NodeOption[]
  register: RegisterRowView[]
  cloudMapped: boolean
  isGrantor: boolean
  bulkRecon: BulkReconciliation[]
}

export interface TenantBasisView {
  id: string
  source: 'metered' | 'synthesised' | 'excluded'
  meters: Array<{ meterId: string; weight: number }>
  archetype: string | null
  densityOverride: number | null
  updatedAt: string
}
export interface TenantRowView {
  nodeId: string
  shopNumber: string | null
  name: string
  category: string | null
  areaM2: number | null
  boDate: string | null
  basis: TenantBasisView | null
  summary: { source: string; annualKwh: number; peakKw: number; wPerM2: number | null } | null
  vacant: boolean
  defaultDensity: number
  defaultArchetype: string
}
export interface AutoMatchView {
  nodeId: string
  nodeLabel: string
  meterId: string
  meterLabel: string
  source: string
  confidence: 'high' | 'medium' | 'low'
  preTicked: boolean
  note: string
}
export interface TenantsView {
  studyId: string | null
  studyUpdatedAt: string | null
  commonAreaPct: number
  tenants: TenantRowView[]
  studyMeters: Array<{ id: string; label: string; kind: MeterKind }>
  proposals: AutoMatchView[]
}

export interface SiteLoadView {
  basis: 'S1' | 'S2' | 'S3' | 'S4'
  referenceYear: number
  builtAt: string
  stale: boolean
  charts: SiteProfileCharts
  coverage: SiteLoadCoverage
  md: MdMonth[]
  designMdKw: number | null
  bulkRecon: BulkReconciliation[]
  parentRecon: ParentReconciliation[]
}
export interface ProfileView {
  studyId: string | null
  studyUpdatedAt: string | null
  form: LoadSettingsForm
  bills: BillsForm
  diversityApplies: boolean
  years: number[]
  siteLoad: SiteLoadView | null
}

export interface CheckView {
  key: string
  severity: 'error' | 'warning' | 'info'
  message: string
  meterId?: string
  nodeId?: string
  ack: { at: string; note: string | null } | null
}
export interface ImportReportView {
  fileId: string
  fileName: string
  format: string | null
  acceptedAt: string | null
  errors: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
}
export interface ChecksView { studyId: string | null; builtAt: string | null; checks: CheckView[]; imports: ImportReportView[] }

export type RebuildEvent =
  | { type: 'progress'; stage: 'reading' | 'building' | 'saving'; done: number; total: number }
  | { type: 'done'; siteLoadId: string; basis: string; referenceYear: number; checks: number }
  | { type: 'error'; code: string; message: string }
