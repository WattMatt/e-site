// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyedPricingHash, pricingHashKey } from './pricing-hash'

afterEach(() => vi.unstubAllEnvs())

describe('keyedPricingHash (security review S-1)', () => {
  const plain = 'a'.repeat(64)
  it('is an HMAC: without the server key the same pricing does not reproduce it', () => {
    const h = keyedPricingHash(plain, 'server-key-1')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(keyedPricingHash(plain, 'server-key-1'))
    expect(h).not.toBe(keyedPricingHash(plain, 'server-key-2'))
    expect(h).not.toBe(plain)
  })
  it('takes SOLAR_PRICING_HASH_KEY, else the service-role key; refuses to run keyless outside tests', () => {
    vi.stubEnv('SOLAR_PRICING_HASH_KEY', 'k1')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k2')
    expect(pricingHashKey()).toBe('k1')
    vi.stubEnv('SOLAR_PRICING_HASH_KEY', '')
    expect(pricingHashKey()).toBe('k2')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => pricingHashKey()).toThrow(/pricing hash/)
  })
})
