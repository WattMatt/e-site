import 'server-only'
/**
 * The pricing hash that enters the case hash (case_runs.inputs_hash) and fin_inputs_hash is KEYED
 * (HMAC-SHA256 over studyPricingHash). case_runs is readable at View, and case_runs.inputs lets a
 * View user recompute the energy half; an unkeyed hash of the pricing would let them test candidate
 * override / export rates offline until one matched (security review S-1). Without the server key
 * they cannot. Key: SOLAR_PRICING_HASH_KEY, else the service-role key the server already holds.
 * Rotating the key marks every case Stale once, nothing worse.
 */
import { createHmac } from 'node:crypto'

export function pricingHashKey(): string {
  const k = process.env.SOLAR_PRICING_HASH_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (k) return k
  if (process.env.NODE_ENV === 'test') return 'test-only-solar-pricing-hash-key'
  throw new Error('No key for the solar pricing hash: set SOLAR_PRICING_HASH_KEY or SUPABASE_SERVICE_ROLE_KEY')
}

export function keyedPricingHash(plainHash: string, key: string = pricingHashKey()): string {
  return createHmac('sha256', key).update(plainHash).digest('hex')
}
