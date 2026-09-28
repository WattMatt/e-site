import { describe, expect, it } from 'vitest'
import { caseLoadFromSiteSeries } from './case-load'
import { buildS3 } from './site-series'

describe('caseLoadFromSiteSeries (load model site series → CaseInput.load)', () => {
  it('passes a complete S3 series through as a copy', () => {
    const synth = new Float64Array(8760).fill(50)
    const s3 = buildS3({ synths: [synth], commonAreaPct: 10 })
    const load = caseLoadFromSiteSeries(s3)
    expect(load).toHaveLength(8760)
    expect(load[0]).toBeCloseTo(55, 9)
    expect(load).not.toBe(s3)
  })

  it('refuses unfilled (NaN) hours and names them', () => {
    const s = new Float64Array(8760).fill(10)
    s[42] = NaN
    expect(() => caseLoadFromSiteSeries(s)).toThrow(/hour index 42/)
    try {
      caseLoadFromSiteSeries(s)
    } catch (e) {
      expect((e as { code: string }).code).toBe('site_series_unfilled')
    }
  })

  it('refuses negative (net-of-generation) hours', () => {
    const s = new Float64Array(8760).fill(10)
    s[100] = -3
    expect(() => caseLoadFromSiteSeries(s)).toThrow(/negative load \(hour index 100\)/)
  })

  it('refuses a series that is not 8760 hours', () => {
    expect(() => caseLoadFromSiteSeries(new Float64Array(8784))).toThrow(/8760/)
  })
})
