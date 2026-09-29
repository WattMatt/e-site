import { describe, it, expect } from 'vitest'
import { humanLayoutError } from './layout-errors'

describe('humanLayoutError', () => {
  it('maps every 00212 sentence and never echoes a raw message', () => {
    expect(humanLayoutError({ code: '40001', message: 'solar.layouts: stale layout' })).toBe('Someone else changed this — reload to see their version.')
    expect(humanLayoutError({ code: '23514', message: 'solar.layout_objects: the roof source has no scale; calibrate this page first' }))
      .toBe('This drawing page has no scale yet — calibrate it before drawing.')
    expect(humanLayoutError({ code: '23514', message: 'solar.roof_sources: the drawing belongs to another project' })).toBe('That drawing belongs to another project.')
    expect(humanLayoutError({ code: '23514', message: 'solar.layout_objects: a DB symbol must link to a board' })).toBe('Link the DB symbol to a board.')
    expect(humanLayoutError({ code: '23505', message: 'duplicate key value violates unique constraint "layouts_study_name_key"' })).toBe('A layout with that name already exists.')
    expect(humanLayoutError({ code: '23505', message: 'duplicate key value violates unique constraint "roof_sources_drawing_page_key"' })).toBe('That drawing page is already a roof source.')
    expect(humanLayoutError({ code: '23503', message: 'update or delete on table "roof_sources" violates foreign key constraint "layouts_roof_source_id_fkey" on table "layouts"' }))
      .toBe('This roof source is used by a layout — delete the layout first.')
    expect(humanLayoutError({ code: '23503', message: 'update or delete on table "layouts" violates foreign key constraint "cases_layout_id_fkey" on table "cases"' }))
      .toBe('Used by a case — change the case first.')
    expect(humanLayoutError({ code: '42501', message: 'solar.layouts: you cannot edit this layout' })).toBe('You do not have permission to do that.')
    expect(humanLayoutError({ code: 'XX000', message: 'internal detail' })).toBe('Something went wrong — try again.')
  })
  it('a unique violation elsewhere does NOT become the access-request sentence', () => {
    expect(humanLayoutError({ code: '23505', message: 'something else' })).toBe('Something went wrong — try again.')
  })
})
