import { FEATURE_PRICES, formatRandWhole } from '@esite/shared'

/**
 * The Solar annual price. Phase 1B adds FEATURE_PRICES.solar; until that
 * branch is merged underneath this one the decided price (D-01: R1,999/year
 * excl. VAT) is the fallback, so the page never shows a blank price.
 */
export const SOLAR_ANNUAL_FALLBACK_KOBO = 199900

export function solarAnnualPriceKobo(): number {
  const p = (FEATURE_PRICES as unknown as Record<string, { amountKobo?: unknown } | undefined>).solar
  return typeof p?.amountKobo === 'number' ? p.amountKobo : SOLAR_ANNUAL_FALLBACK_KOBO
}

export function solarPriceLine(): string {
  return `${formatRandWhole(solarAnnualPriceKobo())} per year excl. VAT for your whole organisation — every project`
}
