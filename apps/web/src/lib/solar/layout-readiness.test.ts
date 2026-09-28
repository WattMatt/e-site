import { describe, it, expect } from 'vitest'
import { loadLayoutReadiness } from './layout-readiness'
import { fakeSupabase } from '@/test/fake-supabase'

describe('loadLayoutReadiness', () => {
  it('aggregates layouts.summary and the north of every roof source a layout uses', async () => {
    const { client } = fakeSupabase({ tables: {
      'solar.layouts': [
        { project_id: 'p', roof_source_id: 'rs1', summary: { arraysWithModules: 2, arrayOutsideRoof: false } },
        { project_id: 'p', roof_source_id: 'rs2', summary: { arraysWithModules: 1, arrayOutsideRoof: true } },
      ],
      'solar.roof_sources': [{ id: 'rs1', project_id: 'p', north_bearing_deg: 0 }, { id: 'rs2', project_id: 'p', north_bearing_deg: null }],
    } })
    expect(await loadLayoutReadiness(client as never, 'p')).toEqual({ layouts: 2, arraysWithModules: 3, northSet: false, arrayOutsideRoof: true })
  })
  it('no layouts → zero counts', async () => {
    const { client } = fakeSupabase({ tables: {} })
    expect(await loadLayoutReadiness(client as never, 'p')).toEqual({ layouts: 0, arraysWithModules: 0, northSet: false, arrayOutsideRoof: false })
  })
})
