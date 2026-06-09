import { describe, it, expect } from 'vitest'
import { calculateTenantLoadingKw } from './loading'
import { DEFAULT_GENERATOR_SETTINGS as S } from './defaults'
import type { TenantInput } from './types'

const t = (o: Partial<TenantInput>): TenantInput => ({
  shopNumber: 'S', shopName: 'x', areaM2: 100, category: 'standard',
  participation: 'shared', manualKwOverride: null, ...o,
})

describe('calculateTenantLoadingKw', () => {
  it('area × standard rate', () => expect(calculateTenantLoadingKw(t({ areaM2: 100, category: 'standard' }), S)).toBe(3))
  it('area × fast_food rate', () => expect(calculateTenantLoadingKw(t({ areaM2: 100, category: 'fast_food' }), S)).toBe(4.5))
  it('own generator → 0', () => expect(calculateTenantLoadingKw(t({ participation: 'own' }), S)).toBe(0))
  it('opted out (none) → 0', () => expect(calculateTenantLoadingKw(t({ participation: 'none', areaM2: 100, category: 'standard' }), S)).toBe(0))
  it('manual override wins (shared)', () => expect(calculateTenantLoadingKw(t({ manualKwOverride: 7 }), S)).toBe(7))
  it('non-shared beats override → 0', () => expect(calculateTenantLoadingKw(t({ participation: 'own', manualKwOverride: 7 }), S)).toBe(0))

  it('honours a distinct fast_food rate (esite improvement)', () => {
    const s = { ...S, fastFoodKwPerSqm: 0.06, restaurantKwPerSqm: 0.045 }
    expect(calculateTenantLoadingKw(t({ areaM2: 100, category: 'fast_food' }), s)).toBe(6)     // 100 × 0.06
    expect(calculateTenantLoadingKw(t({ areaM2: 100, category: 'restaurant' }), s)).toBe(4.5)  // distinct from fast_food now
  })

  it('honours a distinct national rate (esite improvement)', () => {
    const s = { ...S, nationalKwPerSqm: 0.05, standardKwPerSqm: 0.03 }
    expect(calculateTenantLoadingKw(t({ areaM2: 100, category: 'national' }), s)).toBe(5)      // 100 × 0.05
    expect(calculateTenantLoadingKw(t({ areaM2: 100, category: 'standard' }), s)).toBe(3)      // distinct from national now
  })
})
