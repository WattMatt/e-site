import { describe, expect, it } from 'vitest'
import { caseLoadFromSiteSeries } from './case-load'
import { buildS3 } from './site-series'

const code = (c: string) => expect.objectContaining({ code: c })

describe('caseLoadFromSiteSeries (load model site series -> CaseInput.load + its reference year)', () => {
  it('passes a complete S3 series through as a copy, carrying the reference year', () => {
    const synth = new Float64Array(8760).fill(50)
    const s3 = buildS3({ synths: [synth], commonAreaPct: 10 })
    const out = caseLoadFromSiteSeries({ series: s3, referenceYear: 2025 })
    expect(out.referenceYear).toBe(2025)
    expect(out.load).toHaveLength(8760)
    expect(out.load[0]).toBeCloseTo(55, 9)
    expect(out.load).not.toBe(s3)
  })

  it('refuses unfilled (NaN) hours and names them', () => {
    const s = new Float64Array(8760).fill(10)
    s[42] = NaN
    expect(() => caseLoadFromSiteSeries({ series: s, referenceYear: 2025 })).toThrow(/hour index 42/)
    expect(() => caseLoadFromSiteSeries({ series: s, referenceYear: 2025 })).toThrow(code('site_series_unfilled'))
  })

  it('refuses infinite hours with their own code', () => {
    const s = new Float64Array(8760).fill(10)
    s[7] = Infinity
    expect(() => caseLoadFromSiteSeries({ series: s, referenceYear: 2025 })).toThrow(code('site_series_non_finite'))
  })

  it('refuses negative (net-of-generation) hours', () => {
    const s = new Float64Array(8760).fill(10)
    s[100] = -3
    expect(() => caseLoadFromSiteSeries({ series: s, referenceYear: 2025 })).toThrow(/negative load \(hour index 100\)/)
  })

  it('refuses a series that is not 8760 hours, and a year that is not a calendar year', () => {
    expect(() => caseLoadFromSiteSeries({ series: new Float64Array(8784), referenceYear: 2025 })).toThrow(/8760/)
    expect(() => caseLoadFromSiteSeries({ series: new Float64Array(8760), referenceYear: 2025.5 })).toThrow(code('invalid_reference_year'))
  })
})
