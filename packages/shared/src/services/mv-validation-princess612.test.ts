import { describe, it, expect } from 'vitest'
import { deviceTime, gradePair, type DeviceModel } from './mv-coordination.service'

/**
 * VALIDATION — reproduce the real issued protection coordination for
 * Princess Mkabayi City Mall, Vryheid (Project 612), 11 kV / 25 kA, MiCOM P122, IEC SI.
 *
 * Source: firm "MV Protection Settings Summary" (handover). Pickups are PRIMARY AMPS for
 * panels 1–4; panel 5's "0.75 / 0.375" are the relay ×In dial settings (see units test).
 * This confirms the curve/coordination engine reproduces the behaviour of a real issued
 * settings sheet. NOTE: this validates the curve & grading path only — it does NOT validate
 * the fault-level engine (that needs the project's network data + an ETAP/Pr.Eng reference).
 */
const incomer: DeviceModel = { id: 'p1', label: 'Princess incomer', std: 'IEC', curve: 'SI', pickupA: 280, tms: 0.2 }
const mall: DeviceModel = { id: 'p2', label: 'Mall feeder', std: 'IEC', curve: 'SI', pickupA: 150, tms: 0.2 }

describe('Princess 612 — reproduce real issued P122 coordination', () => {
  it('reproduces the issued relays’ operating times (curve engine vs hand calc)', () => {
    expect(deviceTime(incomer, 3000)!).toBeCloseTo(0.5764, 3)
    expect(deviceTime(mall, 3000)!).toBeCloseTo(0.4534, 3)
  })

  it('incomer grades above the Mall feeder (real settings); margin ≈ 0.123 s at 3 kA', () => {
    const c = gradePair(incomer, mall, 3000, 0.1)
    expect(c.upstreamTimeS).toBeGreaterThan(c.downstreamTimeS)
    expect(c.marginS).toBeCloseTo(0.123, 2)
    expect(c.verdict).toBe('ok')
  })

  it('units trap: Panel-5 issued "0.75" is the ×In dial, not primary amps — ×CTR(75/1) = 56.25 A primary', () => {
    const issuedDialXIn = 0.75
    const ctrPrimary = 75
    expect(issuedDialXIn * ctrPrimary).toBe(56.25)
    // A 0.75 A primary feeder pickup is non-physical; the Forms prefill must convert ×In → primary via the CT ratio.
  })
})
