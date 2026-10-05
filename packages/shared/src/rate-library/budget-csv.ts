/**
 * Budget export: one row per catalogue item, keyed by code so a budget
 * workbook can look rates up (XLOOKUP/VLOOKUP on column A). UTF-8 with a BOM
 * so Excel reads "mm²" correctly; CRLF line ends.
 */
export type BudgetStatistic = 'median' | 'p75'

export interface BudgetRow {
  code: string
  description: string
  unit: string
  n: number
  /** The chosen statistic, escalated. Null when it cannot be computed honestly. */
  rate: number | null
  /** The same statistic in nominal (as-priced) money. */
  nominal: number | null
  earliest: string | null
  latest: string | null
}

const HEADER = ['Code', 'Description', 'Unit', 'Statistic', 'Rate (ZAR excl VAT)', 'Nominal rate', 'Observations', 'Earliest', 'Latest', 'Escalated to (CPI month)']

function cell(v: string | number | null): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const money = (n: number | null) => (n === null ? null : n.toFixed(2))

export function budgetCsv(input: { statistic: BudgetStatistic; escalatedTo: string; generatedOn: string; items: BudgetRow[] }): string {
  const lines = [HEADER.join(',')]
  for (const r of input.items) {
    lines.push([r.code, r.description, r.unit, input.statistic, money(r.rate), money(r.nominal), r.n, r.earliest, r.latest, input.escalatedTo].map(cell).join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
