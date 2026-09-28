import { describe, it, expect } from 'vitest'
import {
  SOLAR_TABS, visibleSolarTabs, siteReadiness, computeSolarReadiness, toSiteReadinessInput,
  isInSouthAfrica, LATER_PHASE_REASON,
} from './readiness'

const full = { latitude: -26.1, longitude: 28.05, licenseeName: 'City Power', nmdKva: 500 }

describe('tabs', () => {
  it('lists the eleven spec tabs in order', () => {
    expect(SOLAR_TABS.map((t) => t.slug)).toEqual([
      'overview', 'site', 'load', 'schematics', 'tariff', 'layout', 'yield', 'financials', 'reports', 'schedule', 'operations',
    ])
  })
  it('built tabs: Overview, Site & Supply and (Phase 2b) Tariff', () => {
    expect(SOLAR_TABS.filter((t) => t.built).map((t) => t.slug)).toEqual(['overview', 'site', 'tariff'])
  })
  it('hides Tariff and Financials below Edit + financials, and Operations for everyone', () => {
    expect(visibleSolarTabs('edit').map((t) => t.slug)).not.toContain('tariff')
    expect(visibleSolarTabs('edit').map((t) => t.slug)).not.toContain('financials')
    expect(visibleSolarTabs('edit_financials').map((t) => t.slug)).toContain('financials')
    expect(visibleSolarTabs('edit_financials').map((t) => t.slug)).not.toContain('operations')
  })
})

describe('siteReadiness (spec §2.3, Site & Supply row)', () => {
  it('grey when no study exists or nothing is set', () => {
    expect(siteReadiness(null).status).toBe('grey')
    expect(siteReadiness({ latitude: null, longitude: null, licenseeName: null, nmdKva: null }).status).toBe('grey')
  })
  it('amber lists what is missing', () => {
    expect(siteReadiness({ ...full, nmdKva: null })).toEqual({
      status: 'amber', reason: 'Missing: connection capacity (NMD kVA)',
    })
    expect(siteReadiness({ ...full, latitude: null, licenseeName: '  ' }).reason)
      .toBe('Missing: coordinates, supply authority')
  })
  it('green when coordinates, supply authority and NMD are all set', () => {
    expect(siteReadiness(full).status).toBe('green')
  })
  it('red when the coordinates are outside South Africa', () => {
    expect(siteReadiness({ ...full, latitude: 26.1 })).toEqual({
      status: 'red', reason: 'Coordinates are outside South Africa — check the location',
    })
  })
})

describe('isInSouthAfrica', () => {
  it('uses the -35..-22 / 16..33 box', () => {
    expect(isInSouthAfrica(-33.9, 18.4)).toBe(true)
    expect(isInSouthAfrica(-21.9, 28)).toBe(false)
    expect(isInSouthAfrica(-26, 33.1)).toBe(false)
  })
})

describe('computeSolarReadiness', () => {
  it('has one row per visible tab except Overview; only Site & Supply is live', () => {
    const steps = computeSolarReadiness(full, 'view')
    expect(steps.map((s) => s.slug)).toEqual(['site', 'load', 'schematics', 'layout', 'yield', 'reports', 'schedule'])
    expect(steps[0]).toMatchObject({ slug: 'site', status: 'green', live: true })
    for (const s of steps.slice(1)) {
      expect(s).toMatchObject({ status: 'grey', reason: LATER_PHASE_REASON, live: false })
    }
  })
  it('includes Tariff and Financials for Edit + financials', () => {
    expect(computeSolarReadiness(null, 'edit_financials').map((s) => s.slug)).toContain('tariff')
  })
})

describe('toSiteReadinessInput', () => {
  it('coerces PostgREST numerics and tolerates a missing row', () => {
    expect(toSiteReadinessInput(null)).toBeNull()
    expect(toSiteReadinessInput({ latitude: '-26.1', longitude: 28.05, licensee_name: 'X', nmd_kva: '500.00' }))
      .toEqual({ latitude: -26.1, longitude: 28.05, licenseeName: 'X', nmdKva: 500 })
  })
})
