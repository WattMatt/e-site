/** Distributor financial years: Eskom 1 Apr – 31 Mar, municipal 1 Jul – 30 Jun. */
export type TariffRegime = 'eskom' | 'municipal'

const FY = /^(\d{4})\/(\d{2})$/

export function parseFinancialYear(fy: string): { startYear: number } {
  const m = FY.exec(fy)
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) {
    throw new RangeError(`not a financial year: "${fy}" (expected e.g. 2026/27)`)
  }
  return { startYear: Number(m[1]) }
}

export function previousFinancialYear(fy: string): string {
  const s = parseFinancialYear(fy).startYear - 1
  return `${s}/${String((s + 1) % 100).padStart(2, '0')}`
}

export function effectiveDates(regime: TariffRegime, fy: string): { from: string; to: string } {
  const { startYear } = parseFinancialYear(fy)
  return regime === 'eskom'
    ? { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` }
    : { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30` }
}

/** The month whose close resets a net-billing credit balance (Net-Billing Rules §7.1(d)). */
export function fyEndMonth(regime: TariffRegime): number {
  return regime === 'eskom' ? 3 : 6
}
