/** A tenderer's company profile (E5 slice B). Pure; shared by the form and the action. */

export interface ProfileInput {
  companyName: string
  registrationNumber: string
  vatNumber: string
  cidbGrade: string
  bbbeeLevel: string
  contactName: string
  phone: string
}

export const BBBEE_LEVELS = ['1', '2', '3', '4', '5', '6', '7', '8', 'non-compliant'] as const

/** Stored when the bidder holds no CIDB grading: a bidder is never forced to have one. */
export const CIDB_NOT_APPLICABLE = 'N/A'

const NOT_APPLICABLE = /^(N\/?A|NOT APPLICABLE|NONE|NIL)$/
const ONE_GRADE = /^([1-9][A-Z]{2})( ?PE)?$/

/**
 * The CIDB answer as stored (00246): '' when not answered, 'N/A' when the
 * bidder has no grading, else one or more grades like "7EP, 6CE PE" (several
 * gradings separated by commas or semicolons). Returns null when it cannot be read.
 */
export function normaliseCidbGrade(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, ' ')
  if (s === '') return ''
  if (NOT_APPLICABLE.test(s)) return CIDB_NOT_APPLICABLE
  const parts = s.split(/\s*[,;]\s*/).filter(Boolean)
  const out: string[] = []
  for (const part of parts) {
    const m = ONE_GRADE.exec(part)
    if (!m) return null
    out.push(m[2] ? `${m[1]} PE` : m[1])
  }
  return out.length ? out.join(', ') : null
}

/** How a stored CIDB answer reads on screens and exports. */
export const cidbLabel = (stored: string | null | undefined): string =>
  stored === CIDB_NOT_APPLICABLE ? 'Not applicable' : stored ?? ''

/** Field errors; an empty object means the profile is complete. */
export function validateProfile(p: ProfileInput): Record<string, string> {
  const e: Record<string, string> = {}
  if (!p.companyName.trim()) e.companyName = 'Company name is required'
  if (!/^\d{4}\/\d{6}\/\d{2}$/.test(p.registrationNumber.trim())) e.registrationNumber = 'Use the CIPC format, e.g. 2015/123456/07'
  if (p.vatNumber.trim() && !/^4\d{9}$/.test(p.vatNumber.trim()))
    e.vatNumber = 'A VAT number is 10 digits starting with 4 (leave blank if not registered)'
  const cidb = normaliseCidbGrade(p.cidbGrade)
  if (cidb === '') e.cidbGrade = 'Enter your CIDB grading, or tick "Not applicable"'
  else if (cidb === null) e.cidbGrade = 'Use the grade and class, e.g. 7EP or 6CE (several: 7EP, 6CE), or tick "Not applicable"'
  if (!(BBBEE_LEVELS as readonly string[]).includes(p.bbbeeLevel.trim().toLowerCase())) e.bbbeeLevel = 'Choose a B-BBEE level'
  if (!p.contactName.trim()) e.contactName = 'Contact person is required'
  if (p.phone.replace(/\D/g, '').length < 9) e.phone = 'Enter a phone number'
  return e
}
