/**
 * Increment the minor component of a two-part semver string.
 *
 * Rules:
 *   "1.0" → "1.1"
 *   "1.9" → "2.0"  (minor rolls when reaching 10)
 *   "2.9" → "3.0"
 *
 * Only "major.minor" (two integer parts) is accepted. Three-part or
 * non-numeric input throws so callers surface errors early.
 */
export function bumpSemver(v: string): string {
  const parts = v.split('.')
  if (parts.length !== 2) {
    throw new Error(
      `Invalid version "${v}": expected "major.minor" (e.g. "1.0")`,
    )
  }
  const major = parseInt(parts[0], 10)
  const minor = parseInt(parts[1], 10)
  if (isNaN(major) || isNaN(minor)) {
    throw new Error(
      `Invalid version "${v}": components must be integers`,
    )
  }
  if (minor + 1 >= 10) {
    return `${major + 1}.0`
  }
  return `${major}.${minor + 1}`
}
