// @vitest-environment node
// Node is REQUIRED: @react-pdf/renderer's browser build stubs out renderToBuffer,
// and the `browser` package.json field redirects jsdom straight to that stub.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import zlib from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { NOT_A_COC_DISCLAIMER } from '@esite/shared'
import { renderSiteFormReport } from './render-site-form'
import {
  siteFormReportFixture,
  prefilledSiteFormReportFixture,
  emptySiteFormReportFixture,
  HOSTILE_MULTILINE,
  HOSTILE_GLYPHS,
} from './__fixtures__/site-form'
import type { SiteFormReportData } from './site-form-report-data'

// ─── Module mocks (gatherer tests) ─────────────────────────────────────────
// vi.hoisted so these fns exist before the hoisted vi.mock factories run.
// The render tests above are unaffected: they never touch Supabase.
const { createServiceClientMock, requireEffectiveRoleMock } = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: requireEffectiveRoleMock,
}))

import { gatherSiteFormReportData } from './site-form-report-data'

/**
 * WinAnsiEncoding 0x80-0x9F as Unicode code points, indexed by (byte - 0x80);
 * 0 marks the five codes WinAnsi leaves undefined.
 *
 * A PDF standard font (Helvetica here) writes text in WinAnsi, which agrees
 * with latin1 everywhere EXCEPT this 32-byte window — where latin1 has control
 * characters and WinAnsi has the punctuation the document actually uses. The
 * provenance marker (U+2020 DAGGER) is WinAnsi byte 0x86, so without this it
 * decodes to an invisible control character and every assertion about it passes
 * vacuously — the same silent-pass trap a raw buffer grep falls into. Code
 * points rather than literals so the table stays readable and diffable.
 */
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
      text += fromWinAnsi(Buffer.from(match[1], 'hex').toString('latin1'))
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

// ---------------------------------------------------------------------------
// Glyph fidelity — what the page ACTUALLY says
//
// react-pdf's standard Helvetica encodes only WinAnsi and, unlike pdf-lib, does
// NOT throw on anything else: it truncates the code point to its low byte and
// draws whatever character that lands on. Measured 2026-08-13 by rendering a
// probe page and inflating its content stream:
//
//   INPUT : A[MΩ]B[≤]C[mm²]D[65 °C]E[†]F[·]G[∆]H[µ]I[μ]
//   OUTPUT: A[M©]B[d]C[mm²]D[65 °C]E[†]F[·]G[ ]H[µ]I[¼]
//
// The seeded template carries six `Ω` units, a `≤` in the proving-dead label
// and an `I∆n` label, so a SANS 10142-1 record printed `≤ 0,2 Ω` as `d 0,2 ©`
// in production. Nothing threw and nothing logged — the only test that can
// catch this class is one that reads the glyphs back off the rendered page,
// which is what every assertion below does.
// ---------------------------------------------------------------------------

/**
 * Code points, never literals: an input an editor or a git filter could launder
 * is an input that proves nothing.
 */
const OHM = String.fromCharCode(0x03a9) // Ω
const LE = String.fromCharCode(0x2264) // ≤
const COPY = String.fromCharCode(0x00a9) // © — what Ω used to become
const SUP2 = String.fromCharCode(0x00b2) // ²  ┐
const DEG = String.fromCharCode(0x00b0) // °   ├ all genuine WinAnsi:
const DAGGER = String.fromCharCode(0x2020) // † │ these must survive verbatim
const MIDDOT = String.fromCharCode(0x00b7) // · ┘
const MICRO = String.fromCharCode(0x00b5) // µ MICRO SIGN (WinAnsi)
const MU_GREEK = String.fromCharCode(0x03bc) // μ GREEK SMALL MU (not WinAnsi)

/** One section of rows on an otherwise empty draft — nothing else to confuse the assertions. */
const glyphDoc = (rows: SiteFormReportData['sections'][number]['rows']): SiteFormReportData => ({
  ...emptySiteFormReportFixture,
  sections: [{ sectionId: 'glyphs', title: 'Test values', rows, groups: [] }],
})

const renderText = async (data: SiteFormReportData): Promise<string> =>
  squash(extractPdfText(await renderSiteFormReport(data)))

describe('renderSiteFormReport — WinAnsi glyph fidelity', () => {
  it('prints an MΩ unit as "Mohm", never as the copyright sign', async () => {
    // electrical_tests.insulation_resistance carries unit `MΩ`; the gatherer
    // appends it to the value, so this is the literal production string.
    const text = await renderText(
      glyphDoc([
        {
          fieldId: 'insulation_resistance',
          label: 'Insulation resistance',
          kind: 'value',
          value: `500 M${OHM}`,
        },
      ]),
    )
    expect(text).toContain('500 MOhm')
    expect(text).not.toContain(COPY)
    expect(text).not.toContain(OHM)
  })

  it('prints "<=" for a less-than-or-equal, never the letter d', async () => {
    // proving_dead.all_readings_dead — the label that decides whether a board
    // was proved dead. "d 0 V" is not a statement anybody can rely on.
    const text = await renderText(
      glyphDoc([
        {
          fieldId: 'all_readings_dead',
          label: `All readings ${LE} 0 V (dead confirmed)`,
          kind: 'value',
          value: 'Yes',
        },
      ]),
    )
    expect(text).toContain('All readings <= 0 V (dead confirmed)')
    expect(text).not.toContain('All readings d 0 V')
  })

  it('converts an ohm sign inside free text, not only in a unit', async () => {
    // Units are composed by the gatherer, but an electrician types Ω into notes
    // and defect descriptions too — sanitising only the unit would miss those.
    const text = await renderText(
      glyphDoc([
        {
          fieldId: 'circuit_notes',
          label: 'Notes',
          kind: 'paragraph',
          value: `Measured 0,35 ${OHM} at the DB, ${LE} the 0,4 ${OHM} limit`,
        },
      ]),
    )
    expect(text).toContain('Measured 0,35 Ohm at the DB, <= the 0,4 Ohm limit')
    expect(text).not.toContain(COPY)
  })

  it('leaves genuine WinAnsi characters alone — over-sanitising is its own bug', async () => {
    // `2,5 mm2`, `65 degC` or `50 uF` on a compliance record would be a
    // regression of the same severity, in the opposite direction.
    const value = `2,5 mm${SUP2} at 65 ${DEG}C ${DAGGER} ${MIDDOT} 50 ${MICRO}F`
    const text = await renderText(
      glyphDoc([{ fieldId: 'conductor', label: 'Conductor', kind: 'value', value }]),
    )
    expect(text).toContain(value)
  })

  it('rescues Greek mu to the micro sign rather than dropping the unit', async () => {
    // μ (U+03BC) drew as ¼. It is not WinAnsi; µ (U+00B5) is, and means the same.
    const text = await renderText(
      glyphDoc([
        { fieldId: 'leakage', label: 'Leakage', kind: 'value', value: `50 ${MU_GREEK}F` },
      ]),
    )
    expect(text).toContain(`50 ${MICRO}F`)
    expect(text).not.toContain('¼')
  })

  it('sanitises a group table cell and its column heading', async () => {
    // The circuits table is the densest part of the record and takes its
    // headings straight from the template.
    const data: SiteFormReportData = {
      ...emptySiteFormReportFixture,
      sections: [
        {
          sectionId: 'glyphs',
          title: 'Test values',
          rows: [],
          groups: [
            {
              fieldId: 'tests',
              label: `Loop impedance (${OHM})`,
              columns: [{ fieldId: 'zs', label: `Zs (${OHM})` }],
              rows: [{ entryNo: 1, cells: [`0,35 ${OHM}`] }],
            },
          ],
        },
      ],
    }
    const text = await renderText(data)
    expect(text).toContain('Loop impedance (Ohm)')
    expect(text).toContain('Zs (Ohm)')
    expect(text).toContain('0,35 Ohm')
    expect(text).not.toContain(COPY)
  })

  it('sanitises the cover, which is drawn by the shared Cover component', async () => {
    // site-form-report.tsx does not own <Cover>, so the branding is sanitised on
    // the way in. The cover is the first page anybody looks at.
    const data: SiteFormReportData = {
      ...emptySiteFormReportFixture,
      branding: {
        ...emptySiteFormReportFixture.branding,
        projectLine: `Kingswalk ${OHM} Mall`,
        issuer: { wordmark: `Watson ${OHM} Mattheus` },
      },
    }
    const text = await renderText(data)
    expect(text).toContain('Kingswalk Ohm Mall')
    expect(text).toContain('Watson Ohm Mattheus')
    expect(text).not.toContain(COPY)
  })

  it('leaves no unencodable character anywhere in a hostile payload', async () => {
    // The document-wide statement the per-case tests cannot make: after the
    // full hostile fixture renders, nothing on the page is a substituted glyph.
    const text = extractPdfText(await renderSiteFormReport(siteFormReportFixture))
    expect(text).not.toContain(OHM)
    expect(text).not.toContain(COPY)
    expect(text).not.toContain(String.fromCharCode(0x2192)) // →
    expect(text).not.toContain('¼') // what Greek μ drew as
  })
})

// ---------------------------------------------------------------------------
// Multi-line answers
//
// The pdf-lib sanitiser folds \n to a space because widthOfTextAtSize THROWS on
// a newline. Reusing that here would have fixed the glyphs and quietly
// introduced a second bug of the identical shape — all 18 textarea fields on
// this template (scope_description, extent_and_limitations, parts_not_covered,
// circuit_notes, the defect descriptions …) flattened into one run-on
// paragraph, still rendering, still not throwing.
// ---------------------------------------------------------------------------

describe('renderSiteFormReport — multi-line answers', () => {
  it('preserves a line break in a textarea answer', async () => {
    const text = await renderText(
      glyphDoc([
        {
          fieldId: 'scope_description',
          label: 'Scope of work',
          kind: 'paragraph',
          value: 'ZALPHA\nZBETA',
        },
      ]),
    )

    // How this discriminates, given the extractor: PDFKit emits ONE text-showing
    // run per LAID-OUT LINE, and extractPdfTextPerStream concatenates the runs
    // within a page's content stream with nothing between them. Two lines
    // therefore read back butted together, while a collapsed single line still
    // carries the space that replaced the newline. That space is the only thing
    // in the byte stream that tells the two apart.
    expect(text).toContain('ZALPHAZBETA')
    expect(text).not.toContain('ZALPHA ZBETA')
  })

  it('still sanitises glyphs on every line of a multi-line answer', async () => {
    const text = await renderText(
      glyphDoc([
        {
          fieldId: 'recommendations',
          label: 'Recommendations',
          kind: 'paragraph',
          value: `ZALPHA 0,35 ${OHM}\nZBETA ${LE} 1 s`,
        },
      ]),
    )
    expect(text).toContain('ZALPHA 0,35 Ohm')
    expect(text).toContain('ZBETA <= 1 s')
    expect(text).not.toContain(COPY)
  })
})

// ---------------------------------------------------------------------------
// Inherited vs verified-on-site — field.form_responses.prefilled_from (00182)
//
// A value copied off a drawing and a value verified at the board must not look
// identical on a document read in an incident enquiry. SANS 10142-1 6.6.1.21(a)
// says in terms to VERIFY the fed-from label rather than copy it.
// ---------------------------------------------------------------------------

/** U+2020 DAGGER — written as a code point so no editor can mangle it. */
const PREFILL_MARKER = String.fromCharCode(0x2020)

/** The ASCII spine of the footnote; asserting on prose, not on punctuation. */
const FOOTNOTE_SPINE =
  'were pre-populated from the project record and were not edited on site'

const countMarkers = (text: string): number =>
  [...text].filter((c) => c === PREFILL_MARKER).length

describe('renderSiteFormReport — inherited values', () => {
  it('marks inherited values and explains the marker', async () => {
    const text = squash(extractPdfText(await renderSiteFormReport(prefilledSiteFormReportFixture)))

    // The legend…
    expect(text).toContain(FOOTNOTE_SPINE)
    // …and markers beyond the two the legend itself contains.
    expect(countMarkers(text)).toBeGreaterThan(2)
    // The marker sits ON the inherited value, not adrift in the page.
    expect(text).toContain(`DB-1 ${PREFILL_MARKER}`)
    // The audit trail says it in words too — that is the part an enquiry reads.
    expect(text).toContain('pre-populated')
    expect(text).toContain('board record')
  })

  it('renders NEITHER the marker NOR the footnote when nothing was inherited', async () => {
    // Same document, same hostile strings — only the provenance differs. A
    // legend for something that occurs zero times is noise in a legal record.
    const text = squash(extractPdfText(await renderSiteFormReport(siteFormReportFixture)))
    expect(countMarkers(text)).toBe(0)
    expect(text).not.toContain(FOOTNOTE_SPINE)
    expect(text).not.toContain('pre-populated')
  })

  it('distinguishes a circuit row imported from the cable schedule from a typed one', async () => {
    const circuits = prefilledSiteFormReportFixture.sections
      .find((sec) => sec.sectionId === 'circuits_affected')
      ?.groups.find((g) => g.fieldId === 'circuits')
    expect(circuits).toBeDefined()

    // Entry 1 came off the cable schedule; entry 2 was typed at the board.
    const imported = circuits!.rows.find((r) => r.entryNo === 1)!
    const typed = circuits!.rows.find((r) => r.entryNo === 2)!
    const inheritedCells = (imported.prefilled ?? []).filter(Boolean).length
    expect(inheritedCells).toBeGreaterThan(0)
    expect((typed.prefilled ?? []).some(Boolean)).toBe(false)

    // …and that difference survives into the rendered page. Isolating the
    // circuits table is what makes this a statement about the ROW rather than
    // about the document: nothing else in this payload is inherited.
    const onlyCircuits: SiteFormReportData = {
      ...siteFormReportFixture,
      sections: prefilledSiteFormReportFixture.sections.map((sec) => ({
        ...sec,
        rows: sec.rows.map((r) => ({ ...r, prefilledFrom: null })),
      })),
      audit: siteFormReportFixture.audit,
    }
    const marked = countMarkers(squash(extractPdfText(await renderSiteFormReport(onlyCircuits))))
    const unmarked = countMarkers(
      squash(extractPdfText(await renderSiteFormReport(siteFormReportFixture))),
    )
    expect(unmarked).toBe(0)
    // One per inherited cell, plus the two in the footnote's own wording.
    expect(marked).toBe(inheritedCells + 2)
  })
})

// ---------------------------------------------------------------------------
// gatherSiteFormReportData — the data layer the document renders from
// ---------------------------------------------------------------------------

/** Chainable + awaitable supabase query-builder stub. */
function qb(result: any): any {
  const p: any = Promise.resolve(result)
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) p[m] = () => qb(result)
  p.single = () => Promise.resolve(result)
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

const FORM_ID = 'form-1'
const PROJECT_ID = 'proj-1'

/**
 * Template covering the four defect classes under test: the §12 dropdown whose
 * wording is legally load-bearing, the two computed fields, a repeating group
 * whose entries can be deleted, and a photo field.
 */
const TEMPLATE_SECTIONS = [
  {
    section_id: 'db_identification',
    title: '2. Distribution board identification',
    fields: [
      { field_id: 'db_reference', label: 'DB reference / code', type: 'text' },
      { field_id: 'photo_db_nameplate', label: 'Photo - DB nameplate (as found)', type: 'photo' },
    ],
  },
  {
    section_id: 'proving_dead',
    title: '8A. Proving dead - voltage readings',
    fields: [
      { field_id: 'reading_l_n', label: 'L-N', type: 'number', unit: 'V' },
      { field_id: 'reading_l_e', label: 'L-E', type: 'number', unit: 'V' },
      {
        field_id: 'all_readings_dead',
        label: 'All readings at or below 0 V (dead confirmed)',
        type: 'computed',
        formula: 'all(reading_l_n, reading_l_e, reading_n_e) <= 0',
      },
    ],
  },
  {
    section_id: 'circuits_affected',
    title: '5. Circuits affected',
    fields: [
      {
        field_id: 'circuits',
        label: 'Circuits acted upon',
        type: 'repeating_group',
        fields: [
          { field_id: 'way_no', label: 'Way / position no.', type: 'text' },
          { field_id: 'action_taken', label: 'Action taken', type: 'dropdown' },
        ],
      },
      {
        field_id: 'circuits_left_temporary',
        label: 'Circuits left in a temporary state',
        type: 'computed',
        formula:
          'count(circuits where action_taken in [left_isolated_locked_off, made_safe_pending_removal_by_others, disconnected_at_db_only_far_end_open])',
      },
    ],
  },
  {
    section_id: 'handover_status',
    title: '12. Handover status',
    fields: [
      { field_id: 'as_left_status', label: 'As-left status of this board', type: 'dropdown' },
      {
        field_id: 'circuits_left_temporary_count',
        label: 'Number of circuits left in a temporary state',
        type: 'computed',
        formula: 'circuits_left_temporary',
      },
    ],
  },
]

/** Three circuit entries (indices 0-2); two of them in a temporary state. */
const THREE_CIRCUITS = [
  { section_id: 'circuits_affected', field_id: 'circuits[0].way_no', value_text: '4' },
  {
    section_id: 'circuits_affected',
    field_id: 'circuits[0].action_taken',
    value_text: 'left_isolated_locked_off',
  },
  { section_id: 'circuits_affected', field_id: 'circuits[1].way_no', value_text: '9' },
  {
    section_id: 'circuits_affected',
    field_id: 'circuits[1].action_taken',
    value_text: 'terminated_and_removed',
  },
  { section_id: 'circuits_affected', field_id: 'circuits[2].way_no', value_text: '12' },
  {
    section_id: 'circuits_affected',
    field_id: 'circuits[2].action_taken',
    value_text: 'disconnected_at_db_only_far_end_open',
  },
]

interface GatherOpts {
  formOver?: Record<string, any>
  responses?: any[]
  history?: any[]
  photos?: any[]
  downloads?: Record<string, { data: any; error: any }>
  /** Effective project role the gate resolves to. */
  role?: string
}

async function gather(opts: GatherOpts = {}): Promise<SiteFormReportData> {
  const tables: Record<string, any> = {
    'field.site_forms': {
      data: {
        id: FORM_ID,
        project_id: PROJECT_ID,
        organisation_id: 'org-1',
        template_row_id: 'tmpl-1',
        form_no: 'TMS-KING-2026-0007',
        board_ref: 'DB-1',
        board_label: 'DB-1',
        status: 'submitted',
        as_left_status: null,
        created_by: 'user-1',
        submitted_by: 'user-1',
        submitted_at: '2026-08-11T16:10:00.000Z',
        distributed_by: null,
        distributed_at: null,
        ...opts.formOver,
      },
      error: null,
    },
    'projects.projects': {
      data: {
        id: PROJECT_ID,
        name: 'Kingswalk Mall',
        code: 'KING',
        organisation_id: 'org-1',
        client_logo_url: null,
        project_logo_url: null,
        report_accent_color: null,
      },
      error: null,
    },
    'field.form_templates': {
      data: {
        name: 'Termination and Making Safe',
        version: '1.0',
        schema_json: { sections: TEMPLATE_SECTIONS },
      },
      error: null,
    },
    'field.form_responses': { data: opts.responses ?? THREE_CIRCUITS, error: null },
    'field.form_response_history': { data: opts.history ?? [], error: null },
    'field.form_photos': { data: opts.photos ?? [], error: null },
    'field.form_signatures': { data: [], error: null },
    'public.organisations': {
      data: { id: 'org-1', name: 'Watson Mattheus Consulting', logo_url: null, report_accent_color: null },
      error: null,
    },
    'public.profiles': {
      data: [{ id: 'user-1', full_name: 'Thandi Mokoena', email: 't@x.com' }],
      error: null,
    },
  }

  const service: any = {
    from: (table: string) => qb(tables[`public.${table}`] ?? { data: null, error: null }),
    schema: (schema: string) => ({
      from: (table: string) => qb(tables[`${schema}.${table}`] ?? { data: null, error: null }),
    }),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const hit = opts.downloads?.[`${bucket}:${path}`]
          if (hit) return hit
          return {
            data: { type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
            error: null,
          }
        },
      }),
    },
  }

  createServiceClientMock.mockReturnValue(service)
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: opts.role ?? 'owner' })

  const cookieClient: any = {
    auth: { getUser: async () => ({ data: { user: { id: 'viewer-1' } } }) },
  }
  return gatherSiteFormReportData(cookieClient, PROJECT_ID, FORM_ID)
}

const rowOf = (data: SiteFormReportData, sectionId: string, fieldId: string) =>
  data.sections.find((s) => s.sectionId === sectionId)?.rows.find((r) => r.fieldId === fieldId)

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── SECURITY: client viewers may only read a DISTRIBUTED record ───────────
// This route lives under app/api/…, NOT under (admin)/layout.tsx, so the
// "client viewers are bounced to /portal" protection does not apply; and every
// read after the gate is on the service client, which bypasses the
// field.site_forms RLS that restricts client viewers to status='distributed'.
// Without this check the endpoint is a live read-oracle: the distribution email
// hands every client viewer the projectId + formId, so a later VOID (the
// documented withdrawal path) or any leaked draft id would still render the
// complete PDF — audit trail, photos and signatures included.

describe('gatherSiteFormReportData — client-viewer status gate', () => {
  it('serves a distributed record to a client viewer', async () => {
    const data = await gather({ role: 'client_viewer', formOver: { status: 'distributed' } })
    expect(data.summary.status).toBe('distributed')
  })

  it('refuses a draft to a client viewer, indistinguishably from not-found', async () => {
    await expect(
      gather({ role: 'client_viewer', formOver: { status: 'draft' } }),
    ).rejects.toThrow('Form not found')
  })

  it('refuses a voided record to a client viewer', async () => {
    // The withdrawal path: RLS hides it everywhere else, this route must too.
    await expect(
      gather({ role: 'client_viewer', formOver: { status: 'void' } }),
    ).rejects.toThrow('Form not found')
  })

  it('still lets a non-client role preview their own draft', async () => {
    // An electrician previewing a draft before submitting is the normal path.
    const data = await gather({ role: 'contractor', formOver: { status: 'draft' } })
    expect(data.summary.status).toBe('draft')
  })
})

// ─── FINDING 1 ─────────────────────────────────────────────────────────────

describe('gatherSiteFormReportData — handover status comes from the response', () => {
  it('renders the RESPONSE, not the denormalised column, when the two disagree', async () => {
    // field.site_forms.as_left_status is a denormalised copy written at submit.
    // The response row is the source of truth (design spec §field.site_forms).
    const data = await gather({
      formOver: { as_left_status: 'made_safe_de_energised' },
      responses: [
        ...THREE_CIRCUITS,
        {
          section_id: 'handover_status',
          field_id: 'as_left_status',
          value_text: 'energised_returned_to_service',
        },
      ],
    })

    expect(data.summary.asLeftStatus).toBe('energised_returned_to_service')
    expect(data.summary.asLeftStatusText).toBe('Energised — returned to service')
    expect(rowOf(data, 'handover_status', 'as_left_status')?.value).toBe(
      'Energised — returned to service',
    )

    // …and the two statements in the rendered document must agree.
    const text = squash(extractPdfText(await renderSiteFormReport(data)))
    expect(text).toContain('Energised')
    expect(text).not.toContain('Made safe')
  })

  it('falls back to the column only when no response row exists', async () => {
    const data = await gather({ formOver: { as_left_status: 'made_safe_de_energised' } })
    expect(data.summary.asLeftStatusText).toBe('Made safe — de-energised')
    expect(rowOf(data, 'handover_status', 'as_left_status')?.value).toBe('Made safe — de-energised')
  })

  it('states "Not recorded" — never a default status — when neither exists', async () => {
    const data = await gather()
    expect(data.summary.asLeftStatus).toBeNull()
    expect(data.summary.asLeftStatusText).toBe('Not recorded')
    expect(rowOf(data, 'handover_status', 'as_left_status')?.value).toBe('Not recorded')
  })
})

// ─── FINDING 2 ─────────────────────────────────────────────────────────────

describe('gatherSiteFormReportData — photos that could not be retrieved', () => {
  const twoPhotos = [
    {
      id: 'ph-1',
      section_id: 'db_identification',
      field_id: 'photo_db_nameplate',
      storage_path: 'p/one.jpg',
      caption: 'Nameplate',
      sort_order: 0,
      uploaded_by: 'user-1',
    },
    {
      id: 'ph-2',
      section_id: 'db_identification',
      field_id: 'photo_db_nameplate',
      storage_path: 'p/two.jpg',
      caption: 'Nameplate close-up',
      sort_order: 1,
      uploaded_by: 'user-1',
    },
  ]
  const bothFail = {
    'site-form-photos:p/one.jpg': { data: null, error: { message: 'object not found' } },
    'site-form-photos:p/two.jpg': { data: null, error: { message: 'object not found' } },
  }

  it('counts failed downloads instead of discarding them silently', async () => {
    const data = await gather({ photos: twoPhotos, downloads: bothFail })
    const field = data.photoFields.find((f) => f.fieldId === 'photo_db_nameplate')
    expect(field).toBeDefined()
    expect(field!.photos).toHaveLength(0)
    expect(field!.unavailableCount).toBe(2)
    expect(field!.omittedCount).toBe(0) // overflow is a different thing entirely
  })

  it('never claims "No photographs captured" when photos exist but failed to download', async () => {
    const data = await gather({ photos: twoPhotos, downloads: bothFail })
    const text = squash(extractPdfText(await renderSiteFormReport(data)))
    expect(text).not.toContain('No photographs captured')
    expect(text).toContain('2 images unavailable')
    expect(text).toContain('2 photographs')
  })

  it('still says "No photographs captured" when there genuinely are none', async () => {
    const data = await gather()
    const text = squash(extractPdfText(await renderSiteFormReport(data)))
    expect(text).toContain('No photographs captured')
  })
})

// ─── FINDING 3 ─────────────────────────────────────────────────────────────

describe('gatherSiteFormReportData — computed fields', () => {
  it('evaluates the temporary-circuit count so the row and the summary agree', async () => {
    const data = await gather() // 3 circuits, 2 of them temporary
    const row = rowOf(data, 'handover_status', 'circuits_left_temporary_count')
    expect(row?.value).toBe('2')
    expect(data.summary.circuitsLeftTemporary).toBe(2)
    // The whole point: one document, one number.
    expect(row?.value).toBe(String(data.summary.circuitsLeftTemporary))
    expect(rowOf(data, 'circuits_affected', 'circuits_left_temporary')?.value).toBe('2')
  })

  it('evaluates the proving-dead gate over the readings actually captured', async () => {
    const dead = await gather({
      responses: [
        { section_id: 'proving_dead', field_id: 'reading_l_n', value_number: 0 },
        { section_id: 'proving_dead', field_id: 'reading_l_e', value_number: 0 },
      ],
    })
    expect(rowOf(dead, 'proving_dead', 'all_readings_dead')?.value).toBe('Yes')

    const live = await gather({
      responses: [
        { section_id: 'proving_dead', field_id: 'reading_l_n', value_number: 231.4 },
        { section_id: 'proving_dead', field_id: 'reading_l_e', value_number: 0 },
      ],
    })
    expect(rowOf(live, 'proving_dead', 'all_readings_dead')?.value).toBe('No')
  })

  it('never prints a bare dash for a computed field', async () => {
    const data = await gather()
    for (const section of data.sections) {
      for (const row of section.rows) {
        if (row.fieldId.startsWith('circuits_left_temporary') || row.fieldId === 'all_readings_dead') {
          expect(row.value).not.toBe('')
        }
      }
    }
  })
})

// ─── PROVENANCE ────────────────────────────────────────────────────────────

describe('gatherSiteFormReportData — prefilled_from provenance', () => {
  it('carries provenance onto field rows, group cells and the audit trail', async () => {
    const data = await gather({
      responses: [
        {
          section_id: 'db_identification',
          field_id: 'db_reference',
          value_text: 'DB-1',
          prefilled_from: 'structure_node',
        },
        // Way number came off the cable schedule; the action was answered at
        // the board (the upsert clears prefilled_from on every user edit).
        {
          section_id: 'circuits_affected',
          field_id: 'circuits[0].way_no',
          value_text: '4',
          prefilled_from: 'cable_schedule',
        },
        {
          section_id: 'circuits_affected',
          field_id: 'circuits[0].action_taken',
          value_text: 'terminated_and_removed',
          prefilled_from: null,
        },
      ],
      history: [
        {
          section_id: 'db_identification',
          field_id: 'db_reference',
          value_text: 'DB-1',
          responded_at: '2026-08-11T09:02:11.000Z',
          responded_by: 'user-1',
          prefilled_from: 'structure_node',
        },
        {
          section_id: 'db_identification',
          field_id: 'db_reference',
          value_text: 'DB-1A',
          responded_at: '2026-08-11T09:40:00.000Z',
          responded_by: 'user-1',
          prefilled_from: null,
        },
      ],
    })

    expect(rowOf(data, 'db_identification', 'db_reference')?.prefilledFrom).toBe('structure_node')

    const group = data.sections
      .find((s) => s.sectionId === 'circuits_affected')
      ?.groups.find((g) => g.fieldId === 'circuits')
    const wayCol = group!.columns.findIndex((c) => c.fieldId === 'way_no')
    const actionCol = group!.columns.findIndex((c) => c.fieldId === 'action_taken')
    expect(group!.rows[0].prefilled?.[wayCol]).toBe(true)
    expect(group!.rows[0].prefilled?.[actionCol]).toBe(false)

    // The history keeps BOTH statements apart: inherited, then stated.
    expect(data.audit.map((a) => a.prefilledFrom ?? null)).toEqual(['structure_node', null])
  })

  it('never attributes a value it did not print', async () => {
    // A source recorded against an answer that renders nothing would hang the
    // marker on an em dash, and a derived figure is nobody's inherited value.
    const data = await gather({
      responses: [
        {
          section_id: 'db_identification',
          field_id: 'db_reference',
          value_text: '',
          prefilled_from: 'structure_node',
        },
        ...THREE_CIRCUITS.map((r) => ({ ...r, prefilled_from: 'cable_schedule' })),
      ],
    })
    expect(rowOf(data, 'db_identification', 'db_reference')?.prefilledFrom).toBeNull()
    // circuits_left_temporary_count is computed from the entries, not inherited.
    const computed = rowOf(data, 'handover_status', 'circuits_left_temporary_count')
    expect(computed?.value).toBe('2')
    expect(computed?.prefilledFrom).toBeNull()
  })
})

// ─── FINDING 4 ─────────────────────────────────────────────────────────────

describe('gatherSiteFormReportData — repeating-group row numbering', () => {
  it('numbers rendered rows from 1 regardless of the synthetic index', async () => {
    // Entry 0 was deleted on site; the surviving entries are at indices 1 and 2.
    const data = await gather({
      responses: THREE_CIRCUITS.filter((r) => !r.field_id.startsWith('circuits[0]')),
    })
    const group = data.sections
      .find((s) => s.sectionId === 'circuits_affected')
      ?.groups.find((g) => g.fieldId === 'circuits')
    expect(group).toBeDefined()
    expect(group!.rows.map((r) => r.entryNo)).toEqual([1, 2])
    // The row content must still follow the surviving entries, in order.
    const wayCol = group!.columns.findIndex((c) => c.fieldId === 'way_no')
    expect(group!.rows.map((r) => r.cells[wayCol])).toEqual(['9', '12'])
  })
})
