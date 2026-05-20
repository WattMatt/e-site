/**
 * DB-code auto-derive helper.
 *
 * Rule (§3 of 2026-05-20-tenant-schedule-design.md):
 *   Strip the leading "SHOP " prefix (case-insensitive, one space required),
 *   trim the remainder, then prefix "DB-".
 *
 *   Examples: "SHOP 3" → "DB-3", "SHOP 4A" → "DB-4A", "SHOP 1/2" → "DB-1/2"
 *
 * If the value does NOT start with "SHOP " (case-insensitive) the trimmed
 * value is used as-is (e.g. "KIOSK 1" → "DB-KIOSK 1"). The design doc is
 * silent on this case; prefixing DB- directly is the safe, obvious fallback.
 *
 * Pure function — deterministic, no I/O.
 */

const SHOP_PREFIX_RE = /^shop\s+/i;

/**
 * Derive the DB `code` field from a raw `SHOP NO.` string.
 *
 * @param shopNumber - The raw value from the `SHOP NO.` Excel column (must be
 *   a non-empty string — the parser already validates this before calling).
 * @returns A `DB-{suffix}` code string.
 */
export function deriveDbCode(shopNumber: string): string {
  const trimmed = shopNumber.trim();
  const suffix = SHOP_PREFIX_RE.test(trimmed)
    ? trimmed.replace(SHOP_PREFIX_RE, '').trim()
    : trimmed;
  return `DB-${suffix}`;
}
