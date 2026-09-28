/**
 * Golden outputs pinned to ENGINE_VERSION (spec §1.3). If a formula change moves any number
 * below, that is expected: bump ENGINE_VERSION in version.ts (semver minor for a model change,
 * patch for a fix) AND update both the version and the numbers here in the same commit.
 * Stored runs are never recomputed in place — the version is how a run says which maths made it.
 */
import { describe, expect, it } from 'vitest'
import { loadWeather } from './__fixtures__/pvgis'
import { simulatePv } from './pv/simulate-pv'
import { energyBalance } from './energy/energy-balance'
import { SOLAR_ENGINE_DEFAULTS as D } from './defaults'
import { ENGINE_VERSION } from './version'

const rel = (actual: number, expected: number) => expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-6)

describe(`engine golden case (ENGINE_VERSION ${ENGINE_VERSION})`, () => {
  it('is still version 0.1.0 — bump deliberately together with the numbers below', () => {
    expect(ENGINE_VERSION).toBe('0.1.0')
  })

  it('Johannesburg TMY, 100 kWp north 15°, 80 kW inverter, 100 kWh battery, 60/15 kW day/night load', () => {
    const pv = simulatePv(loadWeather('jhb'), {
      arrays: [
        {
          id: 'a', kWpDc: 100, tiltDeg: 15, azimuthDeg: 0, module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
          cellTemp: { kind: 'noct', noctC: 45 }, losses: D.losses.dc, inverterId: 'i',
        },
      ],
      inverters: [{ id: 'i', acRatedKw: 80 }],
      acLosses: D.losses.ac,
      albedo: 0.2,
      transposition: 'perez',
    })
    const b = energyBalance({
      pvAc: pv.pAc,
      load: Float64Array.from({ length: 8760 }, (_, h) => (h % 24 >= 7 && h % 24 < 19 ? 60 : 15)),
      loadAdjustment: 0,
      battery: {
        usableKwh: 100, maxChargeKw: 50, maxDischargeKw: 50, roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95,
        initialSoc: 0.1, backupReserve: 0.2, strategy: { kind: 'self-consumption' },
      },
      export: { allowed: true, limitKw: 50 },
    })
    rel(pv.annual.acKwh, 175753.0845)
    rel(pv.annual.clippedKwh, 1152.533342)
    rel(pv.annual.performanceRatio, 0.8026475803)
    rel(b.kpis.selfConsumption, 0.9913061259)
    rel(b.kpis.solarFraction, 0.5303656297)
    rel(b.kpis.importKwh, 154274.8907)
    rel(b.kpis.exportKwh, 140.1679968)
  })
})
