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
      conformance: 'fail',
      severity: 'major',
      photos: [
        { id: 'p1', index: 1, dataUri: DATA_URI, caption: 'East bay', kind: 'photo', planName: null },
        { id: 'p2', index: 2, dataUri: DATA_URI, caption: null, kind: 'markup', planName: 'Level 3 GA' },
      ],
      omittedCount: 0,
      unavailableCount: 0,
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
      conformance: 'na',
      severity: null,
      photos: [],
      omittedCount: 3,
      unavailableCount: 0,
      comments: [],
    },
  ],
  // entry-1 fail (major) + entry-2 na
  tally: {
    pass: 0,
    fail: 1,
    na: 1,
    failBySeverity: { minor: 0, major: 1, critical: 0 },
  },
}

describe('renderQcReport', () => {
  it('returns a Buffer that starts with the PDF magic bytes %PDF-', async () => {
    const buf = await renderQcReport(baseData)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when there are no entries', async () => {
    const data: QcReportData = {
      ...baseData,
      entries: [],
      tally: { pass: 0, fail: 0, na: 0, failBySeverity: { minor: 0, major: 0, critical: 0 } },
    }
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
    const buf = await renderQcReport({
      ...baseData,
      branding: {
        ...baseData.branding,
        issuer: { logoSrc: DATA_URI },
      },
    })
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Text-layer assertions — parse the rendered PDF (pdfjs-dist) and confirm the
// conformance model surfaces: per-entry badge, conformance summary tally,
// defect punch-list, the DRAFT watermark on non-issued reports, and the
// within-cap "image unavailable" placeholder / omitted note (Defect S4).
// ─────────────────────────────────────────────────────────────────────────────

/** Extract page count + concatenated text content from a rendered PDF. */
async function parsePdf(buf: Buffer): Promise<{ pageCount: number; text: string }> {
  // Dynamic import: the legacy build is Node-compatible, but keep it out of
  // the module graph of anything that might be bundled for the browser.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({
    data: new Uint8Array(buf),
    disableFontFace: true,
    verbosity: 0, // silence pdfjs warnings in test output
  }).promise
  try {
    let text = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      text +=
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ') + '\n'
    }
    return { pageCount: doc.numPages, text }
  } finally {
    await doc.destroy()
  }
}

/** Collapse whitespace — letter-spaced runs (the watermark) may split. */
const squash = (s: string) => s.replace(/\s+/g, '')

describe('renderQcReport conformance model', () => {
  it('renders the per-entry conformance badge labels', async () => {
    const { text } = await parsePdf(await renderQcReport(baseData))
    // Fail entry badge + N/A entry badge both surface their conformance label.
    expect(text).toContain('Fail')
    expect(text).toContain('N/A')
  })

  it('renders the conformance summary tally block', async () => {
    const { text } = await parsePdf(await renderQcReport(baseData))
    // Heading is uppercased by textTransform.
    expect(text).toContain('CONFORMANCE SUMMARY')
    // Tally tiles: Pass/Fail/N-A counts.
    expect(text).toContain('Pass 0')
    expect(text).toContain('Fail 1')
    expect(text).toContain('N/A 1')
    // Severity breakdown line for the single major fail.
    expect(text).toContain('Major 1')
  })

  it('renders the defect punch-list with the failing entry', async () => {
    const { text } = await parsePdf(await renderQcReport(baseData))
    // Heading is uppercased by textTransform.
    expect(text).toContain('DEFECT PUNCH-LIST')
    // The fail entry's title appears in the punch-list; its severity chip label
    // (Major) is present too. The passing/N-A entry is NOT a defect.
    expect(text).toContain('Rebar spacing')
    expect(text).toContain('Major')
  })

  it('omits the punch-list and severity line when there are no fails', async () => {
    const data: QcReportData = {
      ...baseData,
      entries: [
        { ...baseData.entries[1], id: 'only-na', number: 1, conformance: 'na', severity: null },
      ],
      tally: { pass: 0, fail: 0, na: 1, failBySeverity: { minor: 0, major: 0, critical: 0 } },
    }
    const { text } = await parsePdf(await renderQcReport(data))
    expect(text).not.toContain('DEFECT PUNCH-LIST')
    // Summary still renders (0 fails), but no by-severity line.
    expect(text).toContain('CONFORMANCE SUMMARY')
    expect(text).not.toContain('Fails by severity')
  })
})

describe('renderQcReport draft watermark', () => {
  it('stamps DRAFT when the report is not issued', async () => {
    const draft: QcReportData = { ...baseData, report: { ...baseData.report, status: 'draft' } }
    const { text } = await parsePdf(await renderQcReport(draft))
    expect(squash(text)).toContain('DRAFT')
  })

  it('does not stamp DRAFT on an issued report', async () => {
    const { text } = await parsePdf(await renderQcReport(baseData))
    expect(squash(text)).not.toContain('DRAFT')
  })
})

describe('renderQcReport photo availability (Defect S4)', () => {
  it('renders an "image unavailable" placeholder and folds it into the note', async () => {
    const data: QcReportData = {
      ...baseData,
      entries: [
        {
          ...baseData.entries[0],
          id: 'entry-s4',
          number: 1,
          photos: [
            { id: 'ok', index: 1, dataUri: DATA_URI, caption: null, kind: 'photo', planName: null },
            // Within-cap download failure → placeholder cell, numbering preserved.
            { id: 'gone', index: 2, dataUri: null, caption: null, kind: 'photo', planName: null },
          ],
          omittedCount: 3,
          unavailableCount: 1,
          comments: [],
        },
      ],
    }
    const { text } = await parsePdf(await renderQcReport(data))
    // Placeholder cell text + preserved Photo 2 tag.
    expect(text).toContain('Image unavailable')
    expect(text).toContain('Photo 2')
    // Folded note: omitted + unavailable together.
    expect(text).toContain('+3 omitted')
    expect(text).toContain('1 image unavailable')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pagination — entries with many photos must FLOW across pages, not clip.
//
// Regression for the wrap={false} entry card: the whole entry (header + photo
// grid + comments) was one unbreakable View, but 24 photos are ~1,300pt of
// grid against ~766pt of usable A4 body, so react-pdf moved the card to a
// fresh page and silently CLIPPED everything past the page bottom — photos
// ~13-24 and the entire comments block vanished from the issued PDF with no
// error. These tests parse the rendered output (pdfjs-dist) and assert the
// clipped content is actually present in the PDF text layer; they fail on the
// old layout (verified by reverting the component fix).
// ─────────────────────────────────────────────────────────────────────────────

const TRAILING_COMMENT = 'Rectify bracket spacing before the level 4 pour.'

/** One entry with `count` photos and a trailing whole-entry comment. */
function entryWithPhotos(count: number) {
  return {
    id: 'entry-many-photos',
    number: 1,
    title: 'Cable tray supports — east riser',
    description: 'Full photographic record of the riser installation.',
    conformance: 'pass' as const,
    severity: null,
    photos: Array.from({ length: count }, (_, i) => ({
      id: `photo-${i + 1}`,
      index: i + 1,
      dataUri: DATA_URI,
      caption: null,
      kind: 'photo' as const,
      planName: null,
    })),
    omittedCount: 0,
    unavailableCount: 0,
    comments: [
      {
        id: 'trailing-comment',
        authorName: 'Site Agent',
        createdAt: '2026-07-14T11:00:00Z',
        body: TRAILING_COMMENT,
        photoIndex: null,
      },
    ],
  }
}

describe('renderQcReport pagination (photo-heavy entries)', () => {
  it('page count strictly grows between a 2-photo and a 24-photo entry', async () => {
    const [small, large] = await Promise.all([
      renderQcReport({ ...baseData, entries: [entryWithPhotos(2)] }),
      renderQcReport({ ...baseData, entries: [entryWithPhotos(24)] }),
    ])
    const [smallPdf, largePdf] = await Promise.all([parsePdf(small), parsePdf(large)])
    // 24 photos cannot fit the pages 2 photos need — the grid must have
    // flowed onto additional pages instead of clipping at the page bottom.
    expect(largePdf.pageCount).toBeGreaterThan(smallPdf.pageCount)
  })

  it('renders the last photo tag and the trailing comment of a 24-photo entry', async () => {
    const buf = await renderQcReport({ ...baseData, entries: [entryWithPhotos(24)] })
    const { text } = await parsePdf(buf)
    // The final photo's tag survives — nothing was clipped off the page.
    expect(text).toContain('Photo 24')
    // The comments block FOLLOWS the grid, so it is the first casualty of an
    // unbreakable card — assert the body text made it into the output.
    expect(text).toContain(TRAILING_COMMENT)
  })
})
