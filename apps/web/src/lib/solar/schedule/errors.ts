/**
 * Postgres / PostgREST errors from the schedule RPCs and tables → one sentence.
 *
 * 22023 (our RPCs), P0001 (the 00196 transition guard and membership trigger),
 * P0002 (task gone) and SOL01 (00212's solar-task owner guard, owner decision
 * Q4) are ALREADY sentences written for users and pass through — unless the
 * text is a bind-trigger diagnostic ("solar.…"), which never reaches the user.
 * Everything else is mapped by SQLSTATE and constraint name; a raw Postgres
 * message is never returned.
 */
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'

export const NO_EDIT = 'You need Edit access to Solar on this project to change the schedule.'
/** Fallback for SOL01 if the database sentence is ever missing. */
export const INELIGIBLE_OWNER =
  'Client viewers and suppliers cannot own solar tasks. Choose someone on the project team.'

const PASS_THROUGH = new Set(['22023', 'P0001', 'P0002'])

export function humanScheduleError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return GENERIC_ERROR
  const code = err.code ?? ''
  const m = err.message ?? ''
  if (code === '40001') return STALE_MESSAGE
  if (code === '42501') return NO_EDIT
  if (code === 'SOL01') return m && !m.startsWith('solar.') ? m : INELIGIBLE_OWNER
  if (code === '22007' || code === '22008') return 'One of the dates is not a real calendar date.'
  if (code === '23505') {
    if (m.includes('schedule_dependencies_pair_unique')) return 'Those two tasks are already linked.'
    if (m.includes('schedule_baselines_name_unique')) return 'A baseline with that name already exists.'
    if (m.includes('schedule_filter_presets_name_unique')) return 'You already have a preset with that name.'
    return GENERIC_ERROR
  }
  if (code === '23514') {
    if (m.includes('would create a loop')) return 'That link would make these tasks depend on each other in a loop.'
    if (m.includes('cannot depend on itself') || m.includes('schedule_dependencies_not_self')) return 'A task cannot depend on itself.'
    if (m.includes('same project')) return 'Both tasks must be on this project.'
    if (m.includes('inside its task')) return 'A segment must lie inside its task.'
    if (m.includes('cannot overlap')) return 'Segments of one task cannot overlap.'
    if (m.includes('schedule_tasks_dates_ordered') || m.includes('schedule_segments_dates_ordered')) return 'A task cannot end before it starts.'
    return GENERIC_ERROR
  }
  if (PASS_THROUGH.has(code) && m && !m.startsWith('solar.')) return m
  return GENERIC_ERROR
}
