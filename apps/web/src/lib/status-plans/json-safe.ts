/**
 * The first value in `value` that would not survive a server → client
 * component boundary as JSON, as a path like `$.shapes[3].points[0]`, or null
 * when everything is plain JSON. Plain objects only: a class instance (Map,
 * Set, Date) is reported even though JSON.stringify would silently mangle it.
 */
export function jsonUnsafePath(value: unknown, path = '$'): string | null {
  if (value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'boolean') return null
  if (t === 'number') return Number.isFinite(value as number) ? null : path
  if (t !== 'object') return path
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = jsonUnsafePath(value[i], `${path}[${i}]`)
      if (p) return p
    }
    return null
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return path
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = jsonUnsafePath(v, `${path}.${k}`)
    if (p) return p
  }
  return null
}
