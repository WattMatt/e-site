import { describe, it, expect } from 'vitest'
import {
  SOLAR_TABS, visibleSolarTabs, siteReadiness, computeSolarReadiness, toSiteReadinessInput,
  isInSouthAfrica, LATER_PHASE_REASON, yieldReadiness, financialsReadiness, loadReadiness, schematicsReadiness,
  reportsReadiness, operationsReadiness,
} from './readiness'

const full = { latitude: -26.1, longitude: 28.05, licenseeName: 'City Power', nmdKva: 500 }

describe('tabs', () => {
  it('lists the eleven spec tabs in order', () => {
    expect(SOLAR_TABS.map((t) => t.slug)).toEqual([
      'overview', 'site', 'load', 'schematics', 'tariff', 'layout', 'yield', 'financials', 'reports', 'schedule', 'operations',
    ])
  })
  it('every tab is built once phases 1–7 are assembled', () => {
    expect(SOLAR_TABS.filter((t) => t.built).map((t) => t.slug)).toEqual(['overview', 'site', 'load', 'schematics', 'tariff', 'layout', 'yield', 'financials', 'reports', 'schedule', 'operations'])
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
  it('has one row per visible tab except Overview; every tab is live, none is a later phase', () => {
    const steps = computeSolarReadiness(full, 'view')
    expect(steps.map((s) => s.slug)).toEqual(['site', 'load', 'schematics', 'layout', 'yield', 'reports', 'schedule', 'operations'])
    expect(steps[0]).toMatchObject({ slug: 'site', status: 'green', live: true })
    for (const s of steps.slice(1)) {
      if (s.slug === 'yield') expect(s).toMatchObject({ status: 'grey', reason: 'No cases yet', live: true })
      else if (s.slug === 'reports') expect(s).toMatchObject({ status: 'grey', reason: 'Feasibility reports need Edit + financials access', live: true })
      else if (s.slug === 'operations') expect(s).toMatchObject({ status: 'grey', reason: 'Not installed yet — record the installation from the accepted proposal', live: true })
      else expect(s).toMatchObject({ status: 'grey', reason: 'Not started', live: true })
    }
    expect(steps.some((s) => s.reason === LATER_PHASE_REASON)).toBe(false)
  })
  it('includes Tariff and Financials for Edit + financials', () => {
    expect(computeSolarReadiness(null, 'edit_financials').map((s) => s.slug)).toContain('tariff')
  })
})

describe('schedule readiness', () => {
  it('grey with no tasks, green with any, and the tab is built', () => {
    const none = computeSolarReadiness(null, 'edit', { scheduleTaskCount: 0 }).find((s) => s.slug === 'schedule')!
    expect(none).toMatchObject({ status: 'grey', reason: 'Not started', live: true })
    const some = computeSolarReadiness(null, 'view', { scheduleTaskCount: 3 }).find((s) => s.slug === 'schedule')!
    expect(some).toMatchObject({ status: 'green', reason: '3 tasks scheduled', live: true })
    expect(computeSolarReadiness(null, 'view', { scheduleTaskCount: 1 }).find((s) => s.slug === 'schedule')!.reason).toBe('1 task scheduled')
    expect(SOLAR_TABS.find((t) => t.slug === 'schedule')!.built).toBe(true)
  })
  it('an unknown count reads as not started (callers that do not load it)', () => {
    expect(computeSolarReadiness(null, 'view').find((s) => s.slug === 'schedule')!.status).toBe('grey')
    expect(computeSolarReadiness(null, 'view', { scheduleTaskCount: null }).find((s) => s.slug === 'schedule')!.reason).toBe('Not started')
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

describe('loadReadiness (spec §2.3)', () => {
  const ok = { hasSiteLoad: true, stale: false, basis: 'S2' as const, fullYearFromData: true, unassignedTenants: 0, totalTenants: 14, failingAcceptedImports: 0 }
  it('grey before anything exists', () => expect(loadReadiness(null)).toEqual({ status: 'grey', reason: 'Not started' }))
  it('red when an accepted import carries an error', () => expect(loadReadiness({ ...ok, failingAcceptedImports: 1 }).status).toBe('red'))
  it('amber with the exact unassigned sentence', () => expect(loadReadiness({ ...ok, unassignedTenants: 2 })).toEqual({ status: 'amber', reason: 'Load: 2 of 14 tenants unassigned' }))
  it('amber when measured data covers less than 12 months', () => expect(loadReadiness({ ...ok, fullYearFromData: false }).status).toBe('amber'))
  it('green for an accepted synthesised profile', () => expect(loadReadiness({ ...ok, basis: 'S3', fullYearFromData: false }).status).toBe('green'))
  it('amber when inputs changed since the build', () => expect(loadReadiness({ ...ok, stale: true }).status).toBe('amber'))
  it('amber when nothing is built yet', () => expect(loadReadiness({ ...ok, hasSiteLoad: false }).reason).toBe('No site profile built yet'))
  it('green otherwise', () => expect(loadReadiness(ok).status).toBe('green'))
  it('unassigned tenants do not hold the dot amber under S1 (bulk meter)', () => expect(loadReadiness({ ...ok, basis: 'S1', unassignedTenants: 2 }).status).toBe('green'))
  it('unassigned tenants do not hold the dot amber under S4 (monthly bills)', () => expect(loadReadiness({ ...ok, basis: 'S4', fullYearFromData: false, unassignedTenants: 2 }).status).toBe('green'))
  it('unassigned tenants hold the dot amber under S3', () => expect(loadReadiness({ ...ok, basis: 'S3', unassignedTenants: 2 }).reason).toBe('Load: 2 of 14 tenants unassigned'))
  it('an unset basis is S2: unassigned tenants hold the dot amber', () => expect(loadReadiness({ ...ok, basis: null, unassignedTenants: 2 }).status).toBe('amber'))
})

describe('schematicsReadiness (spec §2.3)', () => {
  it('green when waived', () => expect(schematicsReadiness({ waived: true, schematics: 0, studyMeters: 5, placedMeters: 0 })).toEqual({ status: 'green', reason: 'No schematic required' }))
  it('grey with none', () => expect(schematicsReadiness({ waived: false, schematics: 0, studyMeters: 5, placedMeters: 0 }).status).toBe('grey'))
  it('amber with unplaced meters', () => expect(schematicsReadiness({ waived: false, schematics: 1, studyMeters: 5, placedMeters: 3 })).toEqual({ status: 'amber', reason: '2 of 5 meters not placed' }))
  it('green when every study meter is placed', () => expect(schematicsReadiness({ waived: false, schematics: 2, studyMeters: 5, placedMeters: 5 }).status).toBe('green'))
})

describe('computeSolarReadiness with Load and Schematics', () => {
  it('computes the two steps only when the caller passes them', () => {
    const without = computeSolarReadiness(null, 'edit')
    expect(without.find((s) => s.slug === 'load')?.status).toBe('grey')
    const withBoth = computeSolarReadiness(null, 'edit', {
      load: { hasSiteLoad: true, stale: false, basis: 'S2', fullYearFromData: true, unassignedTenants: 0, totalTenants: 1, failingAcceptedImports: 0 },
      schematics: { waived: true, schematics: 0, studyMeters: 0, placedMeters: 0 },
    })
    expect(withBoth.find((s) => s.slug === 'load')).toMatchObject({ status: 'green', live: true })
    expect(withBoth.find((s) => s.slug === 'schematics')).toMatchObject({ status: 'green', live: true })
  })
})

describe('computeSolarReadiness — Layout step (Phase 5)', () => {
  const site = { latitude: -26, longitude: 28, licenseeName: 'City Power', nmdKva: 400 }
  it('without layout input the Layout step stays grey, as before', () => {
    const step = computeSolarReadiness(site, 'edit').find((s) => s.slug === 'layout')
    expect(step?.status).toBe('grey')
  })
  it('with layout input it reports the layout rule', () => {
    const step = computeSolarReadiness(site, 'edit', { layout: { layouts: 1, arraysWithModules: 1, northSet: false, arrayOutsideRoof: false } })
      .find((s) => s.slug === 'layout')
    expect(step).toMatchObject({ status: 'amber', reason: 'Layout started but no north reference' })
  })
})

describe('Layout step precedence (4b manual case vs Phase 5 aggregate)', () => {
  it('a manual-size selected case is green even when the layout aggregate says otherwise', () => {
    const step = computeSolarReadiness(null, 'edit', { layoutManual: true, layout: { layouts: 1, arraysWithModules: 0, northSet: false, arrayOutsideRoof: true } })
      .find((s) => s.slug === 'layout')
    expect(step).toMatchObject({ status: 'green', reason: 'The selected case uses a manual system size' })
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
