import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const requireRoleMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'
const ORG_ID     = '00000000-0000-0000-0000-000000000001'
const REPORT_ID  = '00000000-0000-0000-0000-000000000055'
const USER_ID    = '00000000-0000-0000-0000-000000000077'

const REPORT_ROW = {
  id: REPORT_ID,
  project_id: PROJECT_ID,
  organisation_id: ORG_ID,
  kind: 'tenant_schedule',
  title: 'Tenant Schedule Report',
  storage_path: `${ORG_ID}/${PROJECT_ID}/tenant-schedule-v3.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 1234,
  status: 'issued',
  version: 3,
  generated_by: USER_ID,
  generated_at: '2026-06-20T08:00:00Z',
  created_at: '2026-06-20T08:00:00Z',
}

// Routes schema('projects').from('projects') → org resolve, and
// schema('projects').from('reports') → list / single / delete chains.
function makeSupabase(opts: {
  orgId?: string | null
  listRows?: unknown[] | null
  listError?: { message: string } | null
  reportRow?: unknown | null
  deleteError?: { message: string } | null
} = {}) {
  const { orgId = ORG_ID, listRows = [], listError = null, reportRow = null, deleteError = null } = opts

  const projMaybeSingle = vi.fn().mockResolvedValue({ data: orgId ? { organisation_id: orgId } : null, error: null })
  const projEq = vi.fn().mockReturnValue({ maybeSingle: projMaybeSingle })
  const projSelect = vi.fn().mockReturnValue({ eq: projEq })
  const fromProjects = vi.fn().mockReturnValue({ select: projSelect })

  // list:   select → eq(project) → eq(kind) → in(status) → order
  //   with source: → in(status) → eq(source_table) → eq(source_id) → order
  const order = vi.fn().mockResolvedValue({ data: listRows, error: listError })
  const srcEqId = vi.fn().mockReturnValue({ order })
  const srcEqTable = vi.fn().mockReturnValue({ eq: srcEqId })
  const inFn = vi.fn().mockReturnValue({ order, eq: srcEqTable })
  // single: select → eq(id) → eq(project) → maybeSingle
  const repMaybeSingle = vi.fn().mockResolvedValue({ data: reportRow, error: null })
  const eq2 = vi.fn().mockReturnValue({ in: inFn, maybeSingle: repMaybeSingle })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const reportsSelect = vi.fn().mockReturnValue({ eq: eq1 })
  // delete: delete → eq(id) → eq(project)
  const delEq2 = vi.fn().mockResolvedValue({ error: deleteError })
  const delEq1 = vi.fn().mockReturnValue({ eq: delEq2 })
  const del = vi.fn().mockReturnValue({ eq: delEq1 })
  const fromReports = vi.fn().mockReturnValue({ select: reportsSelect, delete: del })

  const schema = vi.fn(() => ({
    from: (table: string) => (table === 'projects' ? fromProjects() : fromReports()),
  }))

  return {
    client: { schema, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) } },
    del, order, srcEqTable, srcEqId,
  }
}

function makeServiceClient(opts: { signedUrl?: string | null } = {}) {
  const createSignedUrl = vi.fn().mockResolvedValue(
    opts.signedUrl === null
      ? { data: null, error: { message: 'sign failed' } }
      : { data: { signedUrl: opts.signedUrl ?? 'https://signed.example/x.pdf' }, error: null },
  )
  const remove = vi.fn().mockResolvedValue({ data: null, error: null })
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrl, remove })
  return { client: { storage: { from: storageFrom } }, createSignedUrl, remove }
}

describe('listProjectReportsAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('returns rows on success, newest-version-first as queried', async () => {
    const { client } = makeSupabase({ listRows: [REPORT_ROW] })
    createClientMock.mockResolvedValue(client)

    const { listProjectReportsAction } = await import('./project-reports.actions')
    const result = await listProjectReportsAction(PROJECT_ID, 'tenant_schedule')

    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result).toHaveLength(1)
      expect(result[0].version).toBe(3)
      expect(result[0].kind).toBe('tenant_schedule')
    }
  })

  it('returns { error } when the query errors', async () => {
    const { client } = makeSupabase({ listRows: null, listError: { message: 'boom' } })
    createClientMock.mockResolvedValue(client)

    const { listProjectReportsAction } = await import('./project-reports.actions')
    const result = await listProjectReportsAction(PROJECT_ID, 'tenant_schedule')

    expect('error' in result).toBe(true)
  })

  it('adds source_table/source_id filters when source is given', async () => {
    const sup = makeSupabase({ listRows: [REPORT_ROW] })
    createClientMock.mockResolvedValue(sup.client)

    const { listProjectReportsAction } = await import('./project-reports.actions')
    const result = await listProjectReportsAction(PROJECT_ID, 'inspection', { table: 'inspections', id: 'insp-1' })

    expect(Array.isArray(result)).toBe(true)
    expect(sup.srcEqTable).toHaveBeenCalledWith('source_table', 'inspections')
    expect(sup.srcEqId).toHaveBeenCalledWith('source_id', 'insp-1')
  })
})

describe('getProjectReportUrlAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('returns { error: Not found } for a report id outside the project', async () => {
    const { client } = makeSupabase({ reportRow: null })
    createClientMock.mockResolvedValue(client)

    const { getProjectReportUrlAction } = await import('./project-reports.actions')
    const result = await getProjectReportUrlAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
  })

  it('returns an inline signed URL (no download disposition)', async () => {
    const { client } = makeSupabase({ reportRow: REPORT_ROW })
    const service = makeServiceClient({ signedUrl: 'https://signed.example/inline.pdf' })
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getProjectReportUrlAction } = await import('./project-reports.actions')
    const result = await getProjectReportUrlAction(PROJECT_ID, REPORT_ID)

    expect(result).toEqual({ url: 'https://signed.example/inline.pdf' })
    expect(service.createSignedUrl).toHaveBeenCalledWith(REPORT_ROW.storage_path, expect.any(Number), undefined)
  })

  it('passes a derived download filename when download=true', async () => {
    const { client } = makeSupabase({ reportRow: REPORT_ROW })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getProjectReportUrlAction } = await import('./project-reports.actions')
    await getProjectReportUrlAction(PROJECT_ID, REPORT_ID, { download: true })

    expect(service.createSignedUrl).toHaveBeenCalledWith(
      REPORT_ROW.storage_path,
      expect.any(Number),
      { download: 'tenant-schedule-report-v3.pdf' },
    )
  })
})

describe('deleteProjectReportAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('returns { error } when caller lacks ORG_WRITE_ROLES', async () => {
    const { client } = makeSupabase({ reportRow: REPORT_ROW })
    createClientMock.mockResolvedValue(client)
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (viewer) is not allowed' })

    const { deleteProjectReportAction } = await import('./project-reports.actions')
    const result = await deleteProjectReportAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
  })

  it('returns { error: Not found } for a report outside the project', async () => {
    const { client } = makeSupabase({ reportRow: null })
    createClientMock.mockResolvedValue(client)
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { deleteProjectReportAction } = await import('./project-reports.actions')
    const result = await deleteProjectReportAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
  })

  it('deletes the row and best-effort removes the storage object', async () => {
    const { client } = makeSupabase({ reportRow: REPORT_ROW })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { deleteProjectReportAction } = await import('./project-reports.actions')
    const result = await deleteProjectReportAction(PROJECT_ID, REPORT_ID)

    expect(result).toEqual({ ok: true })
    expect(service.remove).toHaveBeenCalledWith([REPORT_ROW.storage_path])
  })
})
