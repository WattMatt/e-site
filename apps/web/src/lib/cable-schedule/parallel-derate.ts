/**
 * Pure group-size rules for parallel-strand re-derating.
 *
 * `cables.grouped_with` carries two overlapping meanings:
 *   1. Auto-managed set size — when a parallel set is created, every strand
 *      is stamped with the strand count (auto-parallel design §3, 2026-05-14).
 *   2. User-entered trench group — an engineer can set a LARGER value when
 *      the trench/duct bank carries additional cables from other runs.
 *
 * When strands are added to or deleted from a supply, every remaining strand
 * must be re-derated at the FINAL strand count (SANS grouping factor worsens
 * with n) — but a user-entered trench group must never be shrunk below what
 * the engineer recorded. We can't tag which values were user-entered, so the
 * rule is: a stored value that EXCEEDS the previous strand count is treated
 * as user-entered and preserved (never lowered); anything else is treated as
 * auto-managed and tracks the final strand count. Net effect per cable:
 * max(user-entered stored grouped_with, final strand count).
 */

/**
 * Target `grouped_with` for an EXISTING strand after its supply's strand
 * count changes from `prevCount` to `finalCount`.
 */
export function targetGroupedWith(
  stored: number,
  prevCount: number,
  finalCount: number,
): number {
  const s = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 1
  // Stored value beyond the old set size = user-entered trench group —
  // preserve it, but never derate at less than the actual strand count.
  if (s > prevCount) return Math.max(s, finalCount)
  return finalCount
}

/**
 * `grouped_with` for a NEW strand joining a supply that will have
 * `finalCount` strands. Inherits any user-entered trench group from the
 * existing siblings (a stored value beyond the old set size), so the new
 * strand is derated at least as hard as the trench it joins.
 */
export function groupSizeForNewStrand(
  existingStoredGroupedWith: readonly number[],
  prevCount: number,
  finalCount: number,
): number {
  let target = finalCount
  for (const stored of existingStoredGroupedWith) {
    const s = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 1
    if (s > prevCount && s > target) target = s
  }
  return target
}
