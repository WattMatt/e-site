import { describe, it, expect } from 'vitest'
import {
  UNIT_LABELS, COMPONENT_LABELS, TARIFF_CATEGORY_LABELS, formatRandAmount, formatChargeAmount, TOU_LABELS, SEASON_LABELS,
  TARIFF_STRUCTURE_LABELS, TARIFF_VAT_BASIS_LABELS, TARIFF_DAY_TYPE_LABELS, TARIFF_YEAR_STATE_LABELS, SSEG_CREDITING_LABELS,
  SSEG_CARRY_FORWARD_LABELS, SSEG_CAP_RULE_LABELS, SOURCE_DOCUMENT_KIND_LABELS, SOURCE_DOCUMENT_STATUS_LABELS,
  INGEST_JOB_STATUS_LABELS, ERROR_REPORT_STATUS_LABELS, INGEST_YEAR_ACTION_LABELS, TARIFF_CHECK_SEVERITY_LABELS, LICENSEE_KIND_LABELS, labelOf,
} from './labels'
import {
  TARIFF_UNITS, CHARGE_COMPONENTS, TARIFF_CATEGORIES, TARIFF_STRUCTURES, VAT_BASES, CHARGE_DAY_TYPES, YEAR_STATES,
  CREDITING, CARRY_FORWARD, CAP_RULES, SOURCE_DOCUMENT_KINDS, SOURCE_DOCUMENT_STATUSES, LICENSEE_KINDS,
} from '../../tariffs/types'

describe('tariff labels', () => {
  it('labels every stored unit and component (no raw enum reaches the screen)', () => {
    for (const u of TARIFF_UNITS) expect(UNIT_LABELS[u]).toBeTruthy()
    for (const c of CHARGE_COMPONENTS) expect(COMPONENT_LABELS[c]).toBeTruthy()
    for (const c of TARIFF_CATEGORIES) expect(TARIFF_CATEGORY_LABELS[c]).toBeTruthy()
    expect(TOU_LABELS.off_peak).toBe('Off-peak')
    expect(SEASON_LABELS.high).toBe('High demand (winter)')
  })
  it('formats rand with two decimals and comma thousands, never locale-dependent', () => {
    expect(formatRandAmount(3000)).toBe('R3,000.00')
    expect(formatRandAmount(1234567.891)).toBe('R1,234,567.89')
    expect(formatRandAmount(-12.5)).toBe('-R12.50')
    expect(formatRandAmount(0)).toBe('R0.00')
  })
  it('formats a charge amount with its unit', () => {
    expect(formatChargeAmount(250, 'c_per_kWh')).toBe('250.00 c/kWh')
    expect(formatChargeAmount(1.8423, 'R_per_kWh')).toBe('R1.8423/kWh')
    expect(formatChargeAmount(400, 'R_per_month')).toBe('R400.00/month')
    expect(formatChargeAmount(12.5, 'pct')).toBe('12.50 %')
  })
  it('labels every admin-screen enum in words, never the stored token', () => {
    const cases: Array<[readonly string[], Record<string, string>]> = [
      [TARIFF_STRUCTURES, TARIFF_STRUCTURE_LABELS], [VAT_BASES, TARIFF_VAT_BASIS_LABELS], [CHARGE_DAY_TYPES, TARIFF_DAY_TYPE_LABELS],
      [YEAR_STATES, TARIFF_YEAR_STATE_LABELS], [CREDITING, SSEG_CREDITING_LABELS], [CARRY_FORWARD, SSEG_CARRY_FORWARD_LABELS],
      [CAP_RULES, SSEG_CAP_RULE_LABELS], [SOURCE_DOCUMENT_KINDS, SOURCE_DOCUMENT_KIND_LABELS], [SOURCE_DOCUMENT_STATUSES, SOURCE_DOCUMENT_STATUS_LABELS],
      [['queued', 'running', 'succeeded', 'failed'], INGEST_JOB_STATUS_LABELS], [['open', 'resolved', 'rejected'], ERROR_REPORT_STATUS_LABELS],
      [['create', 'replace_draft', 'create_correction', 'replace_correction_draft', 'skip_published', 'skip_unknown_licensee', 'skip_duplicate_licensee'], INGEST_YEAR_ACTION_LABELS],
      [['block', 'review', 'warn'], TARIFF_CHECK_SEVERITY_LABELS], [LICENSEE_KINDS, LICENSEE_KIND_LABELS],
    ]
    for (const [tokens, labels] of cases) {
      expect(Object.keys(labels).sort()).toEqual([...tokens].sort())
      for (const t of tokens) {
        expect(labels[t]).toMatch(/^[A-Z0-9]/)
        expect(labels[t]).not.toContain('_')
      }
    }
    expect(SSEG_CREDITING_LABELS.net_billing_tou).toBe('Net billing, by time-of-use period')
    expect(INGEST_YEAR_ACTION_LABELS.replace_draft).toBe('Replaces the draft')
  })
  it('labelOf falls back to the token for a value outside the map (never a blank cell)', () => {
    expect(labelOf(TARIFF_YEAR_STATE_LABELS, 'in_review')).toBe('In review')
    expect(labelOf(TARIFF_YEAR_STATE_LABELS, 'mystery')).toBe('mystery')
    expect(labelOf(TARIFF_YEAR_STATE_LABELS, null)).toBe('—')
  })
})
