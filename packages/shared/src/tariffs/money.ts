/**
 * Rand to cents, half away from zero. toPrecision(12) first removes the
 * binary tail (278.115 * 100 = 27811.499999999996) before rounding.
 */
export function roundCents(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`roundCents: ${x} is not a finite amount`)
  const scaled = Number((x * 100).toPrecision(12))
  const r = (Math.sign(scaled) * Math.round(Math.abs(scaled))) / 100
  return r === 0 ? 0 : r
}
