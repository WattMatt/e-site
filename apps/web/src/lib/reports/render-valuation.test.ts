// @vitest-environment node
// Node environment is required: @react-pdf/renderer's browser build stubs out
// renderToBuffer (throws). The `browser` package.json field redirects jsdom
// to that stub, so we must opt into the Node environment for this file.

import { describe, it, expect } from 'vitest'
import { renderValuationReport } from './render-valuation'
import type { ValuationReportData } from './valuation-report-data'

const baseData: ValuationReportData = {
  branding: {
    accent: '#E69500',
    issuer: { wordmark: 'Watson Mattheus Consulting' },
    parties: [],
    title: 'Payment Certificate No. 2',
    kicker: 'PAYMENT CERTIFICATE',
    projectLine: 'Kingswalk Mall — Certificate No. 2',
    footerStamp: 'Generated 2026-06-10 · e-site.live',
  },
  projectName: 'Kingswalk Mall',
  valuation: { no: 2, date: '2026-06-10', status: 'draft', retentionPct: 10 },
  summary: {
    grossToDate: 700,
    retention: 70,
    netToDate: 630,
    previousNet: 100,
    dueExVat: 530,
    vat: 79.5,
    dueInclVat: 609.5,
  },
  bills: [
    { code: 'A', title: 'Bill A — Electrical', grossToDate: 500, thisPeriod: 500, retention: 50 },
    { code: 'B', title: 'Bill B — Generators', grossToDate: 200, thisPeriod: 200, retention: 20 },
  ],
  certifiedByName: 'Pat Engineer',
}

describe('renderValuationReport', () => {
  it('returns a Buffer that starts with the PDF magic bytes %PDF-', async () => {
    const buf = await renderValuationReport(baseData)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when there are no bills', async () => {
    const data: ValuationReportData = { ...baseData, bills: [] }
    const buf = await renderValuationReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when the issuer has a logo and a parties strip', async () => {
    const DATA_URI =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const data: ValuationReportData = {
      ...baseData,
      branding: {
        ...baseData.branding,
        issuer: { logoSrc: DATA_URI },
        parties: [
          { label: 'Prepared for', logoSrc: DATA_URI },
          { label: 'Project', logoSrc: DATA_URI },
        ],
      },
    }
    const buf = await renderValuationReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when there is no certifier name', async () => {
    const data: ValuationReportData = { ...baseData, certifiedByName: null }
    const buf = await renderValuationReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
