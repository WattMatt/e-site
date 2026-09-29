/** PostgREST rows -> the JSON the Tariff tab renders (numbers arrive as strings). */
import type {
  ChargeComponent, SourceLocator, TariffCategory, TariffListItem, TariffMetering, TariffStructure, TariffUnit, TariffYearOption,
  TouCalendarRow, TouWindow, ExportRateRow,
} from '@esite/shared'

type Row = Record<string, unknown>
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export interface PinnedCharge {
  id: string
  component: ChargeComponent
  season: string
  tou: string
  dayType: string
  blockMin: number | null
  blockMax: number | null
  unit: TariffUnit
  amount: number
  vatBasis: string
  sourceDocumentId: string | null
  sourceTitle: string | null
  locator: SourceLocator
}

export interface BillCheckRow {
  id: string
  month: string
  actual: number
  modelled: number
  differencePct: number
  createdAt: string
}

export function tariffListItemFromRow(r: Row): TariffListItem {
  return {
    id: String(r.id), code: (r.code ?? null) as string | null, name: String(r.name), category: r.category as TariffCategory,
    metering: r.metering as TariffMetering, structure: r.structure as TariffStructure, voltageBand: (r.voltage_band ?? null) as string | null,
    phase: (r.phase ?? null) as 'single' | 'three' | null, minKva: num(r.min_kva), maxKva: num(r.max_kva),
    minAmps: num(r.min_amps), maxAmps: num(r.max_amps), isLegacy: Boolean(r.is_legacy), exportTariffId: (r.export_tariff_id ?? null) as string | null,
  }
}

export function yearOptionFromRow(r: Row): TariffYearOption {
  return {
    id: String(r.id), financialYear: String(r.financial_year), state: r.state as 'published' | 'superseded',
    effectiveFrom: String(r.effective_from), effectiveTo: String(r.effective_to), approvedIncreasePct: num(r.approved_increase_pct),
  }
}

export function pinnedChargeFromRow(r: Row, titles: ReadonlyMap<string, string>): PinnedCharge {
  const doc = (r.source_document_id ?? null) as string | null
  return {
    id: String(r.id), component: r.component as ChargeComponent, season: String(r.season), tou: String(r.tou), dayType: String(r.day_type),
    blockMin: num(r.block_min_kwh), blockMax: num(r.block_max_kwh), unit: r.unit as TariffUnit, amount: Number(r.amount_excl_vat),
    vatBasis: String(r.vat_basis), sourceDocumentId: doc, sourceTitle: doc ? titles.get(doc) ?? null : null,
    locator: (r.source_locator ?? {}) as SourceLocator,
  }
}

export function exportRateFromRow(r: Row): ExportRateRow & { id: string } {
  return {
    id: String(r.id), season: r.season as ExportRateRow['season'], tou: r.tou as ExportRateRow['tou'],
    unit: r.unit as ExportRateRow['unit'], amountExclVat: Number(r.amount_excl_vat),
  }
}

export function billCheckFromRow(r: Row): BillCheckRow {
  return {
    id: String(r.id), month: String(r.billing_month).slice(0, 7), actual: Number(r.actual_total_excl_vat),
    modelled: Number(r.modelled_total_excl_vat), differencePct: Number(r.difference_pct), createdAt: String(r.created_at),
  }
}

export function calendarRowFromDb(r: Row, holiday: 'saturday' | 'sunday' | null): TouCalendarRow {
  return {
    id: String(r.id), licenseeId: String(r.licensee_id), validFrom: String(r.valid_from), validTo: (r.valid_to ?? null) as string | null,
    highSeasonMonths: ((r.high_season_months ?? []) as number[]).map(Number), source: r.source as TouCalendarRow['source'], holidayTreatedAs: holiday,
  }
}

export function windowFromDb(r: Row): TouWindow {
  return {
    season: r.season as TouWindow['season'], dayType: r.day_type as TouWindow['dayType'],
    startMinute: Number(r.start_minute), endMinute: Number(r.end_minute), period: r.period as TouWindow['period'],
  }
}

export function isTouTariff(structure: string, charges: ReadonlyArray<{ tou: string }>): boolean {
  return structure === 'tou' || structure === 'tou_ibt' || charges.some((c) => c.tou !== 'all')
}
