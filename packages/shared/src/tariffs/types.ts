/**
 * Canonical tariff model — docs/solar/03-data-model-and-security.md §4.
 * Mirrors the tariffs.* tables (camelCase here, snake_case in Postgres).
 * Amounts are VAT-exclusive; every charge carries an explicit unit, and a
 * unit that was inferred rather than read says so (unitInferred + reason).
 */

export const TARIFF_UNITS = [
  'c_per_kWh', 'R_per_kWh', 'R_per_month', 'R_per_day', 'R_per_kVA_month',
  'R_per_kW_month', 'R_per_A_month', 'c_per_kVArh', 'R_per_POD_day', 'pct',
] as const
export type TariffUnit = (typeof TARIFF_UNITS)[number]

export const CHARGE_COMPONENTS = [
  'energy', 'legacy', 'basic', 'service', 'admin', 'network_capacity', 'network_demand',
  'transmission_network', 'gcc', 'ancillary', 'ers', 'affordability', 'lv_subsidy',
  'reactive', 'demand', 'capacity_amp', 'export_credit', 'wheeling_uos', 'loss_factor', 'other',
] as const
export type ChargeComponent = (typeof CHARGE_COMPONENTS)[number]

export const TARIFF_SEASONS = ['all', 'high', 'low'] as const
export type TariffSeason = (typeof TARIFF_SEASONS)[number]
/** A billing month is always in one season. */
export type BillingSeason = Exclude<TariffSeason, 'all'>

export const TOU_PERIODS = ['peak', 'standard', 'off_peak'] as const
export type TouPeriod = (typeof TOU_PERIODS)[number]
export type TouOrAll = TouPeriod | 'all'

export const CHARGE_DAY_TYPES = ['all', 'weekday', 'saturday', 'sunday'] as const
export type ChargeDayType = (typeof CHARGE_DAY_TYPES)[number]

export const TARIFF_STRUCTURES = ['flat', 'ibt', 'seasonal', 'seasonal_ibt', 'tou', 'tou_ibt'] as const
export type TariffStructure = (typeof TARIFF_STRUCTURES)[number]

export const TARIFF_CATEGORIES = [
  'domestic', 'commercial', 'industrial', 'agricultural', 'bulk', 'public_lighting', 'sseg', 'wheeling', 'other',
] as const
export type TariffCategory = (typeof TARIFF_CATEGORIES)[number]

export const TARIFF_METERING = ['prepaid', 'conventional', 'both', 'unmetered'] as const
export type TariffMetering = (typeof TARIFF_METERING)[number]

export const VAT_BASES = ['stated_excl', 'assumed_excl', 'stated_incl'] as const
export type VatBasis = (typeof VAT_BASES)[number]

export const DEMAND_BASES = ['nmd', 'actual_md', 'peak_window_md', 'utilised_capacity'] as const
export type DemandBasis = (typeof DEMAND_BASES)[number]

export const BLOCK_BASES = ['monthly', 'daily'] as const
export type BlockBasis = (typeof BLOCK_BASES)[number]

export const EXTRACTION_METHODS = ['parser', 'ai', 'manual'] as const
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number]

export const LICENSEE_KINDS = ['eskom', 'municipal', 'metro', 'private', 'development_agency', 'industrial_private'] as const
export type LicenseeKind = (typeof LICENSEE_KINDS)[number]

export const YEAR_STATES = ['ingesting', 'in_review', 'published', 'superseded'] as const
export type YearState = (typeof YEAR_STATES)[number]

export const CREDITING = ['net_billing_tou', 'net_billing_flat', 'none'] as const
export type Crediting = (typeof CREDITING)[number]

export const CARRY_FORWARD = ['none', 'within_financial_year'] as const
export type CarryForward = (typeof CARRY_FORWARD)[number]

export const CAP_RULES = ['kwh_per_tou_period', 'value_per_tou_period', 'energy_charges'] as const
export type CapRule = (typeof CAP_RULES)[number]

export const LOSS_FACTOR_KINDS = ['dx_urban', 'dx_rural', 'tx'] as const
export type LossFactorKind = (typeof LOSS_FACTOR_KINDS)[number]

export const SOURCE_DOCUMENT_KINDS = ['tariff_book', 'nersa_decision', 'eskom_schedule', 'rules', 'by_law'] as const
export type SourceDocumentKind = (typeof SOURCE_DOCUMENT_KINDS)[number]

export const SOURCE_DOCUMENT_STATUSES = ['draft', 'final', 'nersa_approved'] as const
export type SourceDocumentStatus = (typeof SOURCE_DOCUMENT_STATUSES)[number]

/** Where a fact came from: enough to put it beside its sheet cell or PDF line. */
export interface SourceLocator {
  file_sha256?: string
  sheet?: string
  row?: number
  col?: string
  cell?: string
  page?: number
  line?: number
  label?: string
  raw_text?: string
  raw_unit?: string | null
  /** Eskom prints excl and incl VAT side by side; the incl value proves x(1+VAT). */
  raw_incl?: number
}

export interface Charge {
  component: ChargeComponent
  season: TariffSeason
  tou: TouOrAll
  dayType: ChargeDayType
  /** Half-open [min, max) in kWh; max null = unbounded. Null min = not a block. */
  blockMinKwh: number | null
  blockMaxKwh: number | null
  blockBasis: BlockBasis | null
  unit: TariffUnit
  demandBasis: DemandBasis | null
  amountExclVat: number
  vatRate: number
  vatBasis: VatBasis
  unitInferred: boolean
  inferenceReason: string | null
  sourceLocator: SourceLocator
  extractionMethod: ExtractionMethod
  /** The source label, kept for review and labels on the bill; stored inside source_locator. */
  label?: string
  reviewedAt?: string | null
}

export interface Tariff {
  code: string | null
  name: string
  family: string | null
  category: TariffCategory
  metering: TariffMetering
  structure: TariffStructure
  voltageBand: string | null
  phase: 'single' | 'three' | null
  transmissionZone: number | null
  localAuthority: boolean
  minAmps: number | null
  maxAmps: number | null
  minKva: number | null
  maxKva: number | null
  isLegacy: boolean
  notes: string | null
  charges: Charge[]
  /** Bill code of the export (Gen-offset) tariff in the same year; resolved to export_tariff_id on insert. */
  exportTariffCode: string | null
  sourceLocator: SourceLocator
}

export interface SsegRule {
  crediting: Crediting
  carryForward: CarryForward
  fyEndMonth: number
  capRule: CapRule
  offsets: 'energy_only'
  forfeitOnOwnershipChange: boolean
  maxKva: number
  requiresTou: boolean
  requiresBidirectionalMeter: boolean
  locator: Record<string, string>
}

export interface LossFactor {
  kind: LossFactorKind
  voltageBand: string | null
  transmissionZone: number | null
  factor: number
  sourceLocator: SourceLocator
}

export interface TouKwh {
  peak: number
  standard: number
  off_peak: number
}

/** One billing month of one point of delivery, already split by TOU period. */
export interface MonthUsage {
  year: number
  /** 1..12 */
  month: number
  days: number
  season: BillingSeason
  importKwh: TouKwh
  exportKwh?: TouKwh
  maxDemandKva?: number | null
  maxDemandKw?: number | null
  peakWindowMdKva?: number | null
  nmdKva?: number | null
  ampsRating?: number | null
  kvarh?: number | null
}

export function makeCharge(p: Partial<Charge> & Pick<Charge, 'component' | 'unit' | 'amountExclVat'>): Charge {
  return {
    season: 'all',
    tou: 'all',
    dayType: 'all',
    blockMinKwh: null,
    blockMaxKwh: null,
    blockBasis: null,
    demandBasis: null,
    vatRate: 0.15,
    vatBasis: 'assumed_excl',
    unitInferred: false,
    inferenceReason: null,
    sourceLocator: {},
    extractionMethod: 'manual',
    ...p,
  }
}

export function makeTariff(p: Partial<Tariff> & Pick<Tariff, 'name' | 'structure' | 'charges'>): Tariff {
  return {
    code: null,
    family: null,
    category: 'other',
    metering: 'both',
    voltageBand: null,
    phase: null,
    transmissionZone: null,
    localAuthority: false,
    minAmps: null,
    maxAmps: null,
    minKva: null,
    maxKva: null,
    isLegacy: false,
    notes: null,
    exportTariffCode: null,
    sourceLocator: {},
    ...p,
  }
}
