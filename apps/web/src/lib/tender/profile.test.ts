import { describe, it, expect } from 'vitest'
import { cidbLabel, normaliseCidbGrade, validateProfile } from './profile'

const ok = {
  companyName: 'Probe Electrical (Pty) Ltd',
  registrationNumber: '2015/123456/07',
  vatNumber: '4123456789',
  cidbGrade: '7ep',
  bbbeeLevel: '2',
  contactName: 'A Person',
  phone: '082 000 0000',
}

describe('validateProfile', () => {
  it('accepts a complete profile (VAT optional, CIDB case-insensitive)', () => {
    expect(validateProfile(ok)).toEqual({})
    expect(validateProfile({ ...ok, vatNumber: '' })).toEqual({})
    expect(validateProfile({ ...ok, cidbGrade: '6CE PE' })).toEqual({})
  })
  it('names every bad field', () => {
    expect(Object.keys(validateProfile({
      companyName: ' ', registrationNumber: '123', vatNumber: '12345', cidbGrade: 'seven', bbbeeLevel: '9', contactName: '', phone: '12',
    })).sort()).toEqual(['bbbeeLevel', 'cidbGrade', 'companyName', 'contactName', 'phone', 'registrationNumber', 'vatNumber'])
  })

  it('a bidder without a CIDB grading can still complete the profile', () => {
    for (const na of ['N/A', 'n/a', 'NA', 'Not applicable', ' none ']) expect(validateProfile({ ...ok, cidbGrade: na })).toEqual({})
  })
  it('an unanswered CIDB grading still needs an answer, and the message offers Not applicable', () => {
    expect(validateProfile({ ...ok, cidbGrade: '  ' }).cidbGrade).toMatch(/Not applicable/)
  })
  it('accepts several gradings', () => {
    expect(validateProfile({ ...ok, cidbGrade: '7EP, 6CE' })).toEqual({})
    expect(validateProfile({ ...ok, cidbGrade: '7ep; 6ce pe' })).toEqual({})
    expect(validateProfile({ ...ok, cidbGrade: '7EP, nonsense' }).cidbGrade).toBeDefined()
  })
})

describe('normaliseCidbGrade (the stored shape, 00246)', () => {
  // The same rule as the database CHECK, so a normalised value can never be refused on save.
  const DB = (v: string) => v === 'N/A' || /^[1-9][A-Z]{2}( ?PE)?(, [1-9][A-Z]{2}( ?PE)?)*$/.test(v)
  it('stores what the database accepts', () => {
    for (const [input, stored] of [
      ['n/a', 'N/A'], ['Not Applicable', 'N/A'], ['NONE', 'N/A'],
      ['7ep', '7EP'], ['6cepe', '6CE PE'], ['6CE  PE', '6CE PE'],
      ['7ep,6ce', '7EP, 6CE'], ['7EP ; 6CE PE', '7EP, 6CE PE'],
    ] as const) {
      const n = normaliseCidbGrade(input)
      expect(n).toBe(stored)
      expect(DB(n!)).toBe(true)
    }
  })
  it('refuses what it cannot read, and leaves blank as unanswered', () => {
    expect(normaliseCidbGrade('seven')).toBeNull()
    expect(normaliseCidbGrade('')).toBe('')
  })
  it('reads N/A as "Not applicable" on screens and exports', () => {
    expect(cidbLabel('N/A')).toBe('Not applicable')
    expect(cidbLabel('7EP')).toBe('7EP')
    expect(cidbLabel(null)).toBe('')
  })
})
