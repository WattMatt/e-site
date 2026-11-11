// @vitest-environment node
//
// Geometry guard for every photo-bearing report (docs/reports/pdf-layout-rules.md).
//
// The fixtures are real-shaped photos — 1536×2048 portrait and 2048×1536 landscape, like a phone
// camera — not the 1×1 PNG the other render tests use. A 1×1 image has no aspect ratio, so no
// crop or stretch could ever show up, and a text-layer assertion passes for a photo drawn below
// the paper edge. These tests read where each image is DRAWN and fail when one is outside the
// printable area, overlaps another (what 'cover' cropping and a straddling flex-wrap row both do),
// or is stretched.

import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import { renderQcReport } from './qc-report'
import { renderSnagVisitReport } from './snag-visit-report'
import { renderSiteFormReport } from './render-site-form'
import { renderInspectionReport } from './render-inspection'
import { resolveBranding } from './branding'
import { toReportJpeg } from './report-image'
import { auditPdfImages, layoutFaults } from './pdf-layout-audit'
import { siteFormReportFixture } from './__fixtures__/site-form'
import { spacing } from './theme'
import { PHOTO_GRID_2UP, PHOTO_GRID_3UP } from './photo-grid'
import type { QcReportData, QcReportEntryData } from './qc-report-data'
import type { SnagVisitReportData, ReportSnag } from './snag-visit-report-data'
import type { SiteFormReportData } from './site-form-report-data'
import type { InspectionReportData, ReportFieldRow } from './inspection-report-data'

let PORTRAIT = ''
let LANDSCAPE = ''

async function photo(width: number, height: number, r: number): Promise<string> {
  const raw = await sharp({ create: { width, height, channels: 3, background: { r, g: 120, b: 90 } } }).jpeg().toBuffer()
  const jpeg = await toReportJpeg(raw)
  return `data:image/jpeg;base64,${jpeg!.toString('base64')}`
}

beforeAll(async () => {
  PORTRAIT = await photo(1536, 2048, 200)
  LANDSCAPE = await photo(2048, 1536, 60)
})

/** Mostly portrait with the odd landscape, as site photos are. */
const pick = (i: number) => (i % 5 === 3 ? LANDSCAPE : PORTRAIT)

const branding = (title: string) => ({
  accent: '#1E2DD2',
  issuer: { wordmark: 'WM' },
  parties: [],
  title,
  kicker: title.toUpperCase(),
  projectLine: 'Layout fixture',
  footerStamp: 'Generated 2026-11-11 · e-site.live',
})

// The shape of QC Report 1 (Steyns house): 9 entries, 40 photos, descriptions of 1–5 lines.
const STEYNS_COUNTS = [9, 5, 5, 6, 4, 2, 5, 2, 2]
const STEYNS_DESCRIPTIONS = [
  'Final Fix- All sockets to be properly fixed and covers to be installed. Assure all cover is neatly fitted.',
  'Final Fix- Assure all is properly fitted and covers is neatly installed.',
  'Finalize the installation and test. Final Fix all Isolators and controls.',
  'Finalize the installation\nExisting Downlights -complete and neaten installation.\nPendants- Install as soon as instructed\nPassage- remove existing and install new\nPicture lights-Install',
  'Install Stove Isolator\nConfirm Stove and extraction is working\nConfirm Shelf LED is working from light switch\nSockets in Island outstanding',
  'This to be closed, not on drawing',
  'Install circuitry as per issued drawings\nInstall Sockets and Iso - White\nFinalize final fix',
  'Cove light outstanding-assure the ceiling properly prepped for this.\nAssure 3 x Prep heating lamps supplies installed and to be switch with Isolator.',
  'Complete DB and label properly- Redo the Legend with proper circuit descriptions.\nLight Control Db -Complete and get ready for Installing Data equipment and Programming',
]

function qcData(): QcReportData {
  const entries: QcReportEntryData[] = STEYNS_COUNTS.map((n, e) => ({
    id: `e${e}`,
    number: e + 1,
    title: `Entry ${e + 1}`,
    description: STEYNS_DESCRIPTIONS[e],
    conformance: 'fail',
    severity: 'major',
    photos: Array.from({ length: n }, (_, i) => ({
      id: `e${e}p${i}`,
      index: i + 1,
      dataUri: pick(e + i),
      caption: null,
      kind: 'photo' as const,
      planName: null,
    })),
    omittedCount: 0,
    unavailableCount: 0,
    comments: [],
  }))
  return {
    branding: branding('Quality Control Report'),
    report: {
      id: 'r', reportNo: 1, title: 'PC inspection', description: 'Final Fix', location: 'Phase 1',
      inspectionDate: '2026-11-05', status: 'issued', raisedByName: 'Inspector', issuedAt: '2026-11-06T05:41:17Z', issuedByName: 'Inspector',
    },
    projectName: 'Layout fixture',
    entries,
    tally: { pass: 0, fail: entries.length, na: 0, failBySeverity: { minor: 0, major: entries.length, critical: 0 } },
  } as QcReportData
}

function snag(id: string, n: number, status: string, before = 0, after = 0): ReportSnag {
  const mk = (k: string, c: number) => Array.from({ length: c }, (_, i) => ({ id: `${id}${k}${i}`, dataUri: pick(i), caption: `${k} ${i + 1}` }))
  return {
    id, number: id, title: `Snag ${id}`, priority: 'high', status, location: 'Level 1', category: 'Electrical',
    description: 'Cover plates missing on the east wall.', raisedByName: null, assignedToName: null, raisedOnVisitLabel: 'Visit 1',
    photos: mk('p', n), beforePhotos: mk('b', before), afterPhotos: mk('a', after),
  } as ReportSnag
}

const PRINTABLE = { top: spacing.pagePaddingV, bottom: spacing.pagePaddingV }
// Every photo fills its frame's height, or (a wide photo in a 3-up cell) nearly its width.
const FRAME_2UP = { height: PHOTO_GRID_2UP.frameHeight, minWidth: 160 }
const FRAME_3UP = { height: PHOTO_GRID_3UP.frameHeight, minWidth: 160 }

describe('report photo layout (drawn geometry)', () => {
  it('QC: all 40 photos of a Steyns-shaped report are inside the printable area, whole, and apart', async () => {
    const audit = await auditPdfImages(await renderQcReport(qcData()))
    expect(audit.images).toHaveLength(40)
    expect(layoutFaults(audit, { ...PRINTABLE, frame: FRAME_2UP })).toEqual([])
  })

  it('snag: a card with more photos than a page holds flows on; before/after grids stay apart', async () => {
    const data = {
      branding: branding('Snag & Defect Report'),
      visit: { id: 'v', visitNo: 1, isBacklog: false, visitDate: '2026-11-11', title: 'Site Visit 1', notes: null, conductedByName: 'A', attendeeNames: [], newCount: 1, openCount: 0, closedCount: 1 },
      projectName: 'Layout fixture',
      newSnags: [snag('1.1', 14, 'open')],
      stillOpen: [],
      closedThisVisit: [snag('1.2', 0, 'closed', 3, 3)],
    } as unknown as SnagVisitReportData
    const audit = await auditPdfImages(await renderSnagVisitReport(data))
    expect(audit.images).toHaveLength(20)
    expect(layoutFaults(audit, { ...PRINTABLE, frame: FRAME_2UP })).toEqual([])
  })

  it('site form: a field with many photos stays inside the body area', async () => {
    const data: SiteFormReportData = {
      ...siteFormReportFixture,
      photoFields: [
        {
          sectionId: 's', fieldId: 'f', label: 'Board — as found',
          photos: Array.from({ length: 13 }, (_, i) => ({ id: `sf${i}`, dataUri: pick(i), caption: `Photo ${i + 1}` })),
          omittedCount: 0, unavailableCount: 0,
        },
      ],
      signatures: [],
    }
    const audit = await auditPdfImages(await renderSiteFormReport(data))
    const photos = audit.images.filter((i) => i.pxW >= 1000 || i.pxH >= 1000)
    expect(photos).toHaveLength(13)
    // site-form body pages: 30 pt top, 62 pt bottom (room for the disclaimer footer).
    expect(layoutFaults({ ...audit, images: photos }, { top: 30, bottom: 62, frame: FRAME_3UP })).toEqual([])
  })

  it('inspection: entries with their photos, across sections, stay whole and inside the page', async () => {
    // Real inspections carry 1–6 photos against an entry (inline capture) plus photo fields.
    const counts = [2, 6, 1, 4, 3, 5, 2, 6, 1, 3]
    const rows: ReportFieldRow[] = counts.map((n, e) => ({
      fieldId: `f${e}`,
      label: `Check ${e + 1} — terminations tight, covers fitted, labels legible`,
      kind: 'result',
      pass: e % 3 === 0 ? 'fail' : 'pass',
      failReason: e % 3 === 0 ? 'Cover missing' : null,
      photos: {
        sectionId: 's1', fieldId: `f${e}`, label: '',
        photos: Array.from({ length: n }, (_, i) => ({ dataUri: pick(e + i), caption: `Photo ${i + 1}` })),
        omittedCount: 0,
      },
    }))
    const data = {
      inspectionId: 'i',
      summary: {
        documentNumber: 'INS-1', projectName: 'Layout fixture', projectCode: 'LF', targetLabel: 'DB-1', templateName: 'LV',
        templateVersion: '1', inspectors: 'A', verifier: null, startedAt: null, certifiedAt: null, overallResult: 'fail',
        sansReference: null, tally: { pass: 6, fail: 4, na: 0 }, failed: [], observations: [], missingPhotos: [],
      },
      sections: [
        { sectionId: 's1', title: 'Board', rows: rows.slice(0, 5), groups: [], photoFields: [] },
        {
          sectionId: 's2', title: 'Circuits', rows: rows.slice(5), groups: [],
          photoFields: [{ sectionId: 's2', fieldId: 'pf', label: 'General photos', photos: Array.from({ length: 7 }, (_, i) => ({ dataUri: pick(i), caption: `General ${i + 1}` })), omittedCount: 0 }],
        },
      ],
      annexures: [], signatures: [], audit: [],
      brandingInput: { orgName: 'WM', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectMarkDataUri: null, projectSubtitle: 'x' },
    } as unknown as InspectionReportData
    const branding = resolveBranding({ org: { name: 'WM', logoSrc: null, accent: '#E69500' }, project: { name: 'Layout fixture', clientLogoSrc: null, projectMarkSrc: null, accent: null, subtitle: null }, contractor: null, title: 'Inspection & Test Report', kicker: 'INSPECTION', date: '2026-11-11' } as never)
    const audit = await auditPdfImages(await renderInspectionReport(data, branding))
    const photos = audit.images.filter((i) => i.pxW >= 1000 || i.pxH >= 1000)
    expect(photos).toHaveLength(counts.reduce((a, b) => a + b, 0) + 7)
    expect(layoutFaults({ ...audit, images: photos }, { top: 0, bottom: spacing.pagePaddingV, frame: FRAME_3UP })).toEqual([])
  })
})
