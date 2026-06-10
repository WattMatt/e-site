// @vitest-environment node
// Node environment is required: @react-pdf/renderer's browser build stubs out
// renderToBuffer (throws). The `browser` package.json field redirects jsdom
// to that stub, so we must opt into the Node environment for this file.

import { describe, it, expect } from 'vitest'
import { renderGeneratorReport } from './render-generator'
import { resolveBranding } from './branding'
import type { BrandingInput } from './branding'
import type { GeneratorReportData } from './generator-report-data'
import {
  buildGeneratorCostRecovery,
  capitalCostBreakdown,
  DEFAULT_GENERATOR_SETTINGS,
  DEFAULT_REPORT_NARRATIVE,
  type ZoneInput,
  type TenantInput,
} from '@esite/shared'

// Minimal 1×1 transparent PNG — zero network access during tests.
const DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// ---------------------------------------------------------------------------
// Fixture — 2 zones, 3 tenants (one opt-out with participation='none')
// ---------------------------------------------------------------------------

const zones: ZoneInput[] = [
  {
    zoneName: 'Zone A',
    generators: [
      { size: '250 kVA', cost: 500_000 },
    ],
  },
  {
    zoneName: 'Zone B',
    generators: [
      { size: '150 kVA', cost: 300_000 },
    ],
  },
]

const tenants: TenantInput[] = [
  { shopNumber: 'T01', shopName: 'Alpha Café',    areaM2: 150, category: 'standard',  participation: 'shared', manualKwOverride: null },
  { shopNumber: 'T02', shopName: 'Beta Fashions', areaM2: 200, category: 'national',  participation: 'shared', manualKwOverride: null },
  // opt-out — participation='none'; should appear greyed in Appendix C
  { shopNumber: 'T03', shopName: 'Gamma Foods',   areaM2: 80,  category: 'fast_food', participation: 'none',   manualKwOverride: null },
]

const settings = {
  ...DEFAULT_GENERATOR_SETTINGS,
  ratePerTenantDb: 5_000,
  numMainBoards: 1,
  ratePerMainBoard: 20_000,
  additionalCablingCost: 50_000,
  controlWiringCost: 15_000,
}

const engineInput = { settings, zones, tenants }
const model = buildGeneratorCostRecovery(engineInput)
const breakdown = capitalCostBreakdown(zones, tenants, settings)

const fixtureData: GeneratorReportData = {
  projectName: 'Kingswalk Mall',
  model,
  breakdown,
  settings,
  narrative: DEFAULT_REPORT_NARRATIVE,
  zoneByShop: { T01: 'Zone A', T02: 'Zone B', T03: null },
  zoneSummaries: [
    { zoneName: 'Zone A', tenantCount: 1, totalLoadKw: 4.5, requiredKva: 4.74, installedKva: 250 },
    { zoneName: 'Zone B', tenantCount: 1, totalLoadKw: 6.0, requiredKva: 6.32, installedKva: 150 },
  ],
  brandingInput: {
    orgName: 'Watson Mattheus Consulting',
    orgLogoDataUri: DATA_URI,
    orgAccent: '#E69500',
    projectAccent: null,
    clientLogoDataUri: DATA_URI,
    projectMarkDataUri: DATA_URI,
    projectSubtitle: 'Kingswalk Mall',
  },
}

// ---------------------------------------------------------------------------
// Fixture branding
// ---------------------------------------------------------------------------

const fixtureBrandingInput: BrandingInput = {
  org: { name: 'Watson Mattheus Consulting', logoSrc: DATA_URI, accent: '#E69500' },
  project: {
    name: 'Kingswalk Mall',
    clientLogoSrc: DATA_URI,
    projectMarkSrc: DATA_URI,
    accent: null,
    subtitle: 'Generator Cost Recovery',
  },
  contractor: null,
  title: 'Generator Cost Recovery Report',
  kicker: 'STANDBY POWER',
  date: '2026-06-09',
}

const fixtureResolved = resolveBranding(fixtureBrandingInput)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderGeneratorReport', () => {
  it('returns a Buffer that starts with PDF magic bytes %PDF-', async () => {
    const buf = await renderGeneratorReport(fixtureData, fixtureResolved)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders without throwing when data is fully present', async () => {
    await expect(renderGeneratorReport(fixtureData, fixtureResolved)).resolves.toBeDefined()
  })

  it('renders when issuer has wordmark instead of logo', async () => {
    const wordmarkBranding = resolveBranding({
      ...fixtureBrandingInput,
      org: { name: 'Watson Mattheus Consulting', logoSrc: undefined, accent: '#E69500' },
    })
    const buf = await renderGeneratorReport(fixtureData, wordmarkBranding)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders without throwing when allocation list has opt-out tenant', async () => {
    // Fixture already includes a 'none' participation tenant — just confirm
    const optOutAlloc = fixtureData.model.allocations.find((a) => a.participation === 'none')
    expect(optOutAlloc).toBeDefined()
    await expect(renderGeneratorReport(fixtureData, fixtureResolved)).resolves.toBeDefined()
  })

  it('renders custom multi-paragraph narrative without throwing', async () => {
    const customData: GeneratorReportData = {
      ...fixtureData,
      narrative: {
        introduction: 'Intro paragraph one.\n\nIntro paragraph two.',
        plantSizing: 'Sizing basis text.',
        systemOutline: 'System outline text.',
        switching: 'Switching system text.',
      },
    }
    const buf = await renderGeneratorReport(customData, fixtureResolved)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
