import { describe, it, expect } from 'vitest'
import { renderCsv } from './export-csv'
import type { ExportPayload } from './export-payload'

// Minimal payload — only the fields the CSV renderers read. Cast through unknown
// so the test stays focused on the columns under test.
const payload = {
  runs: [
    {
      supply_id: 's1',
      from_label: 'MB',
      to_label: 'DB-67',
      voltage_v: 400,
      load_a: 60,
      breaker_a: 63,
      pole_config: 'TP',
      parallel_count: 1,
      size_mm2: 25,
      cores: '3',
      conductor: 'CU',
      insulation: 'PVC',
      ohm_per_km: 0.87,
      length_status: 'MEASURED',
      vd_pct: 1.2,
      cumulative_vd_pct: 1.2,
      combined_capacity_a: 90,
      under_rated: false,
      installation_method: 'TRAY',
      depth_mm: null,
      grouped_with: 1,
      mixed_properties: { fields: [] },
      cables: [
        {
          id: 'c1',
          cable_no: 1,
          cable_tag: 'MB-DB-67-1',
          tag_override: null,
          notes: null,
          confirmed_length_m: null,
          measured_length_m: 50,
          derated_current_rating_a: 90,
        },
      ],
    },
  ],
  cables: [
    { id: 'c1', cable_no: 1, cable_tag: 'MB-DB-67-1', derated_current_rating_a: 90 },
  ],
  cableTags: [
    { cable_id: 'c1', end_position: 'FROM', tag_text: 'MB-DB-67-1', printed: false, printed_at: null },
  ],
} as unknown as ExportPayload

describe('renderCsv schedule — breaker columns', () => {
  it('includes breaker_a and pole_config in the header', () => {
    const csv = renderCsv('schedule', payload)
    const header = csv.split('\r\n')[0]
    expect(header).toContain('breaker_a')
    expect(header).toContain('pole_config')
  })
  it('emits the breaker value and poles in the data row', () => {
    const csv = renderCsv('schedule', payload)
    const row = csv.split('\r\n')[1]
    expect(row).toContain('63')
    expect(row).toContain('TP')
  })
})

describe('renderCsv tags — per-cable derated amps', () => {
  it('includes derated_current_rating_a column with the value', () => {
    const csv = renderCsv('tags', payload)
    expect(csv.split('\r\n')[0]).toContain('derated_current_rating_a')
    expect(csv.split('\r\n')[1]).toContain('90')
  })
})
