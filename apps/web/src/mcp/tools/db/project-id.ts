import type { Filter } from './filters'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** The project a call is about, for the audit row: an `eq` filter on project_id with a uuid, else none. */
export function projectIdFromFilters(filters: Filter[] | undefined): string | null {
  const hit = filters?.find(f => f.column === 'project_id' && f.op === 'eq' && isUuid(f.value))
  return hit ? (hit.value as string) : null
}

/** The project a write is about: every row carries the same uuid project_id, else none. */
export function projectIdFromRows(rows: Record<string, unknown>[]): string | null {
  if (rows.length === 0) return null
  const first = rows[0].project_id
  if (!isUuid(first)) return null
  return rows.every(r => r.project_id === first) ? first : null
}
