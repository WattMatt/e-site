/** Client-safe: the sentence and error type for a failed schedule read (see loader.ts). */

/** What a caller shows when any read behind the schedule fails. Never an empty schedule. */
export const SCHEDULE_LOAD_ERROR = 'The schedule could not be loaded. Refresh the page to try again.'

/**
 * A read behind the schedule failed. Its message is the human sentence; the
 * table and the database's own message are kept for the server log only.
 */
export class ScheduleLoadError extends Error {
  constructor(readonly source: string, readonly detail: string) {
    super(SCHEDULE_LOAD_ERROR)
    this.name = 'ScheduleLoadError'
  }
}
