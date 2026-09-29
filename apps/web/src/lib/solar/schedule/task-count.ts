/**
 * The Schedule readiness step's input: a `select('id', { count: 'exact', head: true })`
 * read on solar.schedule_tasks → the number of tasks. A failed read reads as
 * "Not started" (grey) rather than inventing a green.
 *
 * Void tasks are never counted, and not by a filter here: 00212's
 * work_items_solar_void_cleanup_trg deletes a task's side row the moment its
 * work item becomes void, by any path (schedule delete, My Work, service).
 * A status filter could not live here anyway — PostgREST will not embed
 * projects.work_items into a solar read (cross-schema).
 */
export function scheduleTaskCountOf(res: { count?: number | null; data?: unknown; error?: unknown }): number {
  if (res.error) return 0
  if (typeof res.count === 'number') return res.count
  return Array.isArray(res.data) ? res.data.length : 0
}
