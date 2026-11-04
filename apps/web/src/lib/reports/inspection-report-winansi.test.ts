// @vitest-environment node
// Node environment: @react-pdf/renderer's browser build stubs out renderToBuffer.

/**
 * The inspection report is a legal record. react-pdf draws with standard
 * Helvetica (WinAnsi only) and does NOT throw on anything else: it truncates the
 * code point to its low byte, so `Ω` printed as `©`, `≤` as the letter `d`, and
 * `✓` vanished into a control character. These tests read the glyphs back out
 * of the rendered PDF — asserting that "the PDF rendered" can never fail.
 */

import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { renderInspectionReport } from './render-inspection'
import { sanitiseInspectionReportData, sanitiseBranding } from './inspection-report'
import { resolveBranding } from './branding'
import type { InspectionReportData } from './inspection-report-data'
import { isWinAnsiSafe } from '@/lib/pdf/winansi'

const DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// WinAnsi 0x80–0x9F as Unicode code points (0 = undefined). Without this the
// decoder reads latin1 and every assertion about real punctuation passes vacuously.
const WINANSI_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
]

function fromWinAnsi(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code >= 0x80 && code <= 0x9f) {
      const mapped = WINANSI_HIGH[code - 0x80]
      out += mapped === 0 ? '' : String.fromCharCode(mapped)
    } else {
      out += raw[i]
    }
  }
  return out
}

/** Inflate every content stream and decode PDFKit's hex text runs. */
function extractPdfText(buf: Buffer): string {
  const parts: string[] = []
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
    for (const m of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) {
      text += fromWinAnsi(Buffer.from(m[1], 'hex').toString('latin1'))
    }
    parts.push(text)
    cursor = end + endMarker.length
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

// Each slot carries a distinct tag so a failure names the slot that leaked.
const hostileData: InspectionReportData = {
  inspectionId: 'insp-winansi',
  summary: {
    documentNumber: 'INS-ZZ-2026-0001',
    projectName: 'Projekt Ω-Park',
    projectCode: 'ZZ',
    targetLabel: 'DB-1 → MB-2',
    templateName: 'LV ≤ 1000 V',
    templateVersion: '3',
    inspectors: 'Inspector Ω',
    verifier: 'Verifier ✓',
    startedAt: '2026-05-01T08:00:00.000Z',
    certifiedAt: null,
    overallResult: 'fail',
    sansReference: 'SANS 10142-1 ≥ 2020',
    tally: { pass: 1, fail: 1, na: 0 },
    failed: [{ label: 'FailLabel Ω', reason: 'Resistance 12Ω exceeds 1Ω limit', sansRef: 'Ref ≤ 6.4' }],
    observations: [{ label: 'ObsLabel ✓', reason: 'ObsReason ≤ 0,2 Ω', sansRef: null }],
    missingPhotos: [{ label: 'MissLabel Ω', reason: 'MissReason ✓ locked' }],
  },
  sections: [
    {
      sectionId: 's1',
      title: 'Section Ω title',
      rows: [
        { fieldId: 'r1', label: 'Proving dead ≤ 50 V', kind: 'value', value: 'Measured 0,1 Ω' },
        { fieldId: 'r2', label: 'ResultLabel Ω', kind: 'result', pass: 'fail', failReason: 'RowFail ≤ 0,2 Ω', sansRef: 'RowRef Ω' },
        { fieldId: 'r3', label: 'Comment Ω', kind: 'paragraph', value: 'Para line one Ω\nPara line two ✓' },
        { fieldId: 'r4', label: 'Snag list', kind: 'list', value: 'Snag one ≤ spec\nSnag two Ω' },
        { fieldId: 'r5', label: 'Answer ✓', kind: 'value', value: '✓' },
      ],
      groups: [
        {
          fieldId: 'g1',
          label: 'Group Ω label',
          entries: [{ index: 0, rows: [{ fieldId: 'g1[0].a', label: 'GroupRow Ω', kind: 'value', value: 'GroupVal ≤ 5' }] }],
        },
      ],
      photoFields: [
        {
          sectionId: 's1',
          fieldId: 'p1',
          label: 'PhotoLabel Ω',
          photos: [{ dataUri: DATA_URI, caption: 'Caption by Ω-man' }],
          omittedCount: 0,
        },
      ],
    },
  ],
  annexures: [{ name: 'Annex Ω.pdf', source: 'attachment', href: null, meta: 'PDF ≤ 1 MB' }],
  signatures: [
    { role: 'Inspector', name: 'Signer Ω', title: 'Title ≤ Master', registrationNumber: 'Reg Ω-1', signedAt: null, imageDataUri: null },
  ],
  audit: [{ at: '2026-05-01T08:15:00.000Z', sectionId: 's1', fieldId: 'r1', fieldLabel: 'AuditField Ω', by: 'AuditBy ✓' }],
  brandingInput: {
    orgName: 'WM',
    orgLogoDataUri: null,
    orgAccent: null,
    projectAccent: null,
    clientLogoDataUri: null,
    projectMarkDataUri: null,
    projectSubtitle: 'x',
  },
}

const branding = resolveBranding({
  org: { name: 'Org Ω Wordmark', logoSrc: undefined, accent: '#E69500' },
  project: { name: 'Projekt Ω-Park', clientLogoSrc: undefined, projectMarkSrc: undefined, accent: null, subtitle: 'DB ≤ 1' },
  contractor: null,
  title: 'Inspection & Test Report',
  kicker: 'ELECTRICAL INSPECTION',
  date: '2026-06-03',
})

describe('inspection report — WinAnsi glyphs', () => {
  it('prints Ω as Ohm, ≤ as <=, ✓ as Yes — never ©, d or an invisible control', async () => {
    const text = extractPdfText(await renderInspectionReport(hostileData, branding))

    // The corrupted forms must not appear.
    expect(text).not.toContain('©')
    expect(text).not.toContain('12© exceeds')
    // ✓ U+2713 truncates to 0x13: an invisible control character.
    const controls = [...text].filter((ch) => ch.charCodeAt(0) < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t')
    expect(controls).toEqual([])

    // Every slot, sanitised.
    for (const wanted of [
      'Resistance 12Ohm exceeds 1Ohm limit', // fail reason
      'FailLabel Ohm',
      'Ref <= 6.4',
      'ObsLabel Yes',
      'ObsReason <= 0,2 Ohm', // observation
      'MissLabel Ohm',
      'MissReason Yes locked', // missing-photo reason
      'Section Ohm title',
      'Proving dead <= 50 V', // field label
      'Measured 0,1 Ohm', // answer
      'RowFail <= 0,2 Ohm',
      'Para line one Ohm',
      'Para line two Yes',
      'Snag one <= spec',
      'Snag two Ohm',
      'Group Ohm label',
      'GroupRow Ohm',
      'GroupVal <= 5',
      'PhotoLabel Ohm',
      'Caption by Ohm-man', // photo caption
      'Annex Ohm.pdf',
      'PDF <= 1 MB',
      'Signer Ohm', // signatory name
      'Title <= Master', // signatory title
      'Reg Ohm-1',
      'AuditField Ohm',
      'AuditBy Yes',
      'Projekt Ohm-Park',
      'DB-1 -> MB-2',
      'LV <= 1000 V',
      'Inspector Ohm',
      'Verifier Yes',
      'SANS 10142-1 >= 2020',
      'Org Ohm Wordmark', // cover wordmark
      'DB <= 1', // cover project line
    ]) {
      expect(text, `missing: ${wanted}`).toContain(wanted)
    }
  })

  it('sanitises every string but keeps newlines, nulls, data URIs and hrefs', () => {
    const withHref: InspectionReportData = {
      ...hostileData,
      annexures: [{ ...hostileData.annexures[0]!, href: 'https://x.test/a?b=Ω', thumbnailDataUri: DATA_URI }],
    }
    const out = sanitiseInspectionReportData(withHref)

    const para = out.sections[0]!.rows.find((r) => r.fieldId === 'r3')!
    expect(para.value).toBe('Para line one Ohm\nPara line two Yes')
    expect(out.summary.certifiedAt).toBeNull()
    expect(out.sections[0]!.photoFields[0]!.photos[0]!.dataUri).toBe(DATA_URI)
    expect(out.annexures[0]!.href).toBe('https://x.test/a?b=Ω')
    expect(out.annexures[0]!.thumbnailDataUri).toBe(DATA_URI)
    expect(out.signatures[0]!.imageDataUri).toBeNull()

    // Walk everything that is drawn: no non-WinAnsi string may survive.
    const drawn: string[] = []
    const skip = new Set(['href', 'dataUri', 'imageDataUri', 'thumbnailDataUri', 'orgLogoDataUri', 'clientLogoDataUri', 'projectMarkDataUri'])
    const walk = (v: unknown, key = ''): void => {
      if (skip.has(key)) return
      if (typeof v === 'string') drawn.push(v)
      else if (Array.isArray(v)) v.forEach((x) => walk(x))
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k)
    }
    walk(out)
    for (const s of drawn) expect(isWinAnsiSafe(s.replace(/\n/g, ' ')), s).toBe(true)

    const b = sanitiseBranding(branding)
    for (const s of [b.title, b.kicker, b.projectLine, b.footerStamp, b.issuer.wordmark ?? '']) {
      expect(isWinAnsiSafe(s), s).toBe(true)
    }
  })
})
