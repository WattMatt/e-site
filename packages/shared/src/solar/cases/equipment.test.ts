import { describe, it, expect } from 'vitest'
import { parseEquipmentCsv, EQUIPMENT_CSV_HEADER, moduleSnapshot, inverterSnapshot, batterySnapshot, parseEquipmentSpecs } from './equipment'

const H = EQUIPMENT_CSV_HEADER.join(',')
const row = (vals: Record<string, string>) => EQUIPMENT_CSV_HEADER.map((h) => vals[h] ?? '').join(',')

describe('parseEquipmentCsv', () => {
  it('reads one of each kind, keeping only the columns of that kind', () => {
    const text = [H,
      row({ kind: 'module', make: 'Acme', model: 'M-550', pmaxW: '550', gammaPmaxPctPerC: '-0.35', vocV: '49.6' }),
      row({ kind: 'inverter', make: 'Acme', model: 'I-100', acKw: '100', euroEfficiencyPct: '98.2' }),
      row({ kind: 'battery', make: 'Acme', model: 'B-200', usableKwh: '200', powerKw: '100', rtePct: '91' }),
    ].join('\n')
    const r = parseEquipmentCsv(text)
    expect(r.errors).toEqual([])
    expect(r.rows).toEqual([
      { kind: 'module', make: 'Acme', model: 'M-550', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35, vocV: 49.6 } },
      { kind: 'inverter', make: 'Acme', model: 'I-100', specs: { acKw: 100, euroEfficiencyPct: 98.2 } },
      { kind: 'battery', make: 'Acme', model: 'B-200', specs: { usableKwh: 200, powerKw: 100, rtePct: 91 } },
    ])
  })

  it('reports per line: unknown kind, a column of another kind, a missing required value, a non-number', () => {
    const text = [H,
      row({ kind: 'turbine', make: 'A', model: 'B' }),
      row({ kind: 'module', make: 'A', model: 'B', pmaxW: '550', gammaPmaxPctPerC: '-0.3', acKw: '5' }),
      row({ kind: 'inverter', make: 'A', model: 'C', acKw: '10' }),
      row({ kind: 'battery', make: 'A', model: 'D', usableKwh: 'ten', powerKw: '5', rtePct: '90' }),
    ].join('\n')
    const r = parseEquipmentCsv(text)
    expect(r.rows).toEqual([])
    expect(r.errors).toEqual([
      { line: 2, message: 'kind must be module, inverter or battery' },
      { line: 3, message: 'column acKw does not apply to a module' },
      { line: 4, message: 'euroEfficiencyPct is required for an inverter' },
      { line: 5, message: 'usableKwh must be a number' },
    ])
  })

  it('refuses a file whose header is not the template', () => {
    expect(parseEquipmentCsv('make,model\nA,B').errors).toEqual([{ line: 1, message: `The header must be exactly: ${H}` }])
  })

  it('handles quoted fields with commas', () => {
    const text = [H, row({ kind: 'module', make: '"Acme, Inc."', model: 'M', pmaxW: '400', gammaPmaxPctPerC: '-0.4' })].join('\n')
    expect(parseEquipmentCsv(text).rows[0]!.make).toBe('Acme, Inc.')
  })
})

describe('snapshots', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  it('copies exactly the fields a case needs', () => {
    expect(moduleSnapshot({ id, make: 'A', model: 'M', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35, vocV: 49 } }))
      .toEqual({ equipmentId: id, make: 'A', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 })
    expect(inverterSnapshot({ id, make: 'A', model: 'I', specs: { acKw: 100, euroEfficiencyPct: 98 } }))
      .toEqual({ equipmentId: id, make: 'A', model: 'I', acKw: 100, euroEfficiencyPct: 98 })
    expect(batterySnapshot({ id, make: 'A', model: 'B', specs: { usableKwh: 10, powerKw: 5, rtePct: 90 } }))
      .toEqual({ equipmentId: id, make: 'A', model: 'B', usableKwh: 10, powerKw: 5, rtePct: 90 })
  })
  it('parseEquipmentSpecs validates by kind', () => {
    expect(parseEquipmentSpecs('module', { pmaxW: -1, gammaPmaxPctPerC: -0.3 }).ok).toBe(false)
    expect(parseEquipmentSpecs('battery', { usableKwh: 1, powerKw: 1, rtePct: 90 }).ok).toBe(true)
  })
})
