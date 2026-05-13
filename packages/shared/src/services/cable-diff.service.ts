/**
 * Cable schedule — revision diff helpers.
 *
 * Compares two revisions of the same project. Matches cables by a stable
 * composite key (FROM_code + TO_code + size_mm2 + cable_no) so renaming
 * a cable that doesn't have a tag_override still tracks across revisions.
 * Returns added / removed / changed rows, with per-field deltas on the
 * changed ones so the diff grid can show old → new on hover and surface
 * the revision cloud + letter in the left margin.
 *
 * Pure functions — no DB access. The caller loads both snapshots, then
 * passes them in. Used by both the diff page and the schedule grid's
 * change-since-last-issued indicator.
 */

export interface DiffableCable {
  id: string
  cable_no: number
  size_mm2: number
  cores: string
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: string
  ohm_per_km: number | null
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  ambient_temp_c: number
  derated_current_rating_a: number | null
  tag_override: string | null
  notes: string | null
  // Resolved labels — supplied by the caller from the node tables.
  from_label: string
  to_label: string
  voltage_v: number | null
  load_a: number | null
}

export interface FieldDelta {
  field: keyof DiffableCable
  old: unknown
  next: unknown
}

export interface CableDiffEntry {
  key: string
  kind: 'added' | 'removed' | 'changed' | 'same'
  prev: DiffableCable | null
  next: DiffableCable | null
  deltas: FieldDelta[]
}

export interface RevisionDiff {
  entries: CableDiffEntry[]
  summary: {
    added: number
    removed: number
    changed: number
    same: number
    total: number
  }
}

/**
 * Stable key for cross-revision matching. Order matters — putting
 * cable_no last lets us match parallel siblings independently.
 */
function diffKey(c: DiffableCable): string {
  return `${c.from_label}|${c.to_label}|${c.size_mm2}|${c.cable_no}`
}

/** Fields whose change is worth surfacing in the diff. */
const DIFFABLE_FIELDS: Array<keyof DiffableCable> = [
  'cores',
  'conductor',
  'insulation',
  'measured_length_m',
  'confirmed_length_m',
  'length_status',
  'ohm_per_km',
  'installation_method',
  'depth_mm',
  'grouped_with',
  'ambient_temp_c',
  'derated_current_rating_a',
  'tag_override',
  'voltage_v',
  'load_a',
  'notes',
]

function numericClose(a: unknown, b: unknown): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return false
  return Math.abs(a - b) < 1e-9
}

function deltasBetween(a: DiffableCable, b: DiffableCable): FieldDelta[] {
  const out: FieldDelta[] = []
  for (const f of DIFFABLE_FIELDS) {
    const oldV = a[f]
    const newV = b[f]
    if (oldV === newV) continue
    if (numericClose(oldV, newV)) continue
    if (oldV == null && newV == null) continue
    out.push({ field: f, old: oldV, next: newV })
  }
  return out
}

export function diffRevisions(
  prev: DiffableCable[],
  next: DiffableCable[],
): RevisionDiff {
  const prevByKey = new Map<string, DiffableCable>()
  const nextByKey = new Map<string, DiffableCable>()
  for (const c of prev) prevByKey.set(diffKey(c), c)
  for (const c of next) nextByKey.set(diffKey(c), c)
  const allKeys = new Set<string>([...prevByKey.keys(), ...nextByKey.keys()])

  const entries: CableDiffEntry[] = []
  let added = 0, removed = 0, changed = 0, same = 0

  for (const key of Array.from(allKeys).sort()) {
    const p = prevByKey.get(key) ?? null
    const n = nextByKey.get(key) ?? null
    if (p && !n) {
      entries.push({ key, kind: 'removed', prev: p, next: null, deltas: [] })
      removed++
    } else if (!p && n) {
      entries.push({ key, kind: 'added', prev: null, next: n, deltas: [] })
      added++
    } else if (p && n) {
      const deltas = deltasBetween(p, n)
      if (deltas.length === 0) {
        entries.push({ key, kind: 'same', prev: p, next: n, deltas: [] })
        same++
      } else {
        entries.push({ key, kind: 'changed', prev: p, next: n, deltas })
        changed++
      }
    }
  }

  return {
    entries,
    summary: { added, removed, changed, same, total: entries.length },
  }
}

/**
 * Lightweight per-cable change marker for the schedule grid. Given the
 * current revision's cables + the previous ISSUED revision's cables,
 * returns a Set of cable IDs (from the current revision) that have any
 * diffable field different from the previous matching cable. New cables
 * (no match in the prev revision) are also included.
 */
export function changedCableIds(
  prev: DiffableCable[],
  current: DiffableCable[],
): { added: Set<string>; changed: Set<string> } {
  const prevByKey = new Map<string, DiffableCable>()
  for (const c of prev) prevByKey.set(diffKey(c), c)

  const added = new Set<string>()
  const changed = new Set<string>()
  for (const c of current) {
    const match = prevByKey.get(diffKey(c))
    if (!match) {
      added.add(c.id)
      continue
    }
    const deltas = deltasBetween(match, c)
    if (deltas.length > 0) changed.add(c.id)
  }
  return { added, changed }
}
