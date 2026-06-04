import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ──────────────────────────────────────────────────────────
// vi.hoisted so these fns are initialised before the hoisted vi.mock factories
// reference them.  Mirrors apps/web/src/actions/inspections.actions.test.ts.
const { createClientMock, createServiceClientMock, requireEffectiveRoleMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    createServiceClientMock: vi.fn(),
    requireEffectiveRoleMock: vi.fn(),
  }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: requireEffectiveRoleMock,
}))

import { gatherInspectionReportData } from './inspection-report-data'

// ─── Chainable + awaitable query-builder stub ───────────────────────────────
// `await qb(r)` === r and the supabase chain methods all return another qb(r);
// terminal single/maybeSingle resolve to r directly.
function qb(result: any): any {
  const p: any = Promise.resolve(result)
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) {
    p[m] = () => qb(result)
  }
  p.single = () => Promise.resolve(result)
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

// ─── Routing supabase stub ──────────────────────────────────────────────────
// `tables` is keyed by "<schema>.<table>" (public schema = "public.<table>").
// `storage` records the bucket name each download/createSignedUrl is called
// against, and returns per-path results.
function makeClient(opts: {
  tables: Record<string, any>
  user?: { id: string } | null
  downloads?: Record<string, { data: any; error: any } | undefined>
  storageBuckets?: string[] // captures bucket names passed to storage.from()
}): any {
  const { tables, user = { id: 'viewer-1' }, downloads = {} } = opts
  const storageBuckets = opts.storageBuckets ?? []

  function resolveTable(schema: string, table: string): any {
    const key = `${schema}.${table}`
    return qb(tables[key] ?? { data: null, error: null })
  }

  const client: any = {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    // public-schema reads (profiles, organisations) come through `.from()`
    from: (table: string) => resolveTable('public', table),
    schema: (schema: string) => ({
      from: (table: string) => resolveTable(schema, table),
    }),
    rpc: async () => ({ data: 'owner', error: null }),
    storage: {
      from: (bucket: string) => {
        storageBuckets.push(bucket)
        return {
          download: async (path: string) => {
            const hit = downloads[`${bucket}:${path}`] ?? downloads[path]
            if (hit) return hit
            // default: a tiny PNG blob with arrayBuffer()
            return {
              data: {
                type: 'image/png',
                arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
              },
              error: null,
            }
          },
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://signed.example/${bucket}/${path}` },
            error: null,
          }),
        }
      },
    },
  }
  return client
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const INSPECTION_ID = 'insp-1'
const PROJECT_ID = 'proj-1'

function baseInspectionRow(over: Record<string, any> = {}) {
  return {
    data: {
      id: INSPECTION_ID,
      project_id: PROJECT_ID,
      organisation_id: 'org-1',
      template_id: 'tmpl-1',
      target_label: 'MAIN DB',
      status: 'in_progress',
      overall_result: 'pass',
      coc_number: null,
      started_at: '2026-01-01T08:00:00Z',
      certified_at: null,
      assigned_to_id: 'user-insp',
      verifier_id: 'user-verif',
      ...over,
    },
    error: null,
  }
}

const TEMPLATE_ROW = {
  data: {
    name: 'Electrical Inspection',
    version: '1.0',
    deliverable_type: 'inspection_only',
    sans_reference: 'SANS 10142-1',
    schema_json: {
      sections: [
        {
          section_id: 'sec-1',
          title: 'Earthing',
          fields: [
            { field_id: 'pf_ok', label: 'Earth OK?', type: 'pass_fail', sans_ref: 'S.1' },
            { field_id: 'pf_bad', label: 'Bond OK?', type: 'pass_fail' },
            { field_id: 'pf_na', label: 'N/A check', type: 'pass_fail' },
            { field_id: 'num_r', label: 'Loop impedance', type: 'number', unit: 'Ω', pass_when: '< 1.0' },
            { field_id: 'txt_note', label: 'Note', type: 'text' },
            { field_id: 'dt_when', label: 'Tested on', type: 'date' },
            { field_id: 'dd_pick', label: 'Method', type: 'dropdown' },
            { field_id: 'cmp_x', label: 'Computed', type: 'computed' },
            { field_id: 'ta_long', label: 'Comments', type: 'textarea' },
            { field_id: 'ms_many', label: 'Faults', type: 'multi_select' },
            { field_id: 'hdr_1', label: 'A Heading', type: 'header' },
            { field_id: 'ph_evidence', label: 'Evidence', type: 'photo' },
            { field_id: 'file_cert', label: 'Prior cert', type: 'file' },
            { field_id: 'sig_x', label: 'Sign here', type: 'signature' },
            {
              field_id: 'grp',
              label: 'Snags',
              type: 'repeating_group',
              fields: [
                { field_id: 'desc', label: 'Description', type: 'text' },
                { field_id: 'cleared', label: 'Cleared?', type: 'pass_fail' },
              ],
            },
          ],
          subsections: [
            {
              subsection_id: 'sub-1',
              title: 'Sub',
              fields: [
                { field_id: 'sub_txt', label: 'Sub text', type: 'text' },
              ],
            },
          ],
        },
      ],
    },
  },
  error: null,
}

const PROJECT_ROW = {
  data: {
    name: 'KINGSWALK',
    code: 'KW',
    organisation_id: 'org-1',
    client_logo_url: 'org-1/client.png',
    project_logo_url: null,
    report_accent_color: '#123456',
    status: 'active',
  },
  error: null,
}

const ORG_ROW = {
  data: { name: 'WM Consulting', logo_url: 'org-1/logo.png', report_accent_color: '#abcdef' },
  error: null,
}

// Responses covering every §6 type, plus two repeating-group entries.
const RESPONSES_ROW = {
  data: [
    { section_id: 'sec-1', field_id: 'pf_ok', value_bool: true, pass_state: 'pass' },
    { section_id: 'sec-1', field_id: 'pf_bad', value_bool: false, pass_state: 'fail', fail_reason: 'Loose lug' },
    { section_id: 'sec-1', field_id: 'pf_na', pass_state: 'na' },
    { section_id: 'sec-1', field_id: 'num_r', value_number: 0.42, pass_state: 'pass' },
    { section_id: 'sec-1', field_id: 'txt_note', value_text: 'All good' },
    { section_id: 'sec-1', field_id: 'dt_when', value_text: '2026-01-01' },
    { section_id: 'sec-1', field_id: 'dd_pick', value_text: 'Method A' },
    { section_id: 'sec-1', field_id: 'cmp_x', value_text: '42' },
    { section_id: 'sec-1', field_id: 'ta_long', value_text: 'A long comment.' },
    { section_id: 'sec-1', field_id: 'ms_many', value_array: ['Crack', 'Rust'] },
    { section_id: 'sec-1', field_id: 'grp[0].desc', value_text: 'Snag one' },
    { section_id: 'sec-1', field_id: 'grp[0].cleared', value_bool: false, pass_state: 'fail' },
    { section_id: 'sec-1', field_id: 'grp[1].desc', value_text: 'Snag two' },
    { section_id: 'sec-1', field_id: 'grp[1].cleared', value_bool: true, pass_state: 'pass' },
    { section_id: 'sec-1', field_id: 'sub_txt', value_text: 'sub value' },
  ],
  error: null,
}

const HISTORY_ROW = {
  data: [
    { section_id: 'sec-1', field_id: 'pf_ok', responded_by: 'user-insp', responded_at: '2026-01-01T08:05:00Z' },
    { section_id: 'sec-1', field_id: 'pf_bad', responded_by: 'user-other', responded_at: '2026-01-01T08:06:00Z' },
  ],
  error: null,
}

// Two photo rows on the SAME inspection but different (section,field):
// one maps to a `photo` field → photoFields; one to a `file` field → annexures.
const PHOTOS_ROW = {
  data: [
    {
      id: 'photo-1',
      section_id: 'sec-1',
      field_id: 'ph_evidence',
      storage_path: 'p/thumb.jpg',
      original_path: 'p/full.jpg',
      caption: 'Busbar',
      gps_lat: -29.85,
      gps_lng: 31.02,
      taken_at: '2026-01-01T08:10:00Z',
      uploaded_by: 'user-insp',
    },
    {
      id: 'file-1',
      section_id: 'sec-1',
      field_id: 'file_cert',
      storage_path: 'f/prior-cert.pdf',
      original_path: null,
      caption: 'prior-cert.pdf',
      uploaded_by: 'user-insp',
    },
  ],
  error: null,
}

const SIGNATURES_ROW = {
  data: [
    {
      id: 'sig-row-1',
      role: 'inspector',
      signatory_name: 'Jane Inspector',
      signatory_title: 'Master Electrician',
      registration_number: 'ME-123',
      storage_path: 's/sig1.png',
      signed_at: '2026-01-02T09:00:00Z',
    },
  ],
  error: null,
}

// Service-client profile rows — names that the cookie client could NOT supply.
const PROFILES_ROW = {
  data: [
    { id: 'user-insp', full_name: 'Ivan Inspector', email: 'ivan@x.com' },
    { id: 'user-verif', full_name: 'Vera Verifier', email: 'vera@x.com' },
    { id: 'user-other', full_name: 'Otto Other', email: 'otto@x.com' },
  ],
  error: null,
}

function serviceTables(over: Record<string, any> = {}) {
  return {
    'inspections.templates': TEMPLATE_ROW,
    'projects.projects': PROJECT_ROW,
    'public.organisations': ORG_ROW,
    'inspections.responses': RESPONSES_ROW,
    'inspections.response_history': HISTORY_ROW,
    'inspections.photos': PHOTOS_ROW,
    'inspections.signatures': SIGNATURES_ROW,
    'public.profiles': PROFILES_ROW,
    'tenants.documents': { data: [], error: null },
    ...over,
  }
}

function setup(opts: {
  inspectionRow?: any
  serviceOver?: Record<string, any>
  serviceDownloads?: Record<string, { data: any; error: any } | undefined>
  gateOk?: boolean
  storageCapture?: string[]
} = {}) {
  const cookieClient = makeClient({
    tables: { 'inspections.inspections': opts.inspectionRow ?? baseInspectionRow() },
  })
  const service = makeClient({
    tables: serviceTables(opts.serviceOver),
    downloads: opts.serviceDownloads,
    storageBuckets: opts.storageCapture,
  })
  createClientMock.mockResolvedValue(cookieClient)
  createServiceClientMock.mockReturnValue(service)
  requireEffectiveRoleMock.mockResolvedValue(
    opts.gateOk === false ? { ok: false, error: 'No access to this project' } : { ok: true, role: 'owner' },
  )
  return { cookieClient, service }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── RBAC ─────────────────────────────────────────────────────────────────

describe('gatherInspectionReportData — RBAC gate', () => {
  it('throws and does NOT fetch when the gate rejects', async () => {
    setup({ gateOk: false })
    await expect(gatherInspectionReportData(INSPECTION_ID)).rejects.toThrow(
      /No access to this project/,
    )
    // service client must never be constructed when the gate fails
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('proceeds when the gate accepts', async () => {
    setup({ gateOk: true })
    const data = await gatherInspectionReportData(INSPECTION_ID)
    expect(data.inspectionId).toBe(INSPECTION_ID)
    expect(createServiceClientMock).toHaveBeenCalledTimes(1)
  })

  it('throws a not-found error when the inspection row is missing', async () => {
    const cookieClient = makeClient({
      tables: { 'inspections.inspections': { data: null, error: null } },
    })
    createClientMock.mockResolvedValue(cookieClient)
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
    await expect(gatherInspectionReportData(INSPECTION_ID)).rejects.toThrow(/not found/i)
  })
})

// ─── §6 field-type mapping ─────────────────────────────────────────────────

describe('gatherInspectionReportData — §6 field mapping', () => {
  it('maps every scalar field type and routes photo/file/signature/group correctly', async () => {
    setup()
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const section = data.sections.find((s) => s.sectionId === 'sec-1')!
    const byId = Object.fromEntries(section.rows.map((r) => [r.fieldId, r]))

    // pass_fail (true / false+reason / na)
    expect(byId['pf_ok']).toMatchObject({ kind: 'result', pass: 'pass', sansRef: 'S.1' })
    expect(byId['pf_bad']).toMatchObject({ kind: 'result', pass: 'fail', failReason: 'Loose lug' })
    expect(byId['pf_na']).toMatchObject({ kind: 'result', pass: 'na' })

    // number with unit + pass_when threshold + pass-state
    expect(byId['num_r'].kind).toBe('value')
    expect(byId['num_r'].value).toContain('0.42')
    expect(byId['num_r'].value).toContain('Ω')
    expect(byId['num_r'].value).toContain('< 1.0')
    expect(byId['num_r'].value).toContain('pass')

    // text / date / dropdown / computed → value
    expect(byId['txt_note']).toMatchObject({ kind: 'value', value: 'All good' })
    expect(byId['dt_when']).toMatchObject({ kind: 'value', value: '2026-01-01' })
    expect(byId['dd_pick']).toMatchObject({ kind: 'value', value: 'Method A' })
    expect(byId['cmp_x']).toMatchObject({ kind: 'value', value: '42' })

    // textarea → paragraph
    expect(byId['ta_long']).toMatchObject({ kind: 'paragraph', value: 'A long comment.' })

    // multi_select → list, comma-joined
    expect(byId['ms_many']).toMatchObject({ kind: 'list', value: 'Crack, Rust' })

    // header → subheading
    expect(byId['hdr_1']).toMatchObject({ kind: 'subheading' })

    // subsection field flattened into rows
    expect(byId['sub_txt']).toMatchObject({ kind: 'value', value: 'sub value' })

    // photo NOT in rows; file NOT in rows; signature NOT in rows
    expect(byId['ph_evidence']).toBeUndefined()
    expect(byId['file_cert']).toBeUndefined()
    expect(byId['sig_x']).toBeUndefined()

    // photo → photoFields
    const pf = section.photoFields.find((f) => f.fieldId === 'ph_evidence')
    expect(pf).toBeDefined()
    expect(pf!.label).toBe('Evidence')

    // file → annexures(attachment)
    const fileAnnex = data.annexures.find((a) => a.source === 'attachment')
    expect(fileAnnex).toBeDefined()
    expect(fileAnnex!.name).toBe('prior-cert.pdf')

    // signature → signatures (by ROW role, not the template field)
    expect(data.signatures).toHaveLength(1)
    expect(data.signatures[0]).toMatchObject({ role: 'inspector', name: 'Jane Inspector' })
  })

  it('expands repeating_group into one entry per discovered synthetic index', async () => {
    setup()
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const section = data.sections.find((s) => s.sectionId === 'sec-1')!
    const group = section.groups.find((g) => g.fieldId === 'grp')
    expect(group).toBeDefined()
    expect(group!.label).toBe('Snags')
    expect(group!.entries.map((e) => e.index)).toEqual([0, 1])

    const entry0 = group!.entries[0]
    const e0 = Object.fromEntries(entry0.rows.map((r) => [r.fieldId, r]))
    expect(e0['grp[0].desc']).toMatchObject({ kind: 'value', value: 'Snag one' })
    expect(e0['grp[0].cleared']).toMatchObject({ kind: 'result', pass: 'fail' })
  })
})

// ─── Photo vs file routing + bucket assertions ─────────────────────────────

describe('gatherInspectionReportData — photo vs file routing', () => {
  it('signs photo rows against inspection-photos and file rows against inspection-attachments', async () => {
    const buckets: string[] = []
    setup({ storageCapture: buckets })
    const data = await gatherInspectionReportData(INSPECTION_ID)

    // photo embedded as data URI in photoFields
    const section = data.sections.find((s) => s.sectionId === 'sec-1')!
    const photoField = section.photoFields.find((f) => f.fieldId === 'ph_evidence')!
    expect(photoField.photos).toHaveLength(1)
    expect(photoField.photos[0].dataUri).toMatch(/^data:image\//)

    // buckets touched include both photo + attachment buckets (+ report-logos)
    expect(buckets).toContain('inspection-photos')
    expect(buckets).toContain('inspection-attachments')
  })

  it('prefers original_path over storage_path when downloading a photo', async () => {
    const buckets: string[] = []
    // Make the full-res path explicitly succeed and assert it was the one fetched.
    setup({
      storageCapture: buckets,
      serviceDownloads: {
        'inspection-photos:p/full.jpg': {
          data: { type: 'image/jpeg', arrayBuffer: async () => new Uint8Array([9, 9]).buffer },
          error: null,
        },
        'inspection-photos:p/thumb.jpg': { data: null, error: { message: 'should not be used' } },
      },
    })
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const section = data.sections.find((s) => s.sectionId === 'sec-1')!
    const photoField = section.photoFields.find((f) => f.fieldId === 'ph_evidence')!
    // jpeg mime proves the original_path branch was taken
    expect(photoField.photos[0].dataUri).toMatch(/^data:image\/jpeg/)
  })

  it('caps photo count at MAX_PHOTOS_PER_FIELD and reports omittedCount', async () => {
    // Build MAX_PHOTOS_PER_FIELD + 1 photo rows for the same photo field.
    // Only the first MAX should be embedded; omittedCount should be 1.
    const cap = 24 // must stay in sync with MAX_PHOTOS_PER_FIELD in the module
    const total = cap + 1
    const manyPhotos = Array.from({ length: total }, (_, i) => ({
      id: `bulk-photo-${i}`,
      section_id: 'sec-1',
      field_id: 'ph_evidence',
      storage_path: `p/photo-${i}.jpg`,
      original_path: null,
      caption: `Photo ${i}`,
      gps_lat: null,
      gps_lng: null,
      taken_at: null,
      uploaded_by: null,
    }))
    setup({
      serviceOver: {
        'inspections.photos': { data: manyPhotos, error: null },
      },
    })
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const section = data.sections.find((s) => s.sectionId === 'sec-1')!
    const photoField = section.photoFields.find((f) => f.fieldId === 'ph_evidence')!
    expect(photoField.photos.length).toBe(cap)
    expect(photoField.omittedCount).toBe(total - cap) // === 1
  })

  it('treats an orphan photo row (no matching template field) as an annexure', async () => {
    setup({
      serviceOver: {
        'inspections.photos': {
          data: [
            {
              id: 'orphan-1',
              section_id: 'sec-1',
              field_id: 'does_not_exist',
              storage_path: 'o/blob.bin',
              original_path: null,
              caption: 'blob.bin',
              uploaded_by: 'user-insp',
            },
          ],
          error: null,
        },
      },
    })
    const data = await gatherInspectionReportData(INSPECTION_ID)
    // not in any photoFields
    const anyPhoto = data.sections.some((s) => s.photoFields.some((f) => f.photos.length > 0))
    expect(anyPhoto).toBe(false)
    // present as an attachment annexure instead
    expect(data.annexures.some((a) => a.source === 'attachment' && a.name === 'blob.bin')).toBe(true)
  })
})

// ─── Names via service client ──────────────────────────────────────────────

describe('gatherInspectionReportData — name resolution via service client', () => {
  it('resolves inspector / verifier / audit names from the SERVICE client profiles', async () => {
    setup()
    const data = await gatherInspectionReportData(INSPECTION_ID)

    // verifier name came from the service profiles fixture
    expect(data.summary.verifier).toBe('Vera Verifier')
    // inspectors include the assigned inspector + history contributors
    expect(data.summary.inspectors).toContain('Ivan Inspector')
    // audit `by` resolved (Otto Other contributed to pf_bad history)
    const otto = data.audit.find((a) => a.fieldId === 'pf_bad')
    expect(otto?.by).toBe('Otto Other')
  })

  it('falls back to a short-uuid when a profile name is missing', async () => {
    setup({
      serviceOver: {
        'public.profiles': { data: [], error: null }, // no names resolvable
      },
    })
    const data = await gatherInspectionReportData(INSPECTION_ID)
    // verifier_id = 'user-verif' → slice(0,8)
    expect(data.summary.verifier).toBe('user-ver')
  })
})

// ─── Graceful degradation ──────────────────────────────────────────────────

describe('gatherInspectionReportData — graceful degradation', () => {
  it('sets photo dataUri / signature imageDataUri to null on download failure, no throw', async () => {
    setup({
      serviceDownloads: {
        'inspection-photos:p/full.jpg': { data: null, error: { message: 'boom' } },
        's/sig1.png': { data: null, error: { message: 'boom' } },
        'inspection-signatures:s/sig1.png': { data: null, error: { message: 'boom' } },
      },
    })
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const section = data.sections.find((s) => s.sectionId === 'sec-1')!
    const photoField = section.photoFields.find((f) => f.fieldId === 'ph_evidence')!
    expect(photoField.photos[0].dataUri).toBeNull()
    expect(data.signatures[0].imageDataUri).toBeNull()
  })

  it('sets orgLogoDataUri to null when org.logo_url is null', async () => {
    setup({
      serviceOver: {
        'public.organisations': {
          data: { name: 'WM Consulting', logo_url: null, report_accent_color: '#abcdef' },
          error: null,
        },
      },
    })
    const data = await gatherInspectionReportData(INSPECTION_ID)
    expect(data.brandingInput.orgLogoDataUri).toBeNull()
    expect(data.brandingInput.orgName).toBe('WM Consulting')
  })
})

// ─── Repeating-group photo sub-fields ─────────────────────────────────────
// Photos on a repeating_group photo sub-field were silently dropped because
// the photo-emit pass iterates flattenSectionFields (which intentionally does
// NOT recurse into group sub-fields), so photo buckets keyed by synthetic ids
// like "sub_feeds[0].breaker_photo" were never drained → photos vanished.

describe('gatherInspectionReportData — repeating_group photo sub-fields', () => {
  // Template: one section with a repeating_group that has a photo sub-field.
  const GROUP_PHOTO_TEMPLATE = {
    data: {
      name: 'Distribution Board Inspection',
      version: '1.0',
      deliverable_type: 'inspection_only',
      sans_reference: 'SANS 10142-1',
      schema_json: {
        sections: [
          {
            section_id: 'sec-feeds',
            title: 'Sub-feeds',
            fields: [
              {
                field_id: 'sub_feeds',
                label: 'Sub-feed Circuits',
                type: 'repeating_group',
                fields: [
                  { field_id: 'circuit_label', label: 'Circuit label', type: 'text' },
                  { field_id: 'breaker_photo', label: 'Breaker photo', type: 'photo' },
                ],
              },
            ],
          },
        ],
      },
    },
    error: null,
  }

  // Responses: two entries in sub_feeds, each with a text and a photo response.
  const GROUP_PHOTO_RESPONSES = {
    data: [
      { section_id: 'sec-feeds', field_id: 'sub_feeds[0].circuit_label', value_text: 'Circuit A' },
      { section_id: 'sec-feeds', field_id: 'sub_feeds[1].circuit_label', value_text: 'Circuit B' },
    ],
    error: null,
  }

  // Photo rows using the synthetic field ids for group sub-fields.
  const GROUP_PHOTO_ROWS = {
    data: [
      {
        id: 'grp-photo-0',
        section_id: 'sec-feeds',
        field_id: 'sub_feeds[0].breaker_photo',
        storage_path: 'p/entry0-breaker.jpg',
        original_path: 'p/entry0-breaker-full.jpg',
        caption: 'Entry 0 breaker',
        gps_lat: null,
        gps_lng: null,
        taken_at: '2026-01-01T09:00:00Z',
        uploaded_by: 'user-insp',
      },
      {
        id: 'grp-photo-1',
        section_id: 'sec-feeds',
        field_id: 'sub_feeds[1].breaker_photo',
        storage_path: 'p/entry1-breaker.jpg',
        original_path: null,
        caption: 'Entry 1 breaker',
        gps_lat: null,
        gps_lng: null,
        taken_at: '2026-01-01T09:01:00Z',
        uploaded_by: 'user-insp',
      },
    ],
    error: null,
  }

  function setupGroupPhoto() {
    const buckets: string[] = []
    setup({
      storageCapture: buckets,
      serviceOver: {
        'inspections.templates': GROUP_PHOTO_TEMPLATE,
        'inspections.responses': GROUP_PHOTO_RESPONSES,
        'inspections.photos': GROUP_PHOTO_ROWS,
      },
    })
    return buckets
  }

  it('emits group photo sub-field photos into the section photoFields (not annexures)', async () => {
    setupGroupPhoto()
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const section = data.sections.find((s) => s.sectionId === 'sec-feeds')!

    // Must have photo fields for the two entries.
    expect(section.photoFields.length).toBeGreaterThanOrEqual(1)

    // All group photo rows must be accounted for in photoFields (not lost).
    const totalPhotosInSection = section.photoFields.reduce(
      (sum, pf) => sum + pf.photos.length + pf.omittedCount,
      0,
    )
    expect(totalPhotosInSection).toBe(2)

    // None of the group photos may appear in annexures.
    const annexureNames = data.annexures.map((a) => a.name)
    expect(annexureNames).not.toContain('Entry 0 breaker')
    expect(annexureNames).not.toContain('Entry 1 breaker')
  })

  it('gives group photo ReportPhotoFields entry-aware labels (group + entry number + sub-field)', async () => {
    setupGroupPhoto()
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const section = data.sections.find((s) => s.sectionId === 'sec-feeds')!

    const labels = section.photoFields.map((pf) => pf.label)
    // Each label should convey group + entry number + sub-field name.
    expect(labels.some((l) => l.includes('Sub-feed Circuits') && l.includes('Entry 1') && l.includes('Breaker photo'))).toBe(true)
    expect(labels.some((l) => l.includes('Sub-feed Circuits') && l.includes('Entry 2') && l.includes('Breaker photo'))).toBe(true)
  })

  it('downloads group photo data URIs against the inspection-photos bucket', async () => {
    const buckets = setupGroupPhoto()
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const section = data.sections.find((s) => s.sectionId === 'sec-feeds')!

    // Each photoField should have a data URI resolved.
    for (const pf of section.photoFields) {
      for (const ph of pf.photos) {
        expect(ph.dataUri).toMatch(/^data:image\//)
      }
    }
    // inspection-photos bucket was used for the downloads.
    expect(buckets).toContain('inspection-photos')
  })
})

// ─── Summary tally + failed list ───────────────────────────────────────────

describe('gatherInspectionReportData — summary tally + failed list', () => {
  it('counts pass/fail/na across all pass_fail responses incl. group entries', async () => {
    setup()
    const data = await gatherInspectionReportData(INSPECTION_ID)
    // pass_fail responses: pf_ok(pass), pf_bad(fail), pf_na(na),
    //                      grp[0].cleared(fail), grp[1].cleared(pass)
    expect(data.summary.tally).toEqual({ pass: 2, fail: 2, na: 1 })
  })

  it('lists failed field labels including a group-entry label', async () => {
    setup()
    const data = await gatherInspectionReportData(INSPECTION_ID)
    const labels = data.summary.failed.map((f) => f.label)
    // top-level fail
    expect(labels.some((l) => l.includes('Bond OK?'))).toBe(true)
    // group-entry fail (the cert labels these with the entry + sub-field)
    expect(labels.some((l) => l.includes('Snags') && l.toLowerCase().includes('cleared'))).toBe(true)
  })

  it('uses coc_number when present and the pending sentinel otherwise', async () => {
    setup({ inspectionRow: baseInspectionRow({ coc_number: 'COC-0001' }) })
    const withCoc = await gatherInspectionReportData(INSPECTION_ID)
    expect(withCoc.summary.documentNumber).toBe('COC-0001')

    setup({ inspectionRow: baseInspectionRow({ coc_number: null }) })
    const without = await gatherInspectionReportData(INSPECTION_ID)
    expect(without.summary.documentNumber).toBe('— pending —')
  })
})
