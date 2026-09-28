/**
 * Loan schedule, computed monthly and aggregated per year: `graceMonths` of interest only, then
 * a level annuity over the remaining months of the term.
 */

export interface LoanTerms {
  principalZar: number
  /** Nominal annual rate, e.g. 0.115; interest accrues monthly at rate / 12. */
  annualRate: number
  termYears: number
  graceMonths: number
}

export interface LoanYear {
  interestZar: number
  principalZar: number
  paymentZar: number
}

export function loanSchedule(t: LoanTerms, years: number): LoanYear[] {
  const months = Math.round(t.termYears * 12)
  if (!(t.principalZar >= 0)) throw new Error('loan principal must be ≥ 0')
  if (!(months > 0)) throw new Error('loan term must be > 0')
  if (!(t.graceMonths >= 0 && t.graceMonths < months)) throw new Error('grace months must be in [0, term)')
  const i = t.annualRate / 12
  const amortising = months - t.graceMonths
  const pmt = i === 0 ? t.principalZar / amortising : (t.principalZar * i) / (1 - (1 + i) ** -amortising)
  const out: LoanYear[] = Array.from({ length: years }, () => ({ interestZar: 0, principalZar: 0, paymentZar: 0 }))
  let bal = t.principalZar
  for (let m = 1; m <= months && Math.ceil(m / 12) <= years; m++) {
    const interest = bal * i
    const principal = m <= t.graceMonths ? 0 : Math.min(bal, pmt - interest)
    bal -= principal
    const y = out[Math.ceil(m / 12) - 1]!
    y.interestZar += interest
    y.principalZar += principal
    y.paymentZar += interest + principal
  }
  return out
}
