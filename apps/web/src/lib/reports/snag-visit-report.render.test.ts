// @vitest-environment node
// Node environment is required: @react-pdf/renderer's browser build stubs out
// renderToBuffer (throws). The `browser` package.json field redirects jsdom
// to that stub, so we must opt into the Node environment for this file.

import { describe, it, expect } from 'vitest'
import { renderSnagVisitReport } from './snag-visit-report'
import type { SnagVisitReportData } from './snag-visit-report-data'

// Minimal 1×1 transparent PNG data URI — zero network access during tests.
const DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const baseData: SnagVisitReportData = {
  branding: {
    accent: '#E69500',
    issuer: { wordmark: 'Watson Mattheus Consulting' },
    parties: [],
    title: 'Snag & Defect Report',
    kicker: 'SNAG & DEFECT REPORT',
    projectLine: 'Kingswalk Mall — Site Visit 2',
    footerStamp: 'Generated 2026-06-04 · e-site.live',
  },
  visit: {
    id: 'visit-v2',
    visitNo: 2,
    isBacklog: false,
    visitDate: '2026-06-04',
    title: 'Site Visit 2',
    notes: null,
    conductedByName: 'Jane Conductor',
    attendeeNames: [],
    newCount: 2,
    openCount: 1,
    closedCount: 1,
  },
  projectName: 'Kingswalk Mall',
  newSnags: [
    {
      id: 'snag-1',
      number: '2.1',
      title: 'Missing earth bonding — main DB',
      priority: 'critical',
      status: 'open',
      location: 'Plant room',
      category: 'Safety',
      description: 'Main DB earth bonding conductor not installed.',
      raisedByName: 'Alice',
      assignedToName: null,
      raisedOnVisitLabel: 'Visit 2',
      photos: [
        { id: 'p1', dataUri: DATA_URI, caption: 'DB earth bar' },
        { id: 'p2', dataUri: DATA_URI, caption: 'Conductor stub' },
      ],
      beforePhotos: [],
      afterPhotos: [],
    },
    {
      id: 'snag-2',
      number: '2.2',
      title: 'Trunking lid missing',
      priority: 'medium',
      status: 'open',
      location: 'Level 3',
      category: 'Electrical',
      description: null,
      raisedByName: null,
      assignedToName: null,
      raisedOnVisitLabel: 'Visit 2',
      photos: [],
      beforePhotos: [],
      afterPhotos: [],
    },
  ],
  stillOpen: [
    {
      id: 'snag-3',
      number: '1.4',
      title: 'Cracked conduit, Level 2',
      priority: 'high',
      status: 'in_progress',
      location: 'East riser',
      category: 'Electrical',
      description: null,
      raisedByName: null,
      assignedToName: null,
      raisedOnVisitLabel: 'Visit 1',
      photos: [{ id: 'p3', dataUri: DATA_URI, caption: 'Current state' }],
      beforePhotos: [],
      afterPhotos: [],
    },
  ],
  closedThisVisit: [
    {
      id: 'snag-4',
      number: '1.1',
      title: 'Exposed live terminals',
      priority: 'critical',
      status: 'signed_off',
      location: 'Plant room',
      category: 'Safety',
      description: 'Terminals now insulated.',
      raisedByName: null,
      assignedToName: null,
      raisedOnVisitLabel: 'Visit 1',
      photos: [],
      beforePhotos: [{ id: 'p4', dataUri: DATA_URI, caption: 'Before' }],
      afterPhotos: [{ id: 'p5', dataUri: DATA_URI, caption: 'After ✓' }],
    },
  ],
}

describe('renderSnagVisitReport', () => {
  it('returns a Buffer that starts with the PDF magic bytes %PDF-', async () => {
    const buf = await renderSnagVisitReport(baseData)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when all three buckets are empty', async () => {
    const data: SnagVisitReportData = {
      ...baseData,
      newSnags: [],
      stillOpen: [],
      closedThisVisit: [],
      visit: { ...baseData.visit, newCount: 0, openCount: 0, closedCount: 0 },
    }
    const buf = await renderSnagVisitReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when issuer has a logo instead of a wordmark', async () => {
    const data: SnagVisitReportData = {
      ...baseData,
      branding: {
        ...baseData.branding,
        issuer: { logoSrc: DATA_URI },
      },
    }
    const buf = await renderSnagVisitReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when parties strip has entries', async () => {
    const data: SnagVisitReportData = {
      ...baseData,
      branding: {
        ...baseData.branding,
        parties: [
          { label: 'Prepared for', logoSrc: DATA_URI },
          { label: 'Project', logoSrc: DATA_URI },
        ],
      },
    }
    const buf = await renderSnagVisitReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders a backlog visit without throwing', async () => {
    const data: SnagVisitReportData = {
      ...baseData,
      visit: { ...baseData.visit, isBacklog: true, visitNo: 0 },
    }
    const buf = await renderSnagVisitReport(data)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
