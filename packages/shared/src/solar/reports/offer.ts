/** Offer price (functional spec §9.3): capex (excl. VAT, excluding any "margin" capex lines) + margin %. */
import { VAT_RATE, type CapexTotals } from '../cases/finance-config'

export interface OfferPrice {
  capexExclVatZar: number
  marginPct: number
  marginZar: number
  offerExclVatZar: number
  vatZar: number
  offerInclVatZar: number
}

const cents = (x: number) => Math.round(x * 100) / 100

/** The capex the margin is applied to: every line except the "margin" category (else it doubles). */
export function offerBaseZar(t: Pick<CapexTotals, 'exclVatZar' | 'byCategory'>): number {
  return cents(t.exclVatZar - (t.byCategory.margin ?? 0))
}

export function offerPrice(capexExclVatZar: number, marginPct: number): OfferPrice {
  if (!(capexExclVatZar > 0)) throw new Error('capex must be positive')
  if (!(marginPct >= 0 && marginPct <= 100)) throw new Error('margin must be between 0 and 100 %')
  const marginZar = cents((capexExclVatZar * marginPct) / 100)
  const offerExclVatZar = cents(capexExclVatZar + marginZar)
  const vatZar = cents(offerExclVatZar * VAT_RATE)
  return {
    capexExclVatZar: cents(capexExclVatZar), marginPct, marginZar,
    offerExclVatZar, vatZar, offerInclVatZar: cents(offerExclVatZar + vatZar),
  }
}
