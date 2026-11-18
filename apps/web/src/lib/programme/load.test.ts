import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { loadProgramme } from './load'
import { activityRow, calendarRow, dependencyRow, PROG, programmeRow, programmeTables } from './test-fixtures'

const OTHER = '33333333-3333-4333-8333-333333333333'

describe('loadProgramme', () => {
  it('reads every table as the person and builds a ProgrammeState for this programme only', async () => {
    const { client, calls } = fakeSupabase({
      tables: programmeTables({
        'programme.calendar_exceptions': [{ id: 'X1', calendar_id: 'SITE', programme_id: PROG, day: '2026-03-21', kind: 'non_work', label: 'HRD' }],
        'programme.activities': [activityRow('A'), activityRow('B'), activityRow('Z', { programme_id: OTHER })],
        'programme.code_types': [{ id: 'CT', programme_id: PROG, name: 'Crew', sort_order: null }],
        'programme.code_values': [{ id: 'CV', code_type_id: 'CT', programme_id: PROG, value: 'C1', description: null, colour: null, organisation_tag: null, user_tag: null }],
        'programme.activity_codes': [{ activity_id: 'A', code_type_id: 'CT', code_value_id: 'CV', programme_id: PROG }],
        'programme.field_updates': [
          { id: 'F1', programme_id: PROG, activity_id: 'A' }, { id: 'F2', programme_id: PROG, activity_id: 'A' },
          { id: 'F3', programme_id: OTHER, activity_id: 'Z' },
        ],
        'programme.resource_assignments': [{ id: 'R1', programme_id: PROG, activity_id: 'B' }],
        'programme.baseline_activities': [{ id: 'BA1', programme_id: PROG, activity_id: 'A' }, { id: 'BA2', programme_id: PROG, activity_id: 'B' }],
      }),
    })
    const res = await loadProgramme(client as never, PROG)
    if (!res.ok) throw new Error(res.error)
    const s = res.state
    expect(s.programme.id).toBe(PROG)
    expect(s.activities.map((a) => a.id)).toEqual(['A', 'B'])
    expect(s.dependencies.map((d) => d.id)).toEqual(['D1'])
    expect(s.calendars.map((c) => c.id)).toEqual(['SITE'])
    expect(s.exceptions.map((e) => e.day)).toEqual(['2026-03-21'])
    expect(s.codeTypes).toHaveLength(1)
    expect(s.codeValues).toHaveLength(1)
    expect(s.activityCodes).toHaveLength(1)
    // History lists: distinct activity ids of this programme only.
    expect(s.fieldUpdateActivityIds).toEqual(['A'])
    expect(s.assignmentActivityIds).toEqual(['B'])
    expect(s.baselineActivityIds).toEqual(['A', 'B'])
    // Every read is a SELECT through the person's client, on the programme schema.
    expect(calls.every((c) => c.op === 'select' && c.table.startsWith('programme.'))).toBe(true)
    for (const c of calls.filter((x) => x.table !== 'programme.programmes')) {
      expect(c.filters).toContainEqual(['eq', 'programme_id', PROG])
    }
  })

  it('pages every table past the PostgREST row cap (short page ends the read)', async () => {
    const acts = Array.from({ length: 7 }, (_, i) => activityRow(`A${i}`))
    const deps = Array.from({ length: 6 }, (_, i) => dependencyRow(`D${i}`, `A${i}`, `A${i + 1}`))
    const { client, calls } = fakeSupabase({
      maxRows: 3,
      tables: programmeTables({ 'programme.activities': acts, 'programme.dependencies': deps }),
    })
    const res = await loadProgramme(client as never, PROG, { pageSize: 3 })
    if (!res.ok) throw new Error(res.error)
    expect(res.state.activities).toHaveLength(7)
    expect(res.state.dependencies).toHaveLength(6)
    const actReads = calls.filter((c) => c.table === 'programme.activities')
    expect(actReads.map((c) => c.range)).toEqual([[0, 2], [3, 5], [6, 8]])
    // A stable, unique order on every page, or the pages can skip and repeat rows.
    for (const c of calls.filter((x) => x.table !== 'programme.programmes')) {
      expect(c.order).toEqual(c.table === 'programme.activity_codes' ? [['activity_id', true], ['code_type_id', true]] : [['id', true]])
    }
    // 6 rows = two full pages, then an empty one to be sure.
    expect(calls.filter((c) => c.table === 'programme.dependencies').map((c) => c.range)).toEqual([[0, 2], [3, 5], [6, 8]])
  })

  it('a programme the person cannot see (or that is gone) is a sentence, not a throw', async () => {
    const { client } = fakeSupabase({ tables: programmeTables({ 'programme.programmes': [programmeRow({ id: OTHER })] }) })
    await expect(loadProgramme(client as never, PROG)).resolves.toEqual({
      ok: false, error: 'That programme no longer exists, or you do not have access to it.',
    })
  })

  it('a read error on any table is a plain sentence', async () => {
    const { client } = fakeSupabase({
      tables: programmeTables({ 'programme.calendars': [calendarRow('SITE')] }),
      selectErrors: { 'programme.dependencies': { message: 'permission denied for table dependencies', code: '42501' } },
    })
    await expect(loadProgramme(client as never, PROG)).resolves.toEqual({
      ok: false, error: 'The programme could not be read. Reload and try again.',
    })
  })
})
