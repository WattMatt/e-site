import { describe, it, expect } from 'vitest'
import { cx, cadd, csub, cmul, cdiv, cabs, cinv, matInvert, type Cx } from './mv-complex'

const close = (a: Cx, b: Cx, p = 9) => {
  expect(a.re).toBeCloseTo(b.re, p)
  expect(a.im).toBeCloseTo(b.im, p)
}

describe('complex scalars', () => {
  it('mul', () => close(cmul(cx(1, 2), cx(3, 4)), cx(-5, 10)))
  it('div by j = -j', () => close(cdiv(cx(1, 0), cx(0, 1)), cx(0, -1)))
  it('inv of 2j = -0.5j', () => close(cinv(cx(0, 2)), cx(0, -0.5)))
  it('abs', () => expect(cabs(cx(3, 4))).toBeCloseTo(5, 9))
  it('add/sub', () => {
    close(cadd(cx(1, 1), cx(2, 3)), cx(3, 4))
    close(csub(cx(2, 3), cx(1, 1)), cx(1, 2))
  })
})

describe('matInvert', () => {
  it('diagonal real matrix', () => {
    const inv = matInvert([[cx(2), cx(0)], [cx(0), cx(4)]])
    close(inv[0][0], cx(0.5))
    close(inv[1][1], cx(0.25))
  })
  it('A·A⁻¹ = I for a complex 2×2', () => {
    const A = [[cx(1, 1), cx(2, 0)], [cx(0, -1), cx(3, 1)]]
    const I = matInvert(A)
    const prod = (r: number, c: number) => cadd(cmul(A[r][0], I[0][c]), cmul(A[r][1], I[1][c]))
    close(prod(0, 0), cx(1))
    close(prod(0, 1), cx(0))
    close(prod(1, 0), cx(0))
    close(prod(1, 1), cx(1))
  })
  it('throws on singular', () => {
    expect(() => matInvert([[cx(1), cx(2)], [cx(2), cx(4)]])).toThrow()
  })
  it('inverts a uniformly weak matrix the old absolute 1e-12 threshold rejected', () => {
    const inv = matInvert([[cx(1e-13)]])
    expect(inv[0][0].re).toBeGreaterThan(9e12)
    expect(inv[0][0].re).toBeLessThan(1.1e13)
  })
  it('inverts a stiff (large-admittance) diagonal matrix', () => {
    const inv = matInvert([[cx(1e6), cx(0)], [cx(0), cx(1e6)]])
    close(inv[0][0], cx(1e-6))
    close(inv[1][1], cx(1e-6))
  })
  it('catches a singular matrix at large scale (relative tolerance)', () => {
    expect(() => matInvert([[cx(1e8), cx(2e8)], [cx(2e8), cx(4e8)]])).toThrow()
  })
})
