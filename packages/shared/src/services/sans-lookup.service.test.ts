import { describe, expect, it } from 'vitest'
import { deratingBasis } from './sans-lookup.service'

describe('deratingBasis', () => {
  it('DIRECT_IN_GROUND uses the direct-in-ground soil columns and the ground temperature table', () => {
    expect(deratingBasis('DIRECT_IN_GROUND')).toEqual({
      inAir: false,
      soilFactorKey: 'factor_direct_in_ground',
      temperatureTable: 'TABLE_6_3_4',
    })
  })

  it('DUCT uses the single-way-duct soil columns and the ground temperature table', () => {
    expect(deratingBasis('DUCT')).toEqual({
      inAir: false,
      soilFactorKey: 'factor_single_way_duct',
      temperatureTable: 'TABLE_6_3_4',
    })
  })

  it.each(['LADDER', 'TRAY', 'CLIPPED'])(
    '%s is in air — soil/depth bypassed, air temperature table',
    (method) => {
      expect(deratingBasis(method)).toEqual({
        inAir: true,
        soilFactorKey: 'factor_direct_in_ground',
        temperatureTable: 'TABLE_6_3_5',
      })
    },
  )

  it('null defaults to in air (matches the in-air base-rating fallthrough)', () => {
    expect(deratingBasis(null)).toEqual({
      inAir: true,
      soilFactorKey: 'factor_direct_in_ground',
      temperatureTable: 'TABLE_6_3_5',
    })
  })

  it('an unrecognised method is treated as in air, never as buried', () => {
    const basis = deratingBasis('SOMETHING_NEW')
    expect(basis.inAir).toBe(true)
    expect(basis.temperatureTable).toBe('TABLE_6_3_5')
  })
})
