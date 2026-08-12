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
  photos?: any[]
  downloads?: Record<string, { data: any; error: any }>
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
    'field.form_response_history': { data: [], error: null },
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
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })

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
