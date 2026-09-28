import { describe, it, expect } from 'vitest'
import { humanScheduleError, NO_EDIT, INELIGIBLE_OWNER } from './errors'
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'

const SOL01_SENTENCE =
  'Client viewers and suppliers cannot own solar tasks, so "SOLAR-4" cannot be given to them. Choose someone on the project team.'

describe('humanScheduleError', () => {
  it.each([
    [{ code: '40001', message: 'x' }, STALE_MESSAGE],
    [{ code: '42501', message: 'new row violates row-level security policy' }, NO_EDIT],
    [{ code: '42501', message: 'solar.schedule_tasks: a schedule task cannot move to another work item or project' }, NO_EDIT],
    [{ code: '22007', message: 'invalid input syntax for type date' }, 'One of the dates is not a real calendar date.'],
    [{ code: '23514', message: 'solar.schedule_dependencies: this link would create a loop' }, 'That link would make these tasks depend on each other in a loop.'],
    [{ code: '23514', message: 'solar.schedule_dependencies: a task cannot depend on itself' }, 'A task cannot depend on itself.'],
    [{ code: '23514', message: 'solar.schedule_dependencies: both tasks must be on the same project' }, 'Both tasks must be on this project.'],
    [{ code: '23514', message: 'solar.schedule_segments: a segment must lie inside its task' }, 'A segment must lie inside its task.'],
    [{ code: '23514', message: 'solar.schedule_segments: segments of one task cannot overlap' }, 'Segments of one task cannot overlap.'],
    [{ code: '23514', message: 'new row violates check constraint "schedule_tasks_dates_ordered"' }, 'A task cannot end before it starts.'],
    [{ code: '23514', message: 'solar.schedule_tasks: the work item is not a solar task' }, GENERIC_ERROR],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "schedule_dependencies_pair_unique"' }, 'Those two tasks are already linked.'],
    [{ code: '23505', message: '… "schedule_baselines_name_unique"' }, 'A baseline with that name already exists.'],
    [{ code: '23505', message: '… "schedule_filter_presets_name_unique"' }, 'You already have a preset with that name.'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "x_pkey"' }, GENERIC_ERROR],
    [{ code: '22023', message: '"Design" ends before it starts.' }, '"Design" ends before it starts.'],
    [{ code: 'P0001', message: 'Only the person who signs SOLAR-3 off can close it. Take it over first, or ask them to close it.' },
      'Only the person who signs SOLAR-3 off can close it. Take it over first, or ask them to close it.'],
    [{ code: 'P0001', message: 'solar.schedule_tasks: the work item is not a solar task' }, GENERIC_ERROR],
    [{ code: 'P0002', message: 'That task is no longer on this schedule. Reload to see the current programme.' },
      'That task is no longer on this schedule. Reload to see the current programme.'],
    [{ code: 'SOL01', message: SOL01_SENTENCE }, SOL01_SENTENCE],
    [{ code: 'SOL01', message: '' }, INELIGIBLE_OWNER],
    [{ code: 'SOL01', message: 'solar.something internal' }, INELIGIBLE_OWNER],
    [{ code: 'XX000', message: 'internal' }, GENERIC_ERROR],
    [{ message: 'no code at all' }, GENERIC_ERROR],
    [null, GENERIC_ERROR],
  ])('%j → sentence', (err, out) => {
    expect(humanScheduleError(err)).toBe(out)
  })
})
