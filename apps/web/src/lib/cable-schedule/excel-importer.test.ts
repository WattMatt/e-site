// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { legacyWorkbookVdPct, vdFidelityOk, type ImportedCable } from './excel-importer'
import { voltDropPctSingle, phaseFactor } from '@esite/shared'

function cable(overrides: Partial<ImportedCable> = {}): ImportedCable {
  return {
    source_row: 1,
    tag_input: null,
    from_label: 'MSB',
    to_label: 'DB1',
    voltage_v: 400,
    load_a: 100,
    size_mm2: 25,
    ohm_per_km: 0.9313,
    cable_no: 1,
    measured_length_m: 100,
    source_vd_pct: null,
    conductor: 'CU',
    section: null,
    warnings: [],
    errors: [],
    ...overrides,
  }
}

describe('legacyWorkbookVdPct — the workbook convention, NOT the corrected shared formula', () => {
  it('reproduces the legacy no-phase-factor formula exactly', () => {
    // T6.4 25 mm² XLPE Cu, 100 m, 100 A, 400 V — the audit's worked example:
    // legacy 2.33 %, SANS-correct (×√3) 4.03 %.
    const legacy = legacyWorkbookVdPct(0.9313, 100, 100, 400)
    expect(legacy).toBeCloseTo(2.328, 3)
  })

  it('differs from the shared (phase-factor-corrected) formula by exactly the phase factor', () => {
    for (const [v, len, load, ohm] of [
      [400, 100, 100, 0.9313],
      [230, 80, 40, 1.83],
      [525, 250, 320, 0.32],
    ] as const) {
      const legacy = legacyWorkbookVdPct(ohm, len, load, v)
      const corrected = voltDropPctSingle(ohm, len, load, v)
      expect(corrected / legacy).toBeCloseTo(phaseFactor(v), 10)
    }
  })

  it('vdFidelityOk passes a legacy workbook row against its own VD column', () => {
    // Source VD computed the legacy way — must round-trip within ±0.001.
    const sourceVd = legacyWorkbookVdPct(0.9313, 100, 100, 400)
    const fid = vdFidelityOk(cable({ source_vd_pct: sourceVd }))
    expect(fid.ok).toBe(true)
    expect(fid.computed).toBeCloseTo(sourceVd, 6)
  })

  it('vdFidelityOk FAILS a row whose VD column used the corrected (phase-factored) formula', () => {
    // Guards the lockstep: if the workbook ever ships corrected VD values,
    // the fidelity gate must flag the convention mismatch, not silently pass.
    const correctedVd = voltDropPctSingle(0.9313, 100, 100, 400)
    const fid = vdFidelityOk(cable({ source_vd_pct: correctedVd }))
    expect(fid.ok).toBe(false)
  })

  it('vdFidelityOk skips (ok, computed null) when inputs are incomplete', () => {
    const fid = vdFidelityOk(cable({ ohm_per_km: null }))
    expect(fid.ok).toBe(true)
    expect(fid.computed).toBeNull()
  })
})
