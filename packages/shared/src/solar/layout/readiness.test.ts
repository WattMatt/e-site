import { describe, it, expect } from 'vitest'
import { layoutReadiness } from './readiness'

describe('layoutReadiness (functional spec readiness table, Layout row)', () => {
  it('grey until a layout exists', () => {
    expect(layoutReadiness(null).status).toBe('grey')
    expect(layoutReadiness({ layouts: 0, arraysWithModules: 0, northSet: false, arrayOutsideRoof: false }).status).toBe('grey')
  })
  it('amber: started but no north reference', () => {
    expect(layoutReadiness({ layouts: 1, arraysWithModules: 2, northSet: false, arrayOutsideRoof: false }))
      .toEqual({ status: 'amber', reason: 'Layout started but no north reference' })
  })
  it('amber: north set but no array has modules', () => {
    expect(layoutReadiness({ layouts: 1, arraysWithModules: 0, northSet: true, arrayOutsideRoof: false }))
      .toEqual({ status: 'amber', reason: 'Layout started but no array has modules yet' })
  })
  it('red: an array lies outside every roof area', () => {
    expect(layoutReadiness({ layouts: 1, arraysWithModules: 1, northSet: true, arrayOutsideRoof: true }))
      .toEqual({ status: 'red', reason: 'An array lies outside every roof area' })
  })
  it('green: ≥ 1 array with modules and a north reference', () => {
    expect(layoutReadiness({ layouts: 2, arraysWithModules: 3, northSet: true, arrayOutsideRoof: false }))
      .toEqual({ status: 'green', reason: '3 arrays placed with a north reference' })
  })
})
