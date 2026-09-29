/**
 * Display vocabulary for the Tariff tab and the tariff library (spec §0.4
 * rule 3: every number shows its unit; units are stored, never inferred).
 * Deterministic formatting: no Intl, no locale.
 */
import type {
  CapRule, CarryForward, ChargeComponent, ChargeDayType, Crediting, LicenseeKind, SourceDocumentKind, SourceDocumentStatus, TariffCategory,
  TariffSeason, TariffStructure, TariffUnit, TouOrAll, VatBasis, YearState,
} from '../../tariffs/types'
import type { TariffIssueSeverity } from '../../tariffs/validators'
import type { YearAction } from '../../tariffs/ingest/ingest-core'

export const UNIT_LABELS: Record<TariffUnit, string> = {
  c_per_kWh: 'c/kWh',
  R_per_kWh: 'R/kWh',
  R_per_month: 'R/month',
  R_per_day: 'R/day',
  R_per_kVA_month: 'R/kVA/month',
  R_per_kW_month: 'R/kW/month',
  R_per_A_month: 'R/A/month',
  c_per_kVArh: 'c/kVArh',
  R_per_POD_day: 'R/POD/day',
  pct: '%',
}

export const COMPONENT_LABELS: Record<ChargeComponent, string> = {
  energy: 'Energy',
  legacy: 'Legacy charge',
  basic: 'Basic charge',
  service: 'Service charge',
  admin: 'Administration charge',
  network_capacity: 'Network capacity',
  network_demand: 'Network demand',
  transmission_network: 'Transmission network',
  gcc: 'Generation capacity (GCC)',
  ancillary: 'Ancillary service',
  ers: 'Electrification & rural subsidy',
  affordability: 'Affordability subsidy',
  lv_subsidy: 'LV subsidy',
  reactive: 'Reactive energy',
  demand: 'Demand',
  capacity_amp: 'Capacity (per amp)',
  export_credit: 'Export credit',
  wheeling_uos: 'Wheeling use-of-system',
  loss_factor: 'Loss factor',
  other: 'Other',
}

/**
 * Named TARIFF_CATEGORY_LABELS (not CATEGORY_LABELS): the root barrel already
 * exports handover's CATEGORY_LABELS (services/handover/folder-templates.ts).
 */
export const TARIFF_CATEGORY_LABELS: Record<TariffCategory, string> = {
  domestic: 'Domestic',
  commercial: 'Commercial',
  industrial: 'Industrial',
  agricultural: 'Agricultural',
  bulk: 'Bulk',
  public_lighting: 'Public lighting',
  sseg: 'SSEG / export',
  wheeling: 'Wheeling',
  other: 'Other',
}

export const SEASON_LABELS: Record<TariffSeason, string> = {
  all: 'All year',
  high: 'High demand (winter)',
  low: 'Low demand (summer)',
}

export const TOU_LABELS: Record<TouOrAll, string> = {
  all: 'All hours',
  peak: 'Peak',
  standard: 'Standard',
  off_peak: 'Off-peak',
}

export const TARIFF_STRUCTURE_LABELS: Record<TariffStructure, string> = {
  flat: 'Flat rate',
  ibt: 'Inclining blocks',
  seasonal: 'Seasonal',
  seasonal_ibt: 'Seasonal, inclining blocks',
  tou: 'Time-of-use',
  tou_ibt: 'Time-of-use, inclining blocks',
}

export const TARIFF_VAT_BASIS_LABELS: Record<VatBasis, string> = {
  stated_excl: 'Excl. VAT (stated)',
  assumed_excl: 'Excl. VAT (assumed)',
  stated_incl: 'Incl. VAT (stated)',
}

export const TARIFF_DAY_TYPE_LABELS: Record<ChargeDayType, string> = {
  all: 'Every day',
  weekday: 'Weekdays',
  saturday: 'Saturdays',
  sunday: 'Sundays',
}

export const LICENSEE_KIND_LABELS: Record<LicenseeKind, string> = {
  eskom: 'Eskom',
  municipal: 'Municipal',
  metro: 'Metro',
  private: 'Private distributor',
  development_agency: 'Development agency',
  industrial_private: 'Industrial (private)',
}

export const TARIFF_YEAR_STATE_LABELS: Record<YearState, string> = {
  ingesting: 'Ingesting',
  in_review: 'In review',
  published: 'Published',
  superseded: 'Superseded',
}

export const SSEG_CREDITING_LABELS: Record<Crediting, string> = {
  net_billing_tou: 'Net billing, by time-of-use period',
  net_billing_flat: 'Net billing, one flat rate',
  none: 'No credit for exports',
}

export const SSEG_CARRY_FORWARD_LABELS: Record<CarryForward, string> = {
  none: 'No carry-forward',
  within_financial_year: 'Carried forward within the financial year',
}

export const SSEG_CAP_RULE_LABELS: Record<CapRule, string> = {
  kwh_per_tou_period: 'Credited kWh capped at imported kWh, per TOU period',
  value_per_tou_period: 'Credit capped at import value, per TOU period',
  energy_charges: 'Credit capped at the energy charges',
}

export const SOURCE_DOCUMENT_KIND_LABELS: Record<SourceDocumentKind, string> = {
  tariff_book: 'Tariff book',
  nersa_decision: 'NERSA decision',
  eskom_schedule: 'Eskom schedule',
  rules: 'Rules',
  by_law: 'By-law',
}

export const SOURCE_DOCUMENT_STATUS_LABELS: Record<SourceDocumentStatus, string> = {
  draft: 'Draft',
  final: 'Final',
  nersa_approved: 'NERSA approved',
}

export const INGEST_JOB_STATUS_LABELS: Record<'queued' | 'running' | 'succeeded' | 'failed', string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
}

export const ERROR_REPORT_STATUS_LABELS: Record<'open' | 'resolved' | 'rejected', string> = {
  open: 'Open',
  resolved: 'Resolved',
  rejected: 'Rejected',
}

export const INGEST_YEAR_ACTION_LABELS: Record<YearAction, string> = {
  create: 'Creates a new draft',
  replace_draft: 'Replaces the draft',
  skip_published: 'Skipped: already published',
  skip_unknown_licensee: 'Skipped: licensee not in the registry',
  skip_duplicate_licensee: 'Skipped: licensee appears twice',
}

export const TARIFF_CHECK_SEVERITY_LABELS: Record<TariffIssueSeverity, string> = {
  block: 'Blocks publishing',
  review: 'Needs review',
  warn: 'Warning',
}

/** A stored token in words; an unknown token shows as itself, a missing one as a dash. */
export function labelOf(labels: Record<string, string>, token: string | null | undefined): string {
  if (token === null || token === undefined || token === '') return '—'
  return labels[token] ?? token
}

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** "R3,000.00"; negative as "-R12.50". Half away from zero at the cent. */
export function formatRandAmount(x: number): string {
  const neg = x < 0
  const cents = Math.round(Math.abs(x) * 100)
  const whole = Math.floor(cents / 100)
  const frac = String(cents % 100).padStart(2, '0')
  return `${neg && cents !== 0 ? '-' : ''}R${groupThousands(String(whole))}.${frac}`
}

/** A stored rate with its unit. Rand-per-kWh keeps 4 dp (tariff books publish 4). */
export function formatChargeAmount(amount: number, unit: TariffUnit): string {
  if (unit === 'c_per_kWh' || unit === 'c_per_kVArh') return `${amount.toFixed(2)} ${UNIT_LABELS[unit]}`
  if (unit === 'pct') return `${amount.toFixed(2)} %`
  if (unit === 'R_per_kWh') return `R${amount.toFixed(4)}/kWh`
  return `${formatRandAmount(amount)}${UNIT_LABELS[unit].slice(1)}`
}
