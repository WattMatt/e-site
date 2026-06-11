import { describe, it, expect } from 'vitest'
import {
  rowToFaultSource,
  faultSourceToRow,
  rowToAdapterFaultSource,
  faultResultToRow,
} from './_mv-protection-mappers'

describe('_mv-protection-mappers', () => {
  it('coerces PostgREST numeric strings to numbers and keeps nulls null', () => {
    const fs = rowToFaultSource({
      id: 'f1', organisation_id: 'o1', revision_id: 'r1',
      node_id: null, source_id: 's1', role: 'utility',
      ssc_mva: '500', xr_ratio: '12.5', z0_over_z1: null,
      uk_pct: null, pkr_w: null, s_rated_va: null, vector_group: null,
      lv_earthing_kind: null, lv_earthing_ohm: null, xd_pct: null,
      current_limit_factor: null, created_at: 't', updated_at: 't',
    })
    expect(fs.sscMva).toBe(500)
    expect(fs.xrRatio).toBe(12.5)
    expect(fs.z0OverZ1).toBeNull()
    expect(fs.sourceId).toBe('s1')
    expect(fs.nodeId).toBeNull()
  })

  it('assembles nested lv_earthing for the engine adapter from the flat columns', () => {
    const a = rowToAdapterFaultSource({
      node_id: 'n1', source_id: null, role: 'transformer',
      uk_pct: '6', s_rated_va: '1000000', vector_group: 'Dyn11',
      lv_earthing_kind: 'resistance', lv_earthing_ohm: '10',
    })
    expect(a.role).toBe('transformer')
    expect(a.uk_pct).toBe(6)
    expect(a.s_rated_va).toBe(1_000_000)
    expect(a.lv_earthing).toEqual({ kind: 'resistance', ohm: 10 })
  })

  it('maps lv_earthing to null when the kind column is null', () => {
    const a = rowToAdapterFaultSource({
      node_id: 'n1', source_id: null, role: 'transformer',
      lv_earthing_kind: null, lv_earthing_ohm: null,
    })
    expect(a.lv_earthing).toBeNull()
  })

  it('keeps lv_earthing.ohm null for a solid earth (kind set, no ohm)', () => {
    const a = rowToAdapterFaultSource({
      node_id: 'n1', source_id: null, role: 'transformer',
      lv_earthing_kind: 'solid', lv_earthing_ohm: null,
    })
    expect(a.lv_earthing).toEqual({ kind: 'solid', ohm: null })
  })

  it('faultSourceToRow emits defined keys only (undefined skipped, null passed through)', () => {
    const row = faultSourceToRow({ role: 'inverter', sRatedVa: 250000, currentLimitFactor: 1.2, sscMva: null })
    expect(row).toEqual({ role: 'inverter', s_rated_va: 250000, current_limit_factor: 1.2, ssc_mva: null })
    // untouched fields must not appear in the patch
    expect('uk_pct' in row).toBe(false)
    expect('node_id' in row).toBe(false)
  })

  it('faultResultToRow shapes an engine result into a snake_case cache row', () => {
    const row = faultResultToRow('r1', 'o1', {
      nodeId: 'n1', ik3MaxKa: 25, ik3MinKa: 18, ik1MaxKa: 12, ik1MinKa: 9,
      xrRatio: 14, ipKa: 60, icAmps: null, basis: 'sandbox — not for issue',
    })
    expect(row).toMatchObject({
      revision_id: 'r1', organisation_id: 'o1', node_id: 'n1',
      ik3_max_ka: 25, ik3_min_ka: 18, ik1_max_ka: 12, ik1_min_ka: 9,
      xr_ratio: 14, ip_ka: 60, ic_amps: null, basis: 'sandbox — not for issue',
    })
  })
})
