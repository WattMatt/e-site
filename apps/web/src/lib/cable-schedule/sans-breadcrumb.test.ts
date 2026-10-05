import { describe, expect, it } from 'vitest'
import type { ReferenceProvenance } from '@esite/shared'
import { sansBreadcrumb, sansBreadcrumbAsTooltip, sansCitationLine } from './sans-breadcrumb'

// Synthetic standard, pages and coverage — shaped like scripts/standards/load.ts verdicts.
const STD = { standard: 'SANS 99999-1:2099', edition: '3.1' }
const PROVENANCE: ReferenceProvenance = {
  TABLE_6_3_3: { status: 'verified', against: [{ ...STD, clause: 'Table 9.13', page_printed: 20 }],
    coverage: { ground_touching: { up_to: 12, whole: true, values: { 2: 0.8, 3: 0.7, 12: 0.4 } }, duct_touching: { up_to: 12, whole: true, values: { 3: 0.75 } } } },
  TABLE_6_3_1: { status: 'partially_verified', against: [{ ...STD, clause: 'Table 9.16', page_printed: 28 }],
    coverage: { factor_direct_in_ground: { up_to: 1500, whole: false, values: { 500: 1, 800: 0.5, 1500: 0.45 } } } },
  TABLE_6_3_2: { status: 'verified', against: [{ ...STD, clause: 'Table 9.12', page_printed: 19 }],
    coverage: { factor_direct_in_ground: { up_to: 4, whole: true, values: { 1.2: 1, 2: 0.6 } } } },
  TABLE_6_3_5: { status: 'partially_verified', against: [{ ...STD, clause: 'Table 9.10', page_printed: 18 }],
    coverage: { factor_pvc_70c: { up_to: 65, whole: true, values: { 30: 1, 35: 0.8 } } } },
  TABLE_6_3_4: { status: 'partially_verified', against: [{ ...STD, clause: 'Table 9.11', page_printed: 19 }],
    coverage: { factor_pvc_70c: { up_to: 40, whole: false, values: { 25: 1, 30: 0.8, 40: 0.7 } } } },
  TABLE_6_2: { status: 'partially_verified',
    against: [{ ...STD, clause: 'Table 9.8', page_printed: 9 }, { ...STD, clause: 'Table 9.4(a)', page_printed: 1 }],
    coverage: {
      current_rating_ground_a: { up_to: 400, whole: true, values: { 95: 400 }, against_index: 0 },
      current_rating_air_a: { up_to: 400, whole: true, values: { 95: 300 }, against_index: 1 },
    } },
  TABLE_6_4: { status: 'not_checkable', note: 'manufacturer data' },
}

const cable = (o: Record<string, unknown> = {}) => ({
  size_mm2: 95, cores: '4', conductor: 'CU', insulation: 'PVC', ambient_temp_c: 30, depth_mm: 800,
  grouped_with: 3, installation_method: 'DIRECT_IN_GROUND', derated_current_rating_a: 200,
  derate_depth: 0.5, derate_thermal: 0.6, derate_grouping: 0.7, derate_temp: 0.8, ...o,
})
const tip = (c: ReturnType<typeof cable>, frozen = false) => sansBreadcrumbAsTooltip(sansBreadcrumb(c as never), {
  frozen, provenance: PROVENANCE,
  inputs: { insulation: c.insulation as string, installation_method: c.installation_method as string, grouped_with: c.grouped_with as number, size_mm2: c.size_mm2 as number },
})
const citeUnder = (t: string, factor: string): string | null => {
  const lines = t.split('\n'); const i = lines.findIndex((l) => l.includes(`× ${factor}`))
  return i >= 0 && lines[i + 1]?.trim().startsWith('= SANS') ? lines[i + 1].trim() : null
}

describe('sansCitationLine', () => {
  it('cites a covered column inside its proven range', () => {
    expect(sansCitationLine('TABLE_6_3_3', PROVENANCE, { column: 'ground_touching', value: 3 }))
      .toBe('= SANS 99999-1:2099 Ed 3.1 Table 9.13, p.20')
  })
  it('cites nothing past the proven range, for an uncompared column, or without a use', () => {
    expect(sansCitationLine('TABLE_6_3_1', PROVENANCE, { column: 'factor_direct_in_ground', value: 1800 })).toBeNull()
    expect(sansCitationLine('TABLE_6_3_5', PROVENANCE, { column: 'factor_xlpe_90c', value: 35 })).toBeNull()
    expect(sansCitationLine('TABLE_6_3_3', PROVENANCE, null)).toBeNull()
    expect(sansCitationLine('TABLE_6_4', PROVENANCE, { column: 'x', value: 1 })).toBeNull()
  })
  it('an unknown input value needs the whole column proven', () => {
    expect(sansCitationLine('TABLE_6_3_2', PROVENANCE, { column: 'factor_direct_in_ground', value: null })).toMatch(/Table 9\.12/)
    expect(sansCitationLine('TABLE_6_3_1', PROVENANCE, { column: 'factor_direct_in_ground', value: null })).toBeNull()
  })
  it('cites only a stored factor that IS the proven cell for that input', () => {
    expect(sansCitationLine('TABLE_6_3_3', PROVENANCE, { column: 'ground_touching', value: 3, factor: 0.7 })).toMatch(/Table 9\.13/)
    expect(sansCitationLine('TABLE_6_3_3', PROVENANCE, { column: 'ground_touching', value: 3, factor: 0.8 })).toBeNull()
    expect(sansCitationLine('TABLE_6_3_3', PROVENANCE, { column: 'ground_touching', value: 3, factor: null })).toBeNull()
  })
  it('names only the SANS table that backs the column', () => {
    expect(sansCitationLine('TABLE_6_2', PROVENANCE, { column: 'current_rating_ground_a', value: 95 })).toBe('= SANS 99999-1:2099 Ed 3.1 Table 9.8, p.9')
    expect(sansCitationLine('TABLE_6_2', PROVENANCE, { column: 'current_rating_air_a', value: 95 })).toBe('= SANS 99999-1:2099 Ed 3.1 Table 9.4(a), p.1')
  })
})

describe('the rating tooltip', () => {
  it('cites each buried PVC factor under the line it backs', () => {
    const t = tip(cable())
    expect(citeUnder(t, '0.70')).toMatch(/Table 9\.13, p\.20/)
    expect(citeUnder(t, '0.50')).toMatch(/Table 9\.16, p\.28/)
    expect(citeUnder(t, '0.60')).toMatch(/Table 9\.12/)
  })
  it('does not cite an XLPE temperature factor (no SANS column)', () => {
    expect(citeUnder(tip(cable({ insulation: 'XLPE', installation_method: 'TRAY', grouped_with: 1 })), '0.80')).toBeNull()
  })
  it('does not cite depth past the deepest SANS row', () => {
    expect(citeUnder(tip(cable({ depth_mm: 1800 })), '0.50')).toBeNull()
  })
  it('does not cite axes that do not apply: depth in air, grouping of one cable', () => {
    const air = tip(cable({ installation_method: 'TRAY', derate_depth: 0.5, grouped_with: 1 }))
    expect(citeUnder(air, '0.50')).toBeNull()
    expect(citeUnder(tip(cable({ grouped_with: 1 })), '0.70')).toBeNull()
  })
  it('does not cite a stale stored factor (e.g. an ambient edit not yet recomputed)', () => {
    expect(citeUnder(tip(cable({ ambient_temp_c: 40 })), '0.80')).toBeNull()   // 40 °C proves 0.7, stored 0.8
  })
  it('cites nothing on a frozen (issued) revision', () => {
    expect(tip(cable(), true)).not.toMatch(/^\s+= SANS/m)
  })
  it('reads exactly as before when no verdicts are supplied', () => {
    expect(sansBreadcrumbAsTooltip(sansBreadcrumb(cable() as never))).not.toMatch(/^\s+= SANS/m)
  })
})
