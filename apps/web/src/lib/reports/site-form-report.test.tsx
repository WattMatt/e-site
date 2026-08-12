// @vitest-environment node
// Node is REQUIRED: @react-pdf/renderer's browser build stubs out renderToBuffer,
// and the `browser` package.json field redirects jsdom straight to that stub.

import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { NOT_A_COC_DISCLAIMER } from '@esite/shared'
import { renderSiteFormReport } from './render-site-form'
import {
  siteFormReportFixture,
  emptySiteFormReportFixture,
  HOSTILE_MULTILINE,
  HOSTILE_GLYPHS,
} from './__fixtures__/site-form'
import type { SiteFormReportData } from './site-form-report-data'

/**
 * Pull the visible text back out of a rendered PDF.
 *
 * PDFKit deflates every content stream and writes each text run as a hex
 * string inside a `TJ` array, so the bytes are neither greppable nor readable
 * without inflating first. Inflate every stream, decode the hex runs, then
 * normalise whitespace — that reassembles the wrapped, per-word runs into
 * ordinary prose we can assert against.
 */
function extractPdfTextPerStream(buf: Buffer): string[] {
  const out: string[] = []
  const streamMarker = Buffer.from('stream')
  const endMarker = Buffer.from('endstream')
  let cursor = 0
  for (;;) {
    const start = buf.indexOf(streamMarker, cursor)
    if (start === -1) break
    const end = buf.indexOf(endMarker, start)
    if (end === -1) break
    let dataStart = start + streamMarker.length
    while (buf[dataStart] === 0x0d || buf[dataStart] === 0x0a) dataStart++
    const chunk = buf.subarray(dataStart, end)
    let decoded: string
    try {
      decoded = zlib.inflateSync(chunk).toString('latin1')
    } catch {
      decoded = chunk.toString('latin1')
    }
    let text = ''
    for (const match of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) {
      text += Buffer.from(match[1], 'hex').toString('latin1')
    }
    out.push(text)
    cursor = end + endMarker.length
  }
  return out
}

const extractPdfText = (buf: Buffer): string => extractPdfTextPerStream(buf).join(' ')

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('renderSiteFormReport', () => {
  it('renders a non-empty buffer beginning with the PDF magic bytes', async () => {
    const buf = await renderSiteFormReport(siteFormReportFixture)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('survives hostile unicode anywhere in the payload', async () => {
    // The class of bug this guards: pdf-lib's standard Helvetica is WinAnsi-only,
    // so a single `Ω` or `→` threw on EVERY render of the cable-schedule PDF pack
    // for two months (PR #154). react-pdf handles these glyphs — this test is
    // what keeps that guarantee honest for the site-form pack.
    const hostile: SiteFormReportData = {
      ...siteFormReportFixture,
      summary: {
        ...siteFormReportFixture.summary,
        formNo: HOSTILE_MULTILINE,
        boardLabel: HOSTILE_GLYPHS,
        boardRef: HOSTILE_MULTILINE,
        asLeftStatusText: HOSTILE_GLYPHS,
        electricianName: HOSTILE_MULTILINE,
        projectName: HOSTILE_GLYPHS,
      },
      branding: {
        ...siteFormReportFixture.branding,
        title: HOSTILE_GLYPHS,
        kicker: HOSTILE_MULTILINE,
        projectLine: HOSTILE_MULTILINE,
        footerStamp: HOSTILE_GLYPHS,
        issuer: { wordmark: HOSTILE_MULTILINE },
      },
      defects: siteFormReportFixture.defects.map((d) => ({
        ...d,
        description: HOSTILE_MULTILINE,
        location: HOSTILE_GLYPHS,
        actionTaken: HOSTILE_MULTILINE,
      })),
      signatures: siteFormReportFixture.signatures.map((sg) => ({
        ...sg,
        signatoryName: HOSTILE_MULTILINE,
        registrationNumber: HOSTILE_GLYPHS,
      })),
      audit: siteFormReportFixture.audit.map((a) => ({
        ...a,
        fieldLabel: HOSTILE_GLYPHS,
        value: HOSTILE_MULTILINE,
        by: HOSTILE_GLYPHS,
      })),
      photoFields: siteFormReportFixture.photoFields.map((f) => ({
        ...f,
        label: HOSTILE_MULTILINE,
        photos: f.photos.map((p) => ({ ...p, caption: HOSTILE_GLYPHS })),
      })),
    }

    const buf = await renderSiteFormReport(hostile)
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('carries the non-CoC disclaimer verbatim, on every page', async () => {
    const buf = await renderSiteFormReport(siteFormReportFixture)
    // Asserted against the shared constant, never a local copy — the PDF and
    // the distribution email must be unable to drift apart.
    const wanted = squash(NOT_A_COC_DISCLAIMER)
    expect(squash(extractPdfText(buf))).toContain(wanted)

    // Each page's content stream must carry it: this is the whole reason the
    // form exists, so a reader who sees one loose page cannot mistake it for a
    // Certificate of Compliance.
    const pageCount = (await PDFDocument.load(buf)).getPageCount()
    expect(pageCount).toBeGreaterThan(1)
    const pagesWithDisclaimer = extractPdfTextPerStream(buf).filter((t) =>
      squash(t).includes(wanted),
    ).length
    expect(pagesWithDisclaimer).toBe(pageCount)
  })

  it('renders an empty draft — zero responses, zero photos, zero signatures', async () => {
    // The first thing a real user clicks after creating a form is "Preview".
    const buf = await renderSiteFormReport(emptySiteFormReportFixture)
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    const text = squash(extractPdfText(buf))
    // The disclaimer is not conditional on there being anything to disclaim.
    expect(text).toContain(squash(NOT_A_COC_DISCLAIMER))
    expect(text).toContain('No sections captured.')
    expect(text).toContain('No photographs captured.')
    expect(text).toContain('No defects recorded.')
    expect(text).toContain('No signatures captured.')
  })

  it('flags C1 defects and the temporary-circuit count in the summary', async () => {
    const buf = await renderSiteFormReport(siteFormReportFixture)
    const text = squash(extractPdfText(buf))
    expect(text).toContain('1 C1 defect recorded')
    expect(text).toContain('1 circuit left in a temporary state')
    expect(text).toContain('Made safe')
  })
})
