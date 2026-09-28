import type { Charge } from '../types'

export interface BlockRange {
  min: number
  max: number | null
  /** Written as Wh rather than kWh ("Block 3 (>500Wh)"): kept, but sent to review. */
  typo: boolean
}

const n = (s: string): number => Number(s.replace(/\s/g, ''))

/** Half-open [min, max) kWh per month from a block label. "0-500 / 501-1000" is repaired later. */
export function parseBlockRange(text: string): BlockRange | null {
  const t = text.replace(/[‒-―−]/g, '-').replace(/\s/g, ' ').toLowerCase()
  const typo = /\d\s*wh\b/.test(t) && !/\d\s*kwh/.test(t)
  // A number is plain digits or space-grouped thousands ("1 001"): a lone "2 51" is the
  // block number followed by the range, never the number 251.
  const N = String.raw`(\d{1,3}(?: \d{3})+|\d+)`
  const re = (src: string): RegExp => new RegExp(src.replaceAll('NUM', N))
  let m: RegExpExecArray | null
  if ((m = re(String.raw`first\s+NUM\s*kwh`).exec(t))) return { min: 0, max: n(m[1]), typo }
  if ((m = re(String.raw`>\s*NUM\s*(?:kwh)?\s*(?:to|-|and)\s*<=?\s*NUM\s*(?:kwh|\)|$)`).exec(t))) return { min: n(m[1]), max: n(m[2]), typo }
  if ((m = re(String.raw`NUM\s*(?:kwh)?\s*(?:-|to)\s*NUM\s*(?:k?wh|\))`).exec(t))) return { min: n(m[1]), max: n(m[2]), typo }
  if ((m = re(String.raw`>\s*=?\s*NUM\s*(?:k?wh|\)|$)`).exec(t))) return { min: n(m[1]), max: null, typo }
  if ((m = re(String.raw`<\s*=?\s*NUM\s*(?:k?wh|\))`).exec(t))) return { min: 0, max: n(m[1]), typo }
  return null
}

/**
 * In source order, for the energy charges of ONE season with no TOU:
 *  - "501-1000" after "0-500" starts at 500 (as-is/09 §7.1 Stage C.5);
 *  - an unranged middle part takes the gap between its neighbours.
 * Mutates the charges.
 */
export function repairBlocks(charges: Charge[]): void {
  for (let k = 1; k < charges.length; k++) {
    const prev = charges[k - 1]
    const cur = charges[k]
    if (prev.blockMaxKwh !== null && cur.blockMinKwh !== null && cur.blockMinKwh === prev.blockMaxKwh + 1) {
      cur.blockMinKwh = prev.blockMaxKwh
    }
  }
  for (let k = 1; k < charges.length - 1; k++) {
    const cur = charges[k]
    const prev = charges[k - 1]
    const next = charges[k + 1]
    if (cur.blockMinKwh === null && prev.blockMaxKwh !== null && next.blockMinKwh !== null && next.blockMinKwh > prev.blockMaxKwh) {
      cur.blockMinKwh = prev.blockMaxKwh
      cur.blockMaxKwh = next.blockMinKwh
      cur.blockBasis = 'monthly'
    }
  }
}
