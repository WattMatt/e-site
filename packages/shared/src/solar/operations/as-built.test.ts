import { describe, it, expect } from 'vitest'
import { asBuiltFromCase, equipmentComplete, parseAsBuilt, type CaseSystemLike } from './as-built'

const caseSys: CaseSystemLike = {
  pv: {
    dcKwp: 500, acKw: 400, tiltDeg: 15, azimuthDeg: 0,
    module: { make: 'Acme', model: 'M-550', pmaxW: 550 },
    inverter: { make: 'Volt', model: 'I-100', acKw: 100 },
  },
  battery: { enabled: true, unit: { make: 'Cell', model: 'B-10', usableKwh: 10, powerKw: 5 }, usableKwh: 200, maxDischargeKw: 100 },
}

describe('as-built record', () => {
  it('seeds equipment and sizes from the accepted case', () => {
    const a = asBuiltFromCase(caseSys)
    expect(a).toMatchObject({ dcKwp: 500, acKw: 400, batteryKwh: 200, batteryKw: 100, tiltDeg: 15, azimuthDeg: 0 })
    expect(a.equipment).toEqual([
      { kind: 'module', make: 'Acme', model: 'M-550', rating: 550, unit: 'W', quantity: 909 },
      { kind: 'inverter', make: 'Volt', model: 'I-100', rating: 100, unit: 'kW', quantity: 4 },
      { kind: 'battery', make: 'Cell', model: 'B-10', rating: 10, unit: 'kWh', quantity: 20 },
    ])
  })
  it('leaves equipment empty when the case names none (never a placeholder)', () => {
    const a = asBuiltFromCase({ ...caseSys, pv: { ...caseSys.pv, module: null, inverter: null }, battery: { ...caseSys.battery, enabled: false } })
    expect(a.equipment).toEqual([])
    expect(a.batteryKwh).toBeNull()
    expect(equipmentComplete(a)).toEqual({ ok: false, reason: 'Record at least one module line and one inverter line on the installation.' })
  })
  it('validates an edited record', () => {
    expect(parseAsBuilt({ ...asBuiltFromCase(caseSys), dcKwp: -1 }).ok).toBe(false)
    const r = parseAsBuilt({ ...asBuiltFromCase(caseSys), equipment: [{ kind: 'module', make: ' ', model: 'x', rating: 1, unit: 'W', quantity: 1 }] })
    expect(r.ok).toBe(false)
    expect(parseAsBuilt(asBuiltFromCase(caseSys))).toEqual({ ok: true, value: asBuiltFromCase(caseSys) })
    expect(equipmentComplete(asBuiltFromCase(caseSys))).toEqual({ ok: true, reason: null })
  })
})
