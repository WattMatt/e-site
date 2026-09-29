import { describe, it, expect } from 'vitest'
import { SOLAR_ACCESS_LEVELS, isSolarAccessLevel, solarLevelAllows } from './access'

describe('solar access levels', () => {
  it('orders view < edit < edit_financials', () => {
    expect(SOLAR_ACCESS_LEVELS).toEqual(['view', 'edit', 'edit_financials'])
  })

  it('recognises only the three level strings', () => {
    expect(isSolarAccessLevel('view')).toBe(true)
    expect(isSolarAccessLevel('edit')).toBe(true)
    expect(isSolarAccessLevel('edit_financials')).toBe(true)
    expect(isSolarAccessLevel('admin')).toBe(false)
    expect(isSolarAccessLevel(null)).toBe(false)
    expect(isSolarAccessLevel(undefined)).toBe(false)
  })

  it('a higher level satisfies a lower requirement, never the reverse', () => {
    expect(solarLevelAllows('edit_financials', 'view')).toBe(true)
    expect(solarLevelAllows('edit_financials', 'edit')).toBe(true)
    expect(solarLevelAllows('edit', 'view')).toBe(true)
    expect(solarLevelAllows('view', 'view')).toBe(true)
    expect(solarLevelAllows('view', 'edit')).toBe(false)
    expect(solarLevelAllows('edit', 'edit_financials')).toBe(false)
  })

  it('no level (null) satisfies nothing', () => {
    expect(solarLevelAllows(null, 'view')).toBe(false)
  })
})
