// @vitest-environment node
// Node environment is required: @react-pdf/renderer's browser build stubs out
// renderToBuffer (throws). The `browser` package.json field redirects jsdom
// to that stub, so we must opt into the Node environment for this file.

import { describe, it, expect } from 'vitest'
import { renderInspectionReport } from './render-inspection'
import { resolveBranding } from './branding'
import type { BrandingInput } from './branding'
import type { InspectionReportData } from './inspection-report-data'

// Minimal 1×1 transparent PNG — zero network access during tests.
const DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

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
    subtitle: 'Phase 2',
  },
  contractor: null,
  title: 'Inspection & Test Report',
  kicker: 'ELECTRICAL INSPECTION',
  date: '2026-06-03',
}

const fixtureResolved = resolveBranding(fixtureBrandingInput)

// ---------------------------------------------------------------------------
// Fixture InspectionReportData — exercises every field type + edge cases
// ---------------------------------------------------------------------------

const fixtureData: InspectionReportData = {
  inspectionId: 'insp-fixture-001',
  summary: {
    documentNumber: 'COC-2026-001',
    projectName: 'Kingswalk Mall',
    projectCode: 'KING001',
    targetLabel: 'DB-MDB-01 — Main Distribution Board',
    templateName: 'Low Voltage Installation (SANS 10142-1)',
    templateVersion: '2',
    inspectors: 'Jane Smith, John Doe',
    verifier: 'Alice Van Der Berg',
    startedAt: '2026-05-01T08:00:00.000Z',
    certifiedAt: '2026-05-15T14:30:00.000Z',
    overallResult: 'pass',
    sansReference: 'SANS 10142-1:2020',
    tally: { pass: 8, fail: 1, na: 2 },
    failed: [
      { label: 'Earth continuity — Circuit breaker rating', sansRef: 'SANS 10142-1 §6.4' },
    ],
  },
  sections: [
    {
      sectionId: 'sec-001',
      title: 'General Installation',
      rows: [
        { fieldId: 'f-001', label: 'Supply voltage', kind: 'value', value: '230V AC' },
        {
          fieldId: 'f-002',
          label: 'Circuit breaker rating',
          kind: 'result',
          pass: 'pass',
          sansRef: 'SANS 10142-1 §6.2',
        },
        {
          fieldId: 'f-003',
          label: 'Earth continuity',
          kind: 'result',
          pass: 'fail',
          failReason: 'Resistance 12Ω exceeds 1Ω limit',
          sansRef: 'SANS 10142-1 §6.4',
        },
        {
          fieldId: 'f-004',
          label: 'Insulation resistance',
          kind: 'result',
          pass: 'na',
        },
        {
          fieldId: 'f-005',
          label: 'General Notes',
          kind: 'paragraph',
          value:
            'The installation was found to be in generally acceptable condition with one defect noted.',
        },
        {
          fieldId: 'f-006',
          label: 'Observed defects',
          kind: 'list',
          value: 'Loose connection on L3\nWorn insulation on neutral bar',
        },
        {
          fieldId: 'f-007',
          label: 'Visual Inspection',
          kind: 'subheading',
        },
      ],
      groups: [
        {
          fieldId: 'g-001',
          label: 'Circuit breakers',
          entries: [
            {
              index: 0,
              rows: [
                { fieldId: 'g-001[0].label', label: 'Breaker label', kind: 'value', value: 'L1 - Lights' },
                { fieldId: 'g-001[0].rating', label: 'Rating (A)', kind: 'value', value: '16' },
                { fieldId: 'g-001[0].result', label: 'Pass/Fail', kind: 'result', pass: 'pass' },
              ],
            },
            {
              index: 1,
              rows: [
                { fieldId: 'g-001[1].label', label: 'Breaker label', kind: 'value', value: 'L2 - Sockets' },
                { fieldId: 'g-001[1].rating', label: 'Rating (A)', kind: 'value', value: '20' },
                { fieldId: 'g-001[1].result', label: 'Pass/Fail', kind: 'result', pass: 'pass' },
              ],
            },
          ],
        },
      ],
      photoFields: [
        {
          sectionId: 'sec-001',
          fieldId: 'pf-001',
          label: 'Distribution board photos',
          photos: [
            { dataUri: DATA_URI, caption: '2026-05-01 · by Jane Smith' },
            { dataUri: null, caption: 'Image unavailable' },
          ],
          omittedCount: 3,
        },
      ],
    },
    {
      sectionId: 'sec-002',
      title: 'Cable Installation',
      rows: [
        { fieldId: 'f-008', label: 'Cable sizing verified', kind: 'result', pass: 'pass' },
      ],
      groups: [],
      photoFields: [],
    },
  ],
  annexures: [
    {
      name: 'Installation photo set',
      source: 'attachment',
      href: 'https://example.com/attachment/123',
      thumbnailDataUri: DATA_URI,
      meta: 'JPEG · 2.4 MB',
    },
  ],
  signatures: [
    {
      role: 'Inspector',
      name: 'Jane Smith',
      title: 'Registered Electrician',
      registrationNumber: 'WP-12345',
      signedAt: '2026-05-15T14:30:00.000Z',
      imageDataUri: DATA_URI,
    },
    {
      role: 'Verifier',
      name: 'Alice Van Der Berg',
      title: null,
      registrationNumber: null,
      signedAt: null,
      imageDataUri: null,
    },
  ],
  audit: [
    { at: '2026-05-01T08:15:00.000Z', sectionId: 'sec-001', fieldId: 'f-002', by: 'Jane Smith' },
    { at: '2026-05-01T08:20:00.000Z', sectionId: 'sec-001', fieldId: 'f-003', by: 'Jane Smith' },
    { at: '2026-05-15T14:00:00.000Z', sectionId: null, fieldId: null, by: 'Alice Van Der Berg' },
  ],
  brandingInput: {
    orgName: 'Watson Mattheus Consulting',
    orgLogoDataUri: DATA_URI,
    orgAccent: '#E69500',
    projectAccent: null,
    clientLogoDataUri: DATA_URI,
    projectMarkDataUri: DATA_URI,
    projectSubtitle: 'Kingswalk Mall — DB-MDB-01 · 2026-06-03',
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderInspectionReport', () => {
  it('returns a Buffer that starts with PDF magic bytes %PDF-', async () => {
    const buf = await renderInspectionReport(fixtureData, fixtureResolved)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when data is fully present', async () => {
    await expect(renderInspectionReport(fixtureData, fixtureResolved)).resolves.toBeDefined()
  })

  it('renders without throwing when all arrays are empty (degraded mode)', async () => {
    const emptyData: InspectionReportData = {
      ...fixtureData,
      sections: [],
      annexures: [],
      signatures: [],
      audit: [],
      summary: {
        ...fixtureData.summary,
        tally: { pass: 0, fail: 0, na: 0 },
        failed: [],
        overallResult: null,
      },
    }
    await expect(renderInspectionReport(emptyData, fixtureResolved)).resolves.toBeDefined()
  })

  it('renders without throwing when photo dataUri is null', async () => {
    const dataWithNullPhoto: InspectionReportData = {
      ...fixtureData,
      sections: [
        {
          ...fixtureData.sections[0]!,
          photoFields: [
            {
              sectionId: 'sec-001',
              fieldId: 'pf-null',
              label: 'Photos with null',
              photos: [{ dataUri: null, caption: '' }],
              omittedCount: 0,
            },
          ],
        },
      ],
    }
    await expect(renderInspectionReport(dataWithNullPhoto, fixtureResolved)).resolves.toBeDefined()
  })

  it('renders without throwing when signature imageDataUri is null', async () => {
    const dataWithNullSig: InspectionReportData = {
      ...fixtureData,
      signatures: [
        {
          role: 'Inspector',
          name: 'No Image',
          title: null,
          registrationNumber: null,
          signedAt: null,
          imageDataUri: null,
        },
      ],
    }
    await expect(renderInspectionReport(dataWithNullSig, fixtureResolved)).resolves.toBeDefined()
  })

  it('renders with overallResult=conditional_pass without throwing', async () => {
    const dataConditional: InspectionReportData = {
      ...fixtureData,
      summary: { ...fixtureData.summary, overallResult: 'conditional_pass' },
    }
    await expect(renderInspectionReport(dataConditional, fixtureResolved)).resolves.toBeDefined()
  })

  it('renders with overallResult=fail and returns valid PDF bytes', async () => {
    const dataFail: InspectionReportData = {
      ...fixtureData,
      summary: { ...fixtureData.summary, overallResult: 'fail' },
    }
    const buf = await renderInspectionReport(dataFail, fixtureResolved)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders when issuer has wordmark instead of logo', async () => {
    const wordmarkBranding = resolveBranding({
      ...fixtureBrandingInput,
      org: { name: 'Watson Mattheus Consulting', logoSrc: undefined, accent: '#E69500' },
    })
    const buf = await renderInspectionReport(fixtureData, wordmarkBranding)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
