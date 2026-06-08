import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures mocks are initialised before hoisted vi.mock() factories
// — avoids the vitest TDZ crash that hit inspections.actions.test.ts.
const {
  getByIdMock,
  createClientMock,
  createServiceClientMock,
  revalidatePathMock,
  gatherMock,
  renderMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  gatherMock: vi.fn(),
  renderMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@/lib/reports/snag-visit-report-data', () => ({ gatherSnagVisitReportData: gatherMock }))
vi.mock('@/lib/reports/snag-visit-report', () => ({ renderSnagVisitReport: renderMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    projectService: { ...actual.projectService, getById: getByIdMock },
    snagVisitService: {
      createVisit: vi.fn().mockResolvedValue({ id: 'visit-1' }),
      updateVisit: vi.fn().mockResolvedValue({ id: 'visit-1' }),
      deleteVisit: vi.fn().mockResolvedValue(undefined),
    },
  }
})

import {
  createSnagVisitAction,
  updateSnagVisitAction,
  deleteSnagVisitAction,
  addSnagToVisitAction,
  closeSnagOnVisitAction,
  exportSnagVisitReportAction,
} from './snag-visit.actions'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const VISIT_ID   = '22222222-2222-2222-2222-222222222222'
const SNAG_ID    = '33333333-3333-3333-3333-333333333333'
const USER_ID    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

/**
 * Build a minimal supabase-js mock.
 *
 * auth.getUser — returns a user.
 * rpc          — returns the effective project role (used by requireEffectiveRole).
 * schema       — returns a builder that settles to { data: rowData | null, error: null }.
 *
 * snagRow controls what guardSnagBelongsToProject sees (defaults to visitRow so
 * both guards pass in the same way). Pass snagRow: null to simulate a snag that
 * does not belong to this project.
 */
function mockClient(opts: {
  role?: string | null
  visitRow?: object | null
  snagRow?: object | null | undefined
  photoRows?: object[]
} = {}) {
  const { role = 'owner', visitRow = { id: VISIT_ID }, photoRows = [] } = opts
  // snagRow defaults to visitRow sentinel so both guards pass unless explicitly overridden
  const snagRow = 'snagRow' in opts ? opts.snagRow : { id: SNAG_ID }

  const schemaBuilder = (overrideData: unknown) => ({
    from: (table: string) => {
      // guardSnagBelongsToProject queries 'snags'; everything else uses overrideData
      const rowData = table === 'snags' ? snagRow : overrideData
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: rowData, error: null }),
              limit: () => Promise.resolve({ data: photoRows, error: null }),
            }),
            limit: () => Promise.resolve({ data: photoRows, error: null }),
            maybeSingle: () => Promise.resolve({ data: rowData, error: null }),
            single: () => Promise.resolve({ data: rowData, error: null }),
          }),
          maybeSingle: () => Promise.resolve({ data: rowData, error: null }),
          limit: () => Promise.resolve({ data: photoRows, error: null }),
        }),
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: SNAG_ID }, error: null }),
          }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: { title: 'Test snag', raised_by: 'u2', assigned_to: null, organisation_id: 'org-1' },
                error: null,
              }),
            }),
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({
                  data: { title: 'Test snag', raised_by: 'u2', assigned_to: null, organisation_id: 'org-1' },
                  error: null,
                }),
              }),
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }
    },
  })

  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    schema: (s: string) => schemaBuilder(s === 'field' ? visitRow : null),
  }
}

/** Service-role client mock — same shape but doesn't need an rpc (no role check). */
function mockServiceClient(opts: {
  visitRow?: object | null
  snagInsertResult?: object | null
  updateResult?: object | null
  deleteError?: string | null
} = {}) {
  const {
    visitRow = { id: VISIT_ID },
    snagInsertResult = { id: SNAG_ID },
    updateResult = { title: 'Test snag', raised_by: 'u2', assigned_to: null, organisation_id: 'org-1' },
    deleteError = null,
  } = opts

  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    schema: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: visitRow, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: visitRow, error: null }),
            single: () => Promise.resolve({ data: visitRow, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: snagInsertResult, error: null }),
          }),
        }),
        update: () => ({
          eq: () => ({
            // .eq('id', snagId) — first eq
            select: () => ({
              single: () => Promise.resolve({ data: updateResult, error: null }),
            }),
            // .eq('id', snagId).eq('project_id', projectId) — defense-in-depth (Fix 1b)
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: updateResult, error: null }),
              }),
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
        delete: () => ({
          eq: () => deleteError
            ? Promise.resolve({ error: { message: deleteError } })
            : Promise.resolve({ error: null }),
        }),
      }),
    }),
  }
}

beforeEach(async () => {
  createClientMock.mockReset()
  createServiceClientMock.mockReset()
  revalidatePathMock.mockReset()
  getByIdMock.mockReset()

  // Reset snagVisitService mocks so call counts don't bleed between tests
  const { snagVisitService } = await import('@esite/shared')
  ;(snagVisitService.createVisit as ReturnType<typeof vi.fn>).mockReset()
  ;(snagVisitService.updateVisit as ReturnType<typeof vi.fn>).mockReset()
  ;(snagVisitService.deleteVisit as ReturnType<typeof vi.fn>).mockReset()
  ;(snagVisitService.createVisit as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'visit-1' })
  ;(snagVisitService.updateVisit as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'visit-1' })
  ;(snagVisitService.deleteVisit as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  createClientMock.mockResolvedValue(mockClient())
  createServiceClientMock.mockReturnValue(mockServiceClient())

  gatherMock.mockReset()
  renderMock.mockReset()
  gatherMock.mockResolvedValue({
    branding: { accent: '#F59E0B', issuer: { wordmark: 'WM Consulting' }, kicker: 'SNAG & DEFECT REPORT', projectLine: 'Test Project' },
    visit: { id: VISIT_ID, visitNo: 1, isBacklog: false, visitDate: '2026-06-04', title: null, notes: null, conductedByName: null, attendeeNames: [], newCount: 0, openCount: 0, closedCount: 0 },
    projectName: 'Test Project',
    newSnags: [],
    stillOpen: [],
    closedThisVisit: [],
  })
  renderMock.mockResolvedValue(Buffer.from('%PDF-1.4 mock'))

  vi.unstubAllGlobals()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

// ─────────────────────────────────────────────────────────────────────────────
// createSnagVisitAction
// ─────────────────────────────────────────────────────────────────────────────

describe('createSnagVisitAction — validation', () => {
  it('rejects a non-uuid projectId before any I/O', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await createSnagVisitAction({ projectId: 'bad', visitDate: '2026-06-04' } as any)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid date format before any I/O', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await createSnagVisitAction({ projectId: PROJECT_ID, visitDate: '04-06-2026' } as any)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('createSnagVisitAction — happy path', () => {
  it('creates a visit and returns visitId', async () => {
    const res = await createSnagVisitAction({ projectId: PROJECT_ID, visitDate: '2026-06-04', attendees: [] })
    expect(res).toEqual({ visitId: 'visit-1' })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/snags`)
  })

  it('defaults conductedBy to the caller when omitted', async () => {
    const { snagVisitService } = await import('@esite/shared')
    await createSnagVisitAction({ projectId: PROJECT_ID, visitDate: '2026-06-04', attendees: [] })
    expect(snagVisitService.createVisit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ conductedBy: USER_ID }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateSnagVisitAction
// ─────────────────────────────────────────────────────────────────────────────

describe('updateSnagVisitAction — validation', () => {
  it('rejects an empty patch (no editable fields)', async () => {
    const res = await updateSnagVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID })
    expect(res).toEqual({ error: expect.stringContaining('At least one field') })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('accepts a patch with only title', async () => {
    const res = await updateSnagVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID, title: 'Updated' })
    expect(res).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// deleteSnagVisitAction
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteSnagVisitAction', () => {
  it('rejects non-uuid visitId before any I/O', async () => {
    const res = await deleteSnagVisitAction('not-a-uuid', PROJECT_ID)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('deletes and revalidates on success', async () => {
    const res = await deleteSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect(res).toEqual({})
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/snags`)
  })

  it('surfaces a friendly FK block error when the DB rejects the delete', async () => {
    createServiceClientMock.mockReturnValue(
      mockServiceClient({ deleteError: 'violates foreign key constraint' }),
    )
    const { snagVisitService } = await import('@esite/shared')
    ;(snagVisitService.deleteVisit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('violates foreign key constraint'),
    )
    const res = await deleteSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.stringContaining('cannot be deleted') })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RBAC gate (C1 — critical security invariant)
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC gate (C1) — client_viewer is rejected before any write', () => {
  beforeEach(() => {
    createClientMock.mockResolvedValue(mockClient({ role: 'client_viewer' }))
    createServiceClientMock.mockReturnValue(mockServiceClient())
  })

  it('createSnagVisitAction — rejected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await createSnagVisitAction({ projectId: PROJECT_ID, visitDate: '2026-06-04', attendees: [] })
    expect('error' in res).toBe(true)
    const { snagVisitService } = await import('@esite/shared')
    expect(snagVisitService.createVisit).not.toHaveBeenCalled()
  })

  it('updateSnagVisitAction — rejected', async () => {
    const res = await updateSnagVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID, title: 'X' })
    expect('error' in res).toBe(true)
    const { snagVisitService } = await import('@esite/shared')
    expect(snagVisitService.updateVisit).not.toHaveBeenCalled()
  })

  it('deleteSnagVisitAction — rejected', async () => {
    const res = await deleteSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect('error' in res).toBe(true)
    const { snagVisitService } = await import('@esite/shared')
    expect(snagVisitService.deleteVisit).not.toHaveBeenCalled()
  })

  it('addSnagToVisitAction — rejected, no service write', async () => {
    const res = await addSnagToVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID, title: 'Test snag' })
    expect('error' in res).toBe(true)
    // The role gate fires before createServiceClient() is ever called
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('closeSnagOnVisitAction — rejected, no service write', async () => {
    const res = await closeSnagOnVisitAction(SNAG_ID, VISIT_ID, PROJECT_ID)
    expect('error' in res).toBe(true)
    // The role gate fires before createServiceClient() is ever called
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

describe('RBAC gate — null role (no project access)', () => {
  it('rejects createSnagVisitAction when effective role is null', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: null }))
    const res = await createSnagVisitAction({ projectId: PROJECT_ID, visitDate: '2026-06-04', attendees: [] })
    expect('error' in res).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-project guard (M1)
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-project guard (M1) — visit does not belong to project', () => {
  beforeEach(() => {
    // The visit exists in the DB but NOT under our PROJECT_ID
    createClientMock.mockResolvedValue(mockClient({ visitRow: null }))
    createServiceClientMock.mockReturnValue(mockServiceClient({ visitRow: null }))
  })

  it('updateSnagVisitAction — cross-project rejected', async () => {
    const res = await updateSnagVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID, title: 'X' })
    expect('error' in res).toBe(true)
    const { snagVisitService } = await import('@esite/shared')
    expect(snagVisitService.updateVisit).not.toHaveBeenCalled()
  })

  it('deleteSnagVisitAction — cross-project rejected', async () => {
    const res = await deleteSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect('error' in res).toBe(true)
    const { snagVisitService } = await import('@esite/shared')
    expect(snagVisitService.deleteVisit).not.toHaveBeenCalled()
  })

  it('addSnagToVisitAction — cross-project rejected, no service write', async () => {
    const res = await addSnagToVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID, title: 'Test snag' })
    expect('error' in res).toBe(true)
    // Visit guard fires before createServiceClient() is called
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('closeSnagOnVisitAction — cross-project rejected (visit not in project), no service write', async () => {
    const res = await closeSnagOnVisitAction(SNAG_ID, VISIT_ID, PROJECT_ID)
    expect('error' in res).toBe(true)
    // Visit guard fires before createServiceClient() is called
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-project snag guard (Fix 1) — visit is valid but snag belongs to a different project
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-project snag guard (Fix 1) — valid visit, snag from wrong project', () => {
  it('closeSnagOnVisitAction — rejected before any service write', async () => {
    // Visit is valid (visitRow present) but snag does not belong to this project
    createClientMock.mockResolvedValue(
      mockClient({ visitRow: { id: VISIT_ID }, snagRow: null }),
    )
    createServiceClientMock.mockReturnValue(mockServiceClient())

    const res = await closeSnagOnVisitAction(SNAG_ID, VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.stringContaining('not found or does not belong') })
    // Guard fires before createServiceClient() is ever called
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// addSnagToVisitAction
// ─────────────────────────────────────────────────────────────────────────────

describe('addSnagToVisitAction', () => {
  it('rejects a non-uuid visitId before any I/O', async () => {
    const res = await addSnagToVisitAction({ visitId: 'bad', projectId: PROJECT_ID, title: 'T' })
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects a title that is too short', async () => {
    const res = await addSnagToVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID, title: 'X' })
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('creates a snag with raised_on_visit_id set and returns snagId', async () => {
    const res = await addSnagToVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID, title: 'Cracked tile' })
    expect(res).toEqual({ snagId: SNAG_ID })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/snags`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// closeSnagOnVisitAction
// ─────────────────────────────────────────────────────────────────────────────

describe('closeSnagOnVisitAction — closeout photo guard', () => {
  it('rejects when no closeout photo exists', async () => {
    // photoRows defaults to [] in mockClient — no photos
    const res = await closeSnagOnVisitAction(SNAG_ID, VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.stringContaining('closeout photo is required') })
  })

  it('closes the snag when a closeout photo exists', async () => {
    // Override to return a closeout photo
    createClientMock.mockResolvedValue(
      mockClient({ photoRows: [{ id: 'photo-1' }] }),
    )
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const res = await closeSnagOnVisitAction(SNAG_ID, VISIT_ID, PROJECT_ID)
    expect(res).toEqual({})
    expect(revalidatePathMock).toHaveBeenCalledWith(`/snags/${SNAG_ID}`)
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/snags`)
  })

  it('rejects non-uuid params before any I/O', async () => {
    const res = await closeSnagOnVisitAction('bad', VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RBAC widening (2026-06-04) — contractors (and other non-read-only site roles)
// may RAISE and CLOSE snags on a visit, but NOT create/edit the visit or export
// the report (those stay ORG_WRITE_ROLES). Exercises the real requireEffectiveRole.
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC widening — contractor can raise + close snags on a visit', () => {
  beforeEach(() => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor', photoRows: [{ id: 'photo-1' }] }))
    createServiceClientMock.mockReturnValue(mockServiceClient())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('addSnagToVisitAction — contractor allowed', async () => {
    const res = await addSnagToVisitAction({ visitId: VISIT_ID, projectId: PROJECT_ID, title: 'Cracked tile' })
    expect(res).toEqual({ snagId: SNAG_ID })
  })

  it('closeSnagOnVisitAction — contractor allowed (closeout photo present)', async () => {
    const res = await closeSnagOnVisitAction(SNAG_ID, VISIT_ID, PROJECT_ID)
    expect(res).toEqual({})
  })
})

describe('RBAC widening boundary — contractor still cannot create a visit or export', () => {
  beforeEach(() => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    createServiceClientMock.mockReturnValue(mockExportServiceClient())
  })

  it('createSnagVisitAction — contractor rejected (ORG_WRITE_ROLES)', async () => {
    const res = await createSnagVisitAction({ projectId: PROJECT_ID, visitDate: '2026-06-04', attendees: [] })
    expect('error' in res).toBe(true)
    const { snagVisitService } = await import('@esite/shared')
    expect(snagVisitService.createVisit).not.toHaveBeenCalled()
  })

  it('exportSnagVisitReportAction — contractor rejected (ORG_WRITE_ROLES)', async () => {
    const res = await exportSnagVisitReportAction(VISIT_ID, PROJECT_ID)
    expect('error' in res).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// exportSnagVisitReportAction
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

/**
 * Service-role client mock for the export action.
 *
 * Handles four distinct DB/storage calls in order:
 *  1. schema('projects').from('reports')…maybeSingle() — prior-report lookup
 *  2. storage.from('reports').upload()
 *  3. schema('projects').from('reports').insert()…single() — new row
 *  4. schema('projects').from('reports').update()…eq() — supersede (optional)
 *
 * Also handles schema('field').from('snag_visits') for guardVisitBelongsToProject
 * (which uses the cookie client, not the service client, so it doesn't land here).
 */
function mockExportServiceClient(opts: {
  priorReport?: { id: string; version: number } | null
  uploadError?: string | null
  insertError?: string | null
} = {}) {
  const {
    priorReport = null,
    uploadError = null,
    insertError = null,
  } = opts

  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: priorReport, error: null }),
                  }),
                }),
              }),
              maybeSingle: () => Promise.resolve({ data: { id: VISIT_ID }, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: { id: VISIT_ID }, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () => insertError
              ? Promise.resolve({ data: null, error: { message: insertError } })
              : Promise.resolve({ data: { id: REPORT_ID }, error: null }),
          }),
        }),
        update: () => {
          const chain: any = {
            eq: () => chain,
            neq: () => Promise.resolve({ data: null, error: null }),
          }
          return chain
        },
      }),
    }),
    storage: {
      from: () => ({
        upload: () => uploadError
          ? Promise.resolve({ data: null, error: { message: uploadError } })
          : Promise.resolve({ data: { path: 'path' }, error: null }),
        remove: () => Promise.resolve({ data: null, error: null }),
      }),
    },
  }
}

describe('exportSnagVisitReportAction — validation', () => {
  it('rejects non-uuid visitId before any I/O', async () => {
    const res = await exportSnagVisitReportAction('bad-id', PROJECT_ID)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects non-uuid projectId before any I/O', async () => {
    const res = await exportSnagVisitReportAction(VISIT_ID, 'bad-id')
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('exportSnagVisitReportAction — RBAC gate', () => {
  it('rejects client_viewer before any service write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'client_viewer' }))
    createServiceClientMock.mockReturnValue(mockExportServiceClient())

    const res = await exportSnagVisitReportAction(VISIT_ID, PROJECT_ID)
    expect('error' in res).toBe(true)
    // The role gate fires before createServiceClient() is called for writes
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('rejects when no project access (null role)', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: null }))
    createServiceClientMock.mockReturnValue(mockExportServiceClient())

    const res = await exportSnagVisitReportAction(VISIT_ID, PROJECT_ID)
    expect('error' in res).toBe(true)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

describe('exportSnagVisitReportAction — cross-project guard', () => {
  it('rejects when visit does not belong to project', async () => {
    createClientMock.mockResolvedValue(mockClient({ visitRow: null }))
    createServiceClientMock.mockReturnValue(mockExportServiceClient())

    const res = await exportSnagVisitReportAction(VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.stringContaining('not found or does not belong') })
    // Service client is not called for writes when the guard fails
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

describe('exportSnagVisitReportAction — happy path (no prior report)', () => {
  it('inserts a reports row with kind=snag and returns reportId + storagePath', async () => {
    createServiceClientMock.mockReturnValue(mockExportServiceClient({ priorReport: null }))

    const res = await exportSnagVisitReportAction(VISIT_ID, PROJECT_ID)

    expect(res).toEqual({
      reportId: REPORT_ID,
      storagePath: expect.stringContaining(`snag-visit-${VISIT_ID}-v1.pdf`),
    })
    expect(gatherMock).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, VISIT_ID)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/snags/visits/${VISIT_ID}`)
  })
})

describe('exportSnagVisitReportAction — happy path (supersede prior)', () => {
  it('bumps version to 2 and supersedes the prior issued row', async () => {
    const PRIOR_REPORT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    createServiceClientMock.mockReturnValue(
      mockExportServiceClient({ priorReport: { id: PRIOR_REPORT_ID, version: 1 } }),
    )

    const res = await exportSnagVisitReportAction(VISIT_ID, PROJECT_ID)

    expect(res).toEqual({
      reportId: REPORT_ID,
      storagePath: expect.stringContaining(`snag-visit-${VISIT_ID}-v2.pdf`),
    })
  })
})

describe('exportSnagVisitReportAction — upload failure', () => {
  it('returns error when storage upload fails (no DB insert)', async () => {
    createServiceClientMock.mockReturnValue(
      mockExportServiceClient({ uploadError: 'bucket full' }),
    )

    const res = await exportSnagVisitReportAction(VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.stringContaining('Upload failed') })
  })
})
