import { describe, it, expect } from 'vitest'
import {
  SOLAR_TABS, visibleSolarTabs, siteReadiness, computeSolarReadiness, toSiteReadinessInput,
  isInSouthAfrica, LATER_PHASE_REASON, yieldReadiness, financialsReadiness, reportsReadiness,
  operationsReadiness,
} from './readiness'

const full = { latitude: -26.1, longitude: 28.05, licenseeName: 'City Power', nmdKva: 500 }

describe('tabs', () => {
  it('lists the eleven spec tabs in order', () => {
    expect(SOLAR_TABS.map((t) => t.slug)).toEqual([
      'overview', 'site', 'load', 'schematics', 'tariff', 'layout', 'yield', 'financials', 'reports', 'schedule', 'operations',
    ])
  })
  it('Overview, Site & Supply, Yield & Scenarios, Financials (Phase 4b), Reports & Proposal (Phase 6) and Operations (Phase 7) are built', () => {
    expect(SOLAR_TABS.filter((t) => t.built).map((t) => t.slug)).toEqual(['overview', 'site', 'yield', 'financials', 'reports', 'operations'])
  })
  it('hides Tariff and Financials below Edit + financials; Operations is visible to every level', () => {
    expect(visibleSolarTabs('edit').map((t) => t.slug)).not.toContain('tariff')
    expect(visibleSolarTabs('edit').map((t) => t.slug)).not.toContain('financials')
    expect(visibleSolarTabs('edit_financials').map((t) => t.slug)).toContain('financials')
    expect(visibleSolarTabs('view').map((t) => t.slug)).toContain('operations')
    expect(visibleSolarTabs('edit_financials').map((t) => t.slug)).toContain('operations')
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
  it('has one row per visible tab except Overview; Site & Supply and Yield are live', () => {
    const steps = computeSolarReadiness(full, 'view')
    expect(steps.map((s) => s.slug)).toEqual(['site', 'load', 'schematics', 'layout', 'yield', 'reports', 'schedule', 'operations'])
    expect(steps[0]).toMatchObject({ slug: 'site', status: 'green', live: true })
    for (const s of steps.slice(1)) {
      if (s.slug === 'yield') expect(s).toMatchObject({ status: 'grey', reason: 'No cases yet', live: true })
      else if (s.slug === 'reports') expect(s).toMatchObject({ status: 'grey', reason: 'Feasibility reports need Edit + financials access', live: true })
      else if (s.slug === 'operations') expect(s).toMatchObject({ status: 'grey', reason: 'Not installed yet — record the installation from the accepted proposal', live: true })
      else expect(s).toMatchObject({ status: 'grey', reason: LATER_PHASE_REASON, live: false })
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

describe('Yield & Scenarios readiness (§2.3)', () => {
  it.each([
    [{ caseCount: 0, selectedCaseId: null, selectedStatus: null }, 'grey', 'No cases yet'],
    [{ caseCount: 2, selectedCaseId: null, selectedStatus: null }, 'amber', 'Cases exist but none is selected'],
    [{ caseCount: 2, selectedCaseId: 'c', selectedStatus: 'failed' }, 'red', 'The selected case’s last run failed'],
    [{ caseCount: 2, selectedCaseId: 'c', selectedStatus: 'stale' }, 'amber', 'The selected case is stale — re-run it'],
    [{ caseCount: 2, selectedCaseId: 'c', selectedStatus: 'done' }, 'green', 'The selected case’s run is current'],
  ] as const)('%j → %s', (input, status, reason) => {
    expect(yieldReadiness(input)).toEqual({ status, reason })
  })
})

describe('Financials readiness (§2.3)', () => {
  it('grey without financials; amber on untouched org defaults; green with capex and a model', () => {
    expect(financialsReadiness(null)).toEqual({ status: 'grey', reason: 'No financials yet' })
    expect(financialsReadiness({ capexZar: 0, hasModel: true, usingOrgDefaults: false }).status).toBe('amber')
    expect(financialsReadiness({ capexZar: 5e6, hasModel: true, usingOrgDefaults: true })).toEqual({ status: 'amber', reason: 'Using org defaults — review the capex' })
    expect(financialsReadiness({ capexZar: 5e6, hasModel: true, usingOrgDefaults: false })).toEqual({ status: 'green', reason: 'Capex and a finance model are set' })
  })
  it('a selected case with no saved financials is amber "using org defaults" (spec 01 §2.3), not grey', () => {
    expect(financialsReadiness({ capexZar: 0, hasModel: true, usingOrgDefaults: true, saved: false }))
      .toEqual({ status: 'amber', reason: 'Using org defaults — review the capex' })
  })
})

describe('computeSolarReadiness with Phase 4b inputs', () => {
  it('yield and financials are live; layout is green for a manual selected case', () => {
    const steps = computeSolarReadiness(null, 'edit_financials', {
      yield: { caseCount: 1, selectedCaseId: 'c', selectedStatus: 'done' },
      financials: { capexZar: 1, hasModel: true, usingOrgDefaults: false },
      layoutManual: true,
    })
    const by = Object.fromEntries(steps.map((s) => [s.slug, s]))
    expect(by.yield).toMatchObject({ live: true, status: 'green' })
    expect(by.financials).toMatchObject({ live: true, status: 'green' })
    expect(by.layout).toMatchObject({ status: 'green', reason: 'The selected case uses a manual system size' })
  })
  it('an Edit user never gets a financials step', () => {
    expect(computeSolarReadiness(null, 'edit').some((s) => s.slug === 'financials')).toBe(false)
  })
})

describe('Reports readiness (Phase 6)', () => {
  it('Reports & Proposal is a built tab', () => {
    expect(SOLAR_TABS.find((t) => t.slug === 'reports')?.built).toBe(true)
  })
  it('green only when a feasibility report exists for the selected case’s current run', () => {
    expect(reportsReadiness({ hasCurrentFeasibility: true })).toEqual({ status: 'green', reason: 'A feasibility report exists for the selected case’s current run' })
    expect(reportsReadiness({ hasCurrentFeasibility: false }).status).toBe('grey')
    expect(reportsReadiness(null)).toEqual({ status: 'grey', reason: 'Feasibility reports need Edit + financials access' })
  })
  it('computeSolarReadiness makes the Reports step live', () => {
    const steps = computeSolarReadiness(null, 'edit_financials', { reports: { hasCurrentFeasibility: true } })
    expect(steps.find((s) => s.slug === 'reports')).toMatchObject({ live: true, status: 'green' })
  })
})

describe('Operations readiness (§2.3)', () => {
  it('the tab is built and visible to every level', () => {
    const t = SOLAR_TABS.find((x) => x.slug === 'operations')!
    expect(t).toMatchObject({ built: true, hidden: false, financial: false })
  })
  it('grey until installed; amber installed without data or date; green with a date and ≥ 1 month of data', () => {
    expect(operationsReadiness(null)).toEqual({ status: 'grey', reason: 'Not installed yet — record the installation from the accepted proposal' })
    expect(operationsReadiness({ installed: true, commissioningDate: null, monthsWithData: 3 }).status).toBe('amber')
    expect(operationsReadiness({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 0 }))
      .toEqual({ status: 'amber', reason: 'Installed, but no generation data imported yet' })
    expect(operationsReadiness({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 2 }))
      .toEqual({ status: 'green', reason: 'Commissioned 2026-02-15; 2 months of generation data' })
  })
})
