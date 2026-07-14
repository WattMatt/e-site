// @vitest-environment node
// Node environment is required: @react-pdf/renderer's browser build stubs out
// renderToBuffer (throws). The `browser` package.json field redirects jsdom
// to that stub, so we must opt into the Node environment for this file.

import { describe, it, expect } from 'vitest'
import { renderQcReport } from './qc-report'
import type { QcReportData } from './qc-report-data'

// Minimal 1×1 transparent PNG data URI — zero network access during tests.
const DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const baseData: QcReportData = {
  branding: {
    accent: '#E69500',
    issuer: { wordmark: 'Watson Mattheus Consulting' },
    parties: [],
    title: 'Quality Control Report',
    kicker: 'QUALITY CONTROL REPORT',
    projectLine: 'Kingswalk Mall — QC Report 7',
    footerStamp: 'Generated 2026-07-14 · e-site.live',
  },
  report: {
    id: 'report-1',
    reportNo: 7,
    title: 'Slab pour QC',
    description: 'Pre-pour inspection of level 3 slab reinforcement.',
    location: 'Level 3',
    inspectionDate: '2026-07-14',
    status: 'issued',
    raisedByName: 'Jane Inspector',
    issuedAt: '2026-07-14T10:00:00Z',
    issuedByName: 'Jane Inspector',
  },
  projectName: 'Kingswalk Mall',
  entries: [
    {
      id: 'entry-1',
      number: 1,
      title: 'Rebar spacing — east bay',
      description: 'Spacing exceeds 200mm in two spans.',
      photos: [
        { id: 'p1', index: 1, dataUri: DATA_URI, caption: 'East bay', kind: 'photo', planName: null },
        { id: 'p2', index: 2, dataUri: DATA_URI, caption: null, kind: 'markup', planName: 'Level 3 GA' },
      ],
      omittedCount: 0,
      comments: [
        {
          id: 'c1',
          authorName: 'Bob Builder',
          createdAt: '2026-07-14T09:00:00Z',
          body: 'Rectified before pour.',
          photoIndex: null,
        },
        {
          id: 'c2',
          authorName: null,
          createdAt: '2026-07-14T09:30:00Z',
          body: 'This span still short one bar.',
          photoIndex: 2,
        },
      ],
    },
    {
      id: 'entry-2',
      number: 2,
      title: 'Cover blocks',
      description: null,
      photos: [],
      omittedCount: 3,
      comments: [],
    },
  ],
}

describe('renderQcReport', () => {
  it('returns a Buffer that starts with the PDF magic bytes %PDF-', async () => {
    const buf = await renderQcReport(baseData)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when there are no entries', async () => {
    const data: QcReportData = { ...baseData, entries: [] }
    const buf = await renderQcReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when a markup photo has no plan name', async () => {
    const data: QcReportData = {
      ...baseData,
      entries: [
        {
          ...baseData.entries[0],
          photos: [
            { id: 'p1', index: 1, dataUri: DATA_URI, caption: null, kind: 'markup', planName: null },
          ],
        },
      ],
    }
    const buf = await renderQcReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when issuer has a logo instead of a wordmark', async () => {
    const data: QcReportData = {
      ...baseData,
      branding: {
        ...baseData.branding,
        issuer: { logoSrc: DATA_URI },
      },
    }
    const buf = await renderQcReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
