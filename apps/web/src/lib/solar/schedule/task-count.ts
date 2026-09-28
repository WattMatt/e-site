/**
 * The Schedule readiness step's input: a `select('id', { count: 'exact', head: true })`
 * read on solar.schedule_tasks → the number of tasks. A failed read reads as
 * "Not started" (grey) rather than inventing a green.
 */
export function scheduleTaskCountOf(res: { count?: number | null; data?: unknown; error?: unknown }): number {
  if (res.error) return 0
  if (typeof res.count === 'number') return res.count
  return Array.isArray(res.data) ? res.data.length : 0
}
