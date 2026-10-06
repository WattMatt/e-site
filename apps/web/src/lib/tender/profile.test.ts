import { describe, it, expect } from 'vitest'
import { validateProfile } from './profile'

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
})
