import { describe, it, expect } from 'vitest'
import { mvSignoffComplete } from './mv-protection.service'
import type { MvStudySignoffRow } from './_mv-protection-mappers'

// A fully-signed-off row (all four gates satisfied + source data confirmed).
const complete: MvStudySignoffRow = {
  id: 'sg1',
  organisationId: 'o1',
  revisionId: 'r1',
  prEngName: 'A. Engineer',
  prEngEcsaReg: 'ECSA-12345',
  curveManualRev: 'Rev C',
  sourceDataConfirmed: true,
  validationPackRef: 'VP-2026-001',
  signedOffBy: 'u1',
  signedOffAt: '2026-06-10T00:00:00Z',
  createdAt: 't',
  updatedAt: 't',
}

describe('mvSignoffComplete', () => {
  it('is complete when all four gate fields are set and source data is confirmed', () => {
    const res = mvSignoffComplete(complete)
    expect(res.complete).toBe(true)
    expect(res.missing).toEqual([])
  })

  it('reports every gate missing for a null sign-off (no row yet)', () => {
    const res = mvSignoffComplete(null)
    expect(res.complete).toBe(false)
    expect(res.missing).toEqual([
      'Pr.Eng approver name',
      'Pr.Eng ECSA registration',
      'curve re-validation manual revision',
      'source data confirmation',
      'signed validation pack reference',
    ])
  })

  it('treats whitespace-only text fields as missing', () => {
    const res = mvSignoffComplete({ ...complete, prEngEcsaReg: '   ' })
    expect(res.complete).toBe(false)
    expect(res.missing).toEqual(['Pr.Eng ECSA registration'])
  })

  it('requires source_data_confirmed to be strictly true', () => {
    const res = mvSignoffComplete({ ...complete, sourceDataConfirmed: false })
    expect(res.complete).toBe(false)
    expect(res.missing).toEqual(['source data confirmation'])
  })

  it('names multiple gaps at once', () => {
    const res = mvSignoffComplete({
      ...complete,
      curveManualRev: null,
      validationPackRef: '',
    })
    expect(res.complete).toBe(false)
    expect(res.missing).toEqual([
      'curve re-validation manual revision',
      'signed validation pack reference',
    ])
  })
})
