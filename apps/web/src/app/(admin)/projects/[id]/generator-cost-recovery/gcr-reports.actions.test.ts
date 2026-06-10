import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const requireRoleMock = vi.fn()
const requireEffectiveRoleMock = vi.fn()
const hasFeatureSeatMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: requireRoleMock,
  requireEffectiveRole: requireEffectiveRoleMock,
}))
vi.mock('@/lib/features', () => ({
  hasFeatureSeat: hasFeatureSeatMock,
}))

// ─── IDs / fixtures ───────────────────────────────────────────────────────────

const PROJECT_ID  = '00000000-0000-0000-0000-000000000011'
const ORG_ID      = '00000000-0000-0000-0000-000000000001'
const REVISION_ID = '00000000-0000-0000-0000-000000000055'
const USER_ID     = '00000000-0000-0000-0000-000000000077'

const REVISION_ROW = {
  id: REVISION_ID,
  project_id: PROJECT_ID,
  organisation_id: ORG_ID,
  revision_number: 3,
  storage_path: `${ORG_ID}/${PROJECT_ID}/generator-cost-recovery/123-abc.pdf`,
  file_name: 'mall-generator-cost-recovery-rev3.pdf',
  note: null,
  summary: null,
  created_by: USER_ID,
  created_at: '2026-06-10T08:00:00Z',
}

// ─── Supabase mock builder ───────────────────────────────────────────────────
//
// Routes schema('projects') to the org-resolve chain and schema('gcr') to a
// configurable report_revisions chain (select list / select single / delete).

function makeSupabase(opts: {
  orgId?: string | null
  /** rows returned by the list query (select → eq → order) */
  listRows?: unknown[] | null
  listError?: { message: string } | null
  /** row returned by the single-revision lookup (select → eq → eq → maybeSingle) */
  revisionRow?: unknown | null
  deleteError?: { message: string } | null
}) {
  const {
    orgId = ORG_ID,
    listRows = [],
    listError = null,
    revisionRow = null,
    deleteError = null,
  } = opts

  // projects.projects resolve chain
  const projMaybeSingle = vi.fn().mockResolvedValue({
    data: orgId ? { organisation_id: orgId } : null,
    error: null,
  })
  const projEq = vi.fn().mockReturnValue({ maybeSingle: projMaybeSingle })
  const projSelect = vi.fn().mockReturnValue({ eq: projEq })
  const fromProjects = vi.fn().mockReturnValue({ select: projSelect })

  // gcr.report_revisions chains
  const order = vi.fn().mockResolvedValue({ data: listRows, error: listError })
  const revMaybeSingle = vi.fn().mockResolvedValue({ data: revisionRow, error: null })
  const eq2 = vi.fn().mockReturnValue({ maybeSingle: revMaybeSingle })
  const eq1 = vi.fn().mockReturnValue({ order, eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })

  const deleteEq2 = vi.fn().mockResolvedValue({ error: deleteError })
  const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 })
  const del = vi.fn().mockReturnValue({ eq: deleteEq1 })

  const fromRevisions = vi.fn().mockReturnValue({ select, delete: del })

  const schema = vi.fn((name: string) =>
    name === 'projects' ? { from: fromProjects } : { from: fromRevisions },
  )

  return {
    client: {
      schema,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    },
    del,
  }
}

function makeServiceClient(opts: {
  signedUrl?: string | null
} = {}) {
  const createSignedUrl = vi.fn().mockResolvedValue(
    opts.signedUrl === null
      ? { data: null, error: { message: 'sign failed' } }
      : { data: { signedUrl: opts.signedUrl ?? 'https://signed.example/x.pdf' }, error: null },
  )
  const remove = vi.fn().mockResolvedValue({ data: null, error: null })
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrl, remove })
  return { client: { storage: { from: storageFrom } }, createSignedUrl, remove }
}

// ─── listGcrReportRevisionsAction ────────────────────────────────────────────

describe('listGcrReportRevisionsAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns { error } when the role gate fails', async () => {
    const { client } = makeSupabase({})
    createClientMock.mockResolvedValue(client)
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const { listGcrReportRevisionsAction } = await import('./gcr-reports.actions')
    const result = await listGcrReportRevisionsAction(PROJECT_ID)

    expect('error' in result).toBe(true)
  })

  it('returns revisions newest-first on success', async () => {
    const { client } = makeSupabase({ listRows: [REVISION_ROW] })
    createClientMock.mockResolvedValue(client)
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { listGcrReportRevisionsAction } = await import('./gcr-reports.actions')
    const result = await listGcrReportRevisionsAction(PROJECT_ID)

    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result).toHaveLength(1)
      expect(result[0].revision_number).toBe(3)
    }
  })
})

// ─── getGcrReportUrlAction ───────────────────────────────────────────────────

describe('getGcrReportUrlAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns { error } when the seat is missing (fail-closed paid content)', async () => {
    const { client } = makeSupabase({ revisionRow: REVISION_ROW })
    createClientMock.mockResolvedValue(client)
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    hasFeatureSeatMock.mockResolvedValue(false)

    const { getGcrReportUrlAction } = await import('./gcr-reports.actions')
    const result = await getGcrReportUrlAction(PROJECT_ID, REVISION_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/seat/i)
  })

  it('returns { error: Not found } when the revision belongs to another project', async () => {
    // Project-scoped lookup returns null for a foreign revision id.
    const { client } = makeSupabase({ revisionRow: null })
    createClientMock.mockResolvedValue(client)
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    hasFeatureSeatMock.mockResolvedValue(true)

    const { getGcrReportUrlAction } = await import('./gcr-reports.actions')
    const result = await getGcrReportUrlAction(PROJECT_ID, REVISION_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
  })

  it('returns an inline signed URL for view (no download disposition)', async () => {
    const { client } = makeSupabase({ revisionRow: REVISION_ROW })
    const service = makeServiceClient({ signedUrl: 'https://signed.example/inline.pdf' })
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    hasFeatureSeatMock.mockResolvedValue(true)

    const { getGcrReportUrlAction } = await import('./gcr-reports.actions')
    const result = await getGcrReportUrlAction(PROJECT_ID, REVISION_ID)

    expect(result).toEqual({ url: 'https://signed.example/inline.pdf' })
    expect(service.createSignedUrl).toHaveBeenCalledWith(
      REVISION_ROW.storage_path,
      expect.any(Number),
      undefined,
    )
  })

  it('passes the stored file name as download disposition when download=true', async () => {
    const { client } = makeSupabase({ revisionRow: REVISION_ROW })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    hasFeatureSeatMock.mockResolvedValue(true)

    const { getGcrReportUrlAction } = await import('./gcr-reports.actions')
    await getGcrReportUrlAction(PROJECT_ID, REVISION_ID, { download: true })

    expect(service.createSignedUrl).toHaveBeenCalledWith(
      REVISION_ROW.storage_path,
      expect.any(Number),
      { download: REVISION_ROW.file_name },
    )
  })
})

// ─── deleteGcrReportRevisionAction ───────────────────────────────────────────

describe('deleteGcrReportRevisionAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns { error } when caller lacks ORG_WRITE_ROLES', async () => {
    const { client } = makeSupabase({ revisionRow: REVISION_ROW })
    createClientMock.mockResolvedValue(client)
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (viewer) is not allowed' })

    const { deleteGcrReportRevisionAction } = await import('./gcr-reports.actions')
    const result = await deleteGcrReportRevisionAction(PROJECT_ID, REVISION_ID)

    expect('error' in result).toBe(true)
  })

  it('returns { error: Not found } for a revision outside the project', async () => {
    const { client } = makeSupabase({ revisionRow: null })
    createClientMock.mockResolvedValue(client)
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { deleteGcrReportRevisionAction } = await import('./gcr-reports.actions')
    const result = await deleteGcrReportRevisionAction(PROJECT_ID, REVISION_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
  })

  it('deletes the row and best-effort removes the storage object', async () => {
    const { client } = makeSupabase({ revisionRow: REVISION_ROW })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { deleteGcrReportRevisionAction } = await import('./gcr-reports.actions')
    const result = await deleteGcrReportRevisionAction(PROJECT_ID, REVISION_ID)

    expect(result).toEqual({ ok: true })
    expect(service.remove).toHaveBeenCalledWith([REVISION_ROW.storage_path])
  })
})
