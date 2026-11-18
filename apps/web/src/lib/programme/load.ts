/**
 * Loads one programme as the PERSON (their client, so RLS decides what they
 * see) into the `ProgrammeState` that `applyOps` and the engine work on.
 *
 * PostgREST caps every read at max_rows = 1000, `.range()` included, so every
 * table is read in pages with a stable order until a short page. The three
 * history lists (field updates, assignments, baseline rows) are loaded as
 * distinct activity ids: they decide whether `delete_activity` tombstones or
 * hard-deletes, exactly as `programme.save_changes` will.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ActivityCodeRow, ActivityRow, CalendarExceptionRow, CalendarRow, CodeTypeRow, CodeValueRow, DependencyRow,
  ProgrammeRow, ProgrammeState,
} from '@esite/shared/programme'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export const PROGRAMME_GONE = 'That programme no longer exists, or you do not have access to it.'
const READ_FAILED = 'The programme could not be read. Reload and try again.'

class ReadError extends Error {}

export type LoadProgrammeResult = { ok: true; state: ProgrammeState } | { ok: false; error: string }

/** The `programme` schema as the person (types.ts does not know it). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const programmeSchema = (supabase: AnyClient): any => (supabase as any).schema('programme')

async function readAll<T>(
  supabase: AnyClient, table: string, columns: string, programmeId: string, order: string[], pageSize: number,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    let q = programmeSchema(supabase).from(table).select(columns).eq('programme_id', programmeId)
    for (const col of order) q = q.order(col, { ascending: true })
    const { data, error } = await q.range(from, from + pageSize - 1)
    if (error) throw new ReadError(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
}

const distinct = (rows: Array<{ activity_id: string }>): string[] => [...new Set(rows.map((r) => r.activity_id))]

export async function loadProgramme(
  supabase: AnyClient,
  programmeId: string,
  opts: { pageSize?: number } = {},
): Promise<LoadProgrammeResult> {
  const pageSize = opts.pageSize ?? 1000
  try {
    const { data: programme, error } = await programmeSchema(supabase)
      .from('programmes').select('*').eq('id', programmeId).maybeSingle()
    if (error) return { ok: false, error: READ_FAILED }
    if (!programme) return { ok: false, error: PROGRAMME_GONE }

    const all = <T>(table: string, columns = '*', order = ['id']) =>
      readAll<T>(supabase, table, columns, programmeId, order, pageSize)
    const [calendars, exceptions, activities, dependencies, codeTypes, codeValues, activityCodes, fieldUpdates, assignments, baselineRows] =
      await Promise.all([
        all<CalendarRow>('calendars'),
        all<CalendarExceptionRow>('calendar_exceptions'),
        all<ActivityRow>('activities'),
        all<DependencyRow>('dependencies'),
        all<CodeTypeRow>('code_types'),
        all<CodeValueRow>('code_values'),
        all<ActivityCodeRow>('activity_codes', '*', ['activity_id', 'code_type_id']),
        all<{ activity_id: string }>('field_updates', 'id, activity_id'),
        all<{ activity_id: string }>('resource_assignments', 'id, activity_id'),
        all<{ activity_id: string }>('baseline_activities', 'id, activity_id'),
      ])

    return {
      ok: true,
      state: {
        programme: programme as ProgrammeRow,
        calendars, exceptions, activities, dependencies, codeTypes, codeValues, activityCodes,
        fieldUpdateActivityIds: distinct(fieldUpdates),
        assignmentActivityIds: distinct(assignments),
        baselineActivityIds: distinct(baselineRows),
      },
    }
  } catch {
    // A read error (ReadError) or a transport failure: never thrown to the caller.
    return { ok: false, error: READ_FAILED }
  }
}
