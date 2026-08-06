import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so the mocks exist before the hoisted vi.mock() factories run.
const {
  getByIdMock,
  createClientMock,
  createServiceClientMock,
  revalidatePathMock,
  gatherMock,
  renderMock,
  notifyVisitCompletedMock,
  notifySnagCreatedMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  gatherMock: vi.fn(),
  renderMock: vi.fn(),
  notifyVisitCompletedMock: vi.fn(),
  notifySnagCreatedMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@/lib/reports/snag-visit-report-data', () => ({ gatherSnagVisitReportData: gatherMock }))
vi.mock('@/lib/reports/snag-visit-report', () => ({ renderSnagVisitReport: renderMock }))
vi.mock('@/lib/snag-email', () => ({
  notifySnagVisitCompleted: notifyVisitCompletedMock,
  notifySnagCreated: notifySnagCreatedMock,
  dispatchSnagStatusEmail: vi.fn(),
}))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    projectService: { ...actual.projectService, getById: getByIdMock },
    snagVisitService: {
      createVisit: vi.fn(),
      updateVisit: vi.fn(),
      deleteVisit: vi.fn(),
    },
  }
})

import {
  completeSnagVisitAction,
  reopenSnagVisitAction,
  addSnagToVisitAction,
} from './snag-visit.actions'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const VISIT_ID = '22222222-2222-2222-2222-222222222222'
const REPORT_ID = '44444444-4444-4444-4444-444444444444'
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

/**
 * Cookie client: auth + effective-role rpc + the guard reads.
 * `completedAt` drives isVisitOpen() (the per-snag email suppression switch).
 */
function mockClient(opts: {
  role?: string | null
  visitRow?: object | null
  completedAt?: string | null
} = {}) {
  const { role = 'owner', visitRow = { id: VISIT_ID }, completedAt = null } = opts

  const row = visitRow === null ? null : { ...visitRow, completed_at: completedAt }

  const builder = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
          limit: () => Promise.resolve({ data: [], error: null }),
          single: () => Promise.resolve({ data: row, error: null }),
        }),
      }),
    }),
  })

  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    schema: builder,
  }
}

/** Service client: report insert/supersede, storage upload, completion stamp. */
function mockServiceClient(opts: {
  uploadError?: string | null
  stampError?: string | null
} = {}) {
  const { uploadError = null, stampError = null } = opts

  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
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
            single: () => Promise.resolve({ data: { id: REPORT_ID }, error: null }),
          }),
        }),
        update: () => {
          // Terminal await lands on the second .eq() for the completion stamp,
          // and on .neq() for the supersede sweep.
          const err = stampError ? { message: stampError } : null
          const chain: any = {
            eq: () => chain,
            neq: () => Promise.resolve({ data: null, error: null }),
            then: (res: any) => res({ data: null, error: err }),
          }
          return chain
        },
      }),
    }),
    storage: {
      from: () => ({
        upload: () =>
          uploadError
            ? Promise.resolve({ data: null, error: { message: uploadError } })
            : Promise.resolve({ data: { path: 'p' }, error: null }),
        remove: () => Promise.resolve({ data: null, error: null }),
      }),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  createClientMock.mockResolvedValue(mockClient())
  createServiceClientMock.mockReturnValue(mockServiceClient())
  gatherMock.mockResolvedValue({
    branding: { accent: '#F59E0B', issuer: { wordmark: 'WM' }, kicker: 'K', projectLine: 'P' },
    visit: { id: VISIT_ID, visitNo: 3, isBacklog: false, visitDate: '2026-08-06' },
    projectName: 'KINGSWALK',
    newSnags: [],
    stillOpen: [],
    closedThisVisit: [],
  })
  renderMock.mockResolvedValue(Buffer.from('%PDF-1.4 mock'))
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

describe('completeSnagVisitAction — validation & RBAC', () => {
  it('rejects a non-uuid visitId before any I/O', async () => {
    const res = await completeSnagVisitAction('bad', PROJECT_ID)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects client_viewer before issuing anything', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'client_viewer' }))
    const res = await completeSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect('error' in res).toBe(true)
    expect(renderMock).not.toHaveBeenCalled()
    expect(notifyVisitCompletedMock).not.toHaveBeenCalled()
  })

  it('rejects a visit belonging to another project', async () => {
    createClientMock.mockResolvedValue(mockClient({ visitRow: null }))
    const res = await completeSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.stringContaining('not found or does not belong') })
    expect(notifyVisitCompletedMock).not.toHaveBeenCalled()
  })
})

describe('completeSnagVisitAction — happy path', () => {
  it('issues the report, stamps completion, and notifies the roster', async () => {
    const res = await completeSnagVisitAction(VISIT_ID, PROJECT_ID)

    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.reportId).toBe(REPORT_ID)
    expect(res.completedAt).toEqual(expect.any(String))

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(notifyVisitCompletedMock).toHaveBeenCalledWith({
      visitId: VISIT_ID,
      projectId: PROJECT_ID,
      completedById: USER_ID,
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/snags/visits/${VISIT_ID}`,
    )
  })
})

describe('completeSnagVisitAction — failure handling', () => {
  it('does not notify when the report fails to upload', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ uploadError: 'bucket full' }))
    const res = await completeSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.stringContaining('Upload failed') })
    expect(notifyVisitCompletedMock).not.toHaveBeenCalled()
  })

  it('does not announce a completion the DB did not record', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ stampError: 'column missing' }))
    const res = await completeSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect(res).toEqual({ error: expect.stringContaining('could not be marked complete') })
    expect(notifyVisitCompletedMock).not.toHaveBeenCalled()
  })
})

describe('reopenSnagVisitAction', () => {
  it('rejects a non-uuid visitId before any I/O', async () => {
    const res = await reopenSnagVisitAction('bad', PROJECT_ID)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects client_viewer', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'client_viewer' }))
    const res = await reopenSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect(res.error).toEqual(expect.any(String))
  })

  it('clears the stamps and revalidates', async () => {
    const res = await reopenSnagVisitAction(VISIT_ID, PROJECT_ID)
    expect(res).toEqual({})
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/snags/visits/${VISIT_ID}`,
    )
  })
})

describe('per-snag email suppression during an open visit', () => {
  it('suppresses the individual email while the visit is still in progress', async () => {
    createClientMock.mockResolvedValue(mockClient({ completedAt: null }))

    await addSnagToVisitAction({
      visitId: VISIT_ID,
      projectId: PROJECT_ID,
      title: 'Cracked tile',
    })

    expect(notifySnagCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ suppressEmail: true }),
    )
  })

  it('emails immediately once the visit is completed', async () => {
    createClientMock.mockResolvedValue(
      mockClient({ completedAt: '2026-08-06T10:00:00Z' }),
    )

    await addSnagToVisitAction({
      visitId: VISIT_ID,
      projectId: PROJECT_ID,
      title: 'Late addition',
    })

    expect(notifySnagCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ suppressEmail: false }),
    )
  })
})
