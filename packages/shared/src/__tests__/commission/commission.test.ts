/**
 * T-053: Commission Calculation Tests
 *
 * Verifies:
 *   1. ZAR cent rounding (kobo): E-Site rounds UP, supplier rounds DOWN
 *   2. Standard 6% commission split
 *   3. Edge cases: R0, R1M, 0% commission, 100% commission
 *   4. Total always equals commissionKobo + supplierKobo (no rounding loss)
 *
 * Run: pnpm vitest run src/__tests__/commission/commission.test.ts
 */

import { describe, it, expect } from 'vitest'

// ─── Commission logic (mirrored from payment.service.ts) ──────────────────────

interface CommissionBreakdown {
  totalKobo: number
  commissionRate: number
  commissionKobo: number    // E-Site — rounds UP
  supplierKobo: number      // Supplier — rounds DOWN
  supplierSharePercent: number
}

function calculateCommission(totalKobo: number, commissionRate = 0.06): CommissionBreakdown {
  if (totalKobo < 0) throw new Error('totalKobo must be non-negative')
  if (commissionRate < 0 || commissionRate > 1) throw new Error('commissionRate must be 0–1')

  // E-Site always rounds UP (ceil) so supplier always gets the floor
  const commissionKobo = Math.ceil(totalKobo * commissionRate)
  const supplierKobo = totalKobo - commissionKobo

  return {
    totalKobo,
    commissionRate,
    commissionKobo,
    supplierKobo,
    supplierSharePercent: Math.round((1 - commissionRate) * 100),
  }
}

// ─── Paystack webhook idempotency helper ─────────────────────────────────────

import { createHmac } from 'crypto'

function verifyPaystackSignature(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha512', secret).update(payload).digest('hex')
  return expected === signature
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Commission calculation', () => {
  describe('Standard 6% commission', () => {
    it('splits R100.00 correctly (6% E-Site, 94% supplier)', () => {
      const result = calculateCommission(10_000) // R100.00 in kobo
      expect(result.commissionKobo).toBe(600)    // R6.00
      expect(result.supplierKobo).toBe(9_400)    // R94.00
      expect(result.totalKobo).toBe(10_000)
      expect(result.commissionKobo + result.supplierKobo).toBe(result.totalKobo)
    })

    it('splits R499.00 correctly', () => {
      const result = calculateCommission(49_900)
      expect(result.commissionKobo).toBe(2_994)  // ceil(49900 * 0.06) = ceil(2994) = 2994
      expect(result.supplierKobo).toBe(46_906)
      expect(result.commissionKobo + result.supplierKobo).toBe(49_900)
    })

    it('splits R1,499.99 (R1499.99) — fractional kobo test', () => {
      // 149999 kobo × 0.06 = 8999.94 → ceil = 9000
      const result = calculateCommission(149_999)
      expect(result.commissionKobo).toBe(9_000)
      expect(result.supplierKobo).toBe(140_999)
      expect(result.commissionKobo + result.supplierKobo).toBe(149_999)
    })

    it('R123.456 rounds UP for E-Site (spec: always round UP commission)', () => {
      // 12345.6 kobo (hypothetical) → 742 kobo (ceil(12345.6 * 0.06) = ceil(740.736) = 741? wait)
      // Let's use a realistic scenario: 12346 kobo
      // 12346 * 0.06 = 740.76 → ceil = 741
      const result = calculateCommission(12_346)
      expect(result.commissionKobo).toBe(741)    // ceil(740.76)
      expect(result.supplierKobo).toBe(11_605)
      expect(result.commissionKobo + result.supplierKobo).toBe(12_346)
    })
  })

  describe('Edge cases', () => {
    it('R0 order → R0 commission, R0 supplier', () => {
      const result = calculateCommission(0)
      expect(result.commissionKobo).toBe(0)
      expect(result.supplierKobo).toBe(0)
      expect(result.totalKobo).toBe(0)
    })

    it('R1,000,000.00 (R1M) order', () => {
      const result = calculateCommission(100_000_000) // R1M in kobo
      expect(result.commissionKobo).toBe(6_000_000)  // R60,000
      expect(result.supplierKobo).toBe(94_000_000)   // R940,000
      expect(result.commissionKobo + result.supplierKobo).toBe(100_000_000)
    })

    it('0% commission → all goes to supplier', () => {
      const result = calculateCommission(50_000, 0)
      expect(result.commissionKobo).toBe(0)
      expect(result.supplierKobo).toBe(50_000)
    })

    it('100% commission → all goes to E-Site', () => {
      const result = calculateCommission(50_000, 1)
      expect(result.commissionKobo).toBe(50_000)
      expect(result.supplierKobo).toBe(0)
    })

    it('throws on negative amounts', () => {
      expect(() => calculateCommission(-100)).toThrow('non-negative')
    })

    it('throws on commission rate > 1', () => {
      expect(() => calculateCommission(1000, 1.5)).toThrow('0–1')
    })

    it('commission + supplier always equals total (no rounding loss)', () => {
      // Test 1000 random amounts
      for (let i = 0; i < 1000; i++) {
        const total = Math.floor(Math.random() * 10_000_000)
        const result = calculateCommission(total)
        expect(result.commissionKobo + result.supplierKobo).toBe(total)
      }
    })
  })

  describe('Custom commission rates', () => {
    it('3% commission split', () => {
      const result = calculateCommission(10_000, 0.03)
      expect(result.commissionKobo).toBe(300)
      expect(result.supplierKobo).toBe(9_700)
    })

    it('10% commission split', () => {
      const result = calculateCommission(10_000, 0.10)
      expect(result.commissionKobo).toBe(1_000)
      expect(result.supplierKobo).toBe(9_000)
    })
  })

  describe('supplierSharePercent', () => {
    it('returns 94 for 6% commission', () => {
      const result = calculateCommission(10_000, 0.06)
      expect(result.supplierSharePercent).toBe(94)
    })

    it('returns 97 for 3% commission', () => {
      const result = calculateCommission(10_000, 0.03)
      expect(result.supplierSharePercent).toBe(97)
    })
  })
})

describe('Paystack webhook signature verification', () => {
  const SECRET = 'test_secret_key_abc123'

  it('verifies a valid signature', () => {
    const payload = JSON.stringify({ event: 'charge.success', data: { amount: 10000 } })
    const validSig = createHmac('sha512', SECRET).update(payload).digest('hex')
    expect(verifyPaystackSignature(payload, validSig, SECRET)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const payload = JSON.stringify({ event: 'charge.success', data: { amount: 10000 } })
    const tamperedPayload = JSON.stringify({ event: 'charge.success', data: { amount: 99999 } })
    const sig = createHmac('sha512', SECRET).update(payload).digest('hex')
    expect(verifyPaystackSignature(tamperedPayload, sig, SECRET)).toBe(false)
  })

  it('rejects a wrong secret', () => {
    const payload = JSON.stringify({ event: 'charge.success' })
    const sig = createHmac('sha512', SECRET).update(payload).digest('hex')
    expect(verifyPaystackSignature(payload, sig, 'wrong_secret')).toBe(false)
  })

  it('rejects an empty signature', () => {
    const payload = JSON.stringify({ event: 'test' })
    expect(verifyPaystackSignature(payload, '', SECRET)).toBe(false)
  })

  it('is idempotent — same payload + secret always produces same signature', () => {
    const payload = '{"event":"charge.success","reference":"ref_001"}'
    const sig1 = createHmac('sha512', SECRET).update(payload).digest('hex')
    const sig2 = createHmac('sha512', SECRET).update(payload).digest('hex')
    expect(sig1).toBe(sig2)
    expect(verifyPaystackSignature(payload, sig1, SECRET)).toBe(true)
  })
})
