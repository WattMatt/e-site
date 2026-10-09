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

/** Field errors; an empty object means the profile is complete. */
export function validateProfile(p: ProfileInput): Record<string, string> {
  const e: Record<string, string> = {}
  if (!p.companyName.trim()) e.companyName = 'Company name is required'
  if (!/^\d{4}\/\d{6}\/\d{2}$/.test(p.registrationNumber.trim())) e.registrationNumber = 'Use the CIPC format, e.g. 2015/123456/07'
  if (p.vatNumber.trim() && !/^4\d{9}$/.test(p.vatNumber.trim()))
    e.vatNumber = 'A VAT number is 10 digits starting with 4 (leave blank if not registered)'
  if (!/^[1-9][A-Z]{2}( ?PE)?$/.test(p.cidbGrade.trim().toUpperCase())) e.cidbGrade = 'Use the CIDB grade and class, e.g. 7EP or 6CE'
  if (!(BBBEE_LEVELS as readonly string[]).includes(p.bbbeeLevel.trim().toLowerCase())) e.bbbeeLevel = 'Choose a B-BBEE level'
  if (!p.contactName.trim()) e.contactName = 'Contact person is required'
  if (p.phone.replace(/\D/g, '').length < 9) e.phone = 'Enter a phone number'
  return e
}
