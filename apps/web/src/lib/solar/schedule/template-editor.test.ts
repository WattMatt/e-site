import { describe, it, expect } from 'vitest'
import { templateToRows, rowsToTemplate, removeTemplateRow } from './template-editor'
import { planToInputs, resolveOwnerHints } from './inputs'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE, instantiateScheduleTemplate, makeWorkCalendar } from '@esite/shared'

describe('template editor rows', () => {
  it('round-trips the default template', () => {
    const rows = templateToRows(DEFAULT_SOLAR_SCHEDULE_TEMPLATE)
    expect(rows[9].follows).toBe('9FF') // inverters follow modules (row 9) finish-to-finish
    const back = rowsToTemplate(rows)
    expect(back.errors).toEqual([])
    expect(back.items.map((i) => [i.name, i.durationDays, i.after.length])).toEqual(
      DEFAULT_SOLAR_SCHEDULE_TEMPLATE.map((i) => [i.name, i.durationDays, i.after.length]))
  })
  it('keeps lags in both directions', () => {
    const rows = templateToRows(DEFAULT_SOLAR_SCHEDULE_TEMPLATE)
    expect(rows[8].follows).toBe('8SS+3d, 6FS') // modules: mounting SS+3, procure_pv FS
    rows[1].follows = '1FS-2d'
    expect(rowsToTemplate(rows).items[1].after).toEqual([{ key: 't1', type: 'FS', lagDays: -2 }])
  })
  it('removing a row renumbers every Follows cell instead of silently re-pointing it', () => {
    const rows = templateToRows(DEFAULT_SOLAR_SCHEDULE_TEMPLATE)
    const after = removeTemplateRow(rows, 2) // drop row 3 (structural)
    expect(after).toHaveLength(rows.length - 1)
    expect(after[6].name).toBe('Install mounting structure')
    expect(after[6].follows).toBe('6FS') // was "7FS, 3FS": procure_bos is now row 6, structural is gone
    expect(after[7].follows).toBe('7SS+3d, 5FS') // modules: was "8SS+3d, 6FS"
    const bad = [...rows]; bad[1] = { ...bad[1], follows: 'soon' }
    expect(removeTemplateRow(bad, 0)[0].follows).toBe('soon') // unreadable text is left for the person to fix
  })
  it('reports a bad follows cell by row', () => {
    const rows = templateToRows(DEFAULT_SOLAR_SCHEDULE_TEMPLATE.slice(0, 2))
    rows[1].follows = 'after survey'
    expect(rowsToTemplate(rows).errors).toEqual(['Row 2: "after survey" should look like 1FS+2d, 3SS.'])
    rows[1].follows = '7'
    expect(rowsToTemplate(rows).errors).toEqual(['Row 2: row 7 does not exist.'])
  })
})

describe('plan → action inputs', () => {
  it('maps an instantiated template to task and link inputs', () => {
    const plan = instantiateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE, '2026-10-01', makeWorkCalendar('calendar'))
    const { tasks, links } = planToInputs(plan, () => null)
    expect(tasks[0]).toMatchObject({ key: 'survey', name: 'Site survey and design brief', start: '2026-10-01', ownerId: null })
    expect(links[0]).toEqual({ from: 'survey', to: 'design', type: 'FS', lagDays: 0 })
  })
  it('matches owners by email, then by unique full name; reports the rest', () => {
    const owners = [
      { id: 'u1', name: 'Ann Smith', email: 'ann@x.co.za' },
      { id: 'u2', name: 'Bob Dube', email: 'bob@x.co.za' },
      { id: 'u3', name: 'Bob Dube', email: 'bob2@x.co.za' },
    ]
    const r = resolveOwnerHints(['ANN@x.co.za', 'ann smith', 'Bob Dube', 'Zed', null], owners)
    expect(r.ids).toEqual(['u1', 'u1', null, null, null])
    expect(r.unmatched).toEqual(['Bob Dube', 'Zed'])
  })
})
