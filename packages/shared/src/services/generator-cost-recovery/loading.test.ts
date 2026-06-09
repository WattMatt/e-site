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
})
