/**
 * Read a rate as a South African bidder types it. en-ZA writes a decimal COMMA
 * ("1 000,50"), while many people and every spreadsheet export write a point
 * ("1000.50", "1,000.50"). Stripping commas (the old behaviour) turned "12,50"
 * into 1250, a price 100× too high, without a word.
 *
 * Rules (spaces and a leading R ignored):
 *   - both separators: the LAST one is the decimal, the other groups thousands;
 *   - a lone point is a decimal (a point never groups thousands in en-ZA, and a
 *     stored rate like 12.345 must read back as itself);
 *   - repeated points or commas in groups of three are thousands;
 *   - a lone comma is a decimal, except before exactly three digits after a
 *     non-zero whole number ("1,000"), which could be either and is refused with
 *     a message rather than guessed.
 */
export type ParsedRate = { ok: true; value: number | null } | { ok: false; error: string }

const BAD = 'Rates must be positive numbers.'
const AMBIGUOUS = 'Unclear: write cents with a comma or a point and two digits (1 000,00), or no separator (1000).'
const grouped = (parts: string[]) => /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p))

export function parseRate(input: string): ParsedRate {
  let s = input.replace(/\s+/g, '').replace(/^R/i, '')
  if (s === '') return { ok: true, value: null }
  if (/^[.,]\d+$/.test(s)) s = `0${s}`
  if (!/^\d[\d.,]*$/.test(s)) return { ok: false, error: BAD }

  const hasComma = s.includes(',')
  const hasPoint = s.includes('.')
  if (hasComma && hasPoint) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    const group = dec === ',' ? '.' : ','
    const parts = s.split(dec)
    if (parts.length !== 2 || !grouped(parts[0].split(group)) || !/^\d+$/.test(parts[1])) return { ok: false, error: BAD }
    s = `${parts[0].split(group).join('')}.${parts[1]}`
  } else if (hasPoint) {
    const parts = s.split('.')
    if (parts.length === 2 && /^\d+$/.test(parts[1])) s = `${parts[0]}.${parts[1]}`
    else if (parts.length > 2 && grouped(parts)) s = parts.join('')
    else return { ok: false, error: BAD }
  } else if (hasComma) {
    const parts = s.split(',')
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      if (parts[1].length === 3 && !/^0+$/.test(parts[0])) return { ok: false, error: AMBIGUOUS }
      s = `${parts[0]}.${parts[1]}`
    } else if (parts.length > 2 && grouped(parts)) s = parts.join('')
    else return { ok: false, error: BAD }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: BAD }
  const value = Number(s)
  if (!Number.isFinite(value) || value >= 1e11) return { ok: false, error: BAD }
  return { ok: true, value }
}
