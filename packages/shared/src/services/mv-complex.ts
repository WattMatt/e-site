export interface Cx {
  re: number
  im: number
}

export const cx = (re: number, im = 0): Cx => ({ re, im })
export const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im })
export const csub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im })
export const cmul = (a: Cx, b: Cx): Cx => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im)
export const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
export const cinv = (a: Cx): Cx => cdiv(cx(1), a)

/** Invert a square complex matrix via Gauss-Jordan with partial pivoting. Throws if singular. */
export function matInvert(A: Cx[][]): Cx[][] {
  const n = A.length
  // Scale-relative singularity tolerance: a pivot tiny *relative to the matrix* is
  // singular, while a uniformly weak (small per-unit Y) or stiff (large Y) matrix is
  // well-conditioned. An absolute 1e-12 mis-judged both (false islanded on weak nets;
  // missed singularity on stiff nets where the float residual exceeds 1e-12).
  let scale = 0
  for (const row of A) for (const c of row) { const m = cabs(c); if (m > scale) scale = m }
  const tol = scale * 1e-12
  const M: Cx[][] = A.map((row, i) => [
    ...row.map((c) => ({ ...c })),
    ...Array.from({ length: n }, (_, j) => cx(i === j ? 1 : 0)),
  ])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (cabs(M[r][col]) > cabs(M[piv][col])) piv = r
    if (cabs(M[piv][col]) <= tol) throw new Error('matInvert: singular matrix (no fault path / islanded)')
    if (piv !== col) {
      const t = M[piv]
      M[piv] = M[col]
      M[col] = t
    }
    const inv = cinv(M[col][col])
    for (let c = 0; c < 2 * n; c++) M[col][c] = cmul(M[col][c], inv)
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col]
      if (f.re === 0 && f.im === 0) continue
      for (let c = 0; c < 2 * n; c++) M[r][c] = csub(M[r][c], cmul(f, M[col][c]))
    }
  }
  return M.map((row) => row.slice(n))
}
