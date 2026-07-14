import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures mocks are initialised before hoisted vi.mock() factories
// — same pattern as snag-visit.actions.test.ts. requireEffectiveRole stays
// REAL: the gate is exercised against a mocked rpc, never mocked itself.
const {
  getByIdMock,
  createClientMock,
  createServiceClientMock,
  revalidatePathMock,
  gatherMock,
  renderMock,
  notifyQcIssuedMock,
  resolveRecipientsMock,
  dispatchNotificationMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  gatherMock: vi.fn(),
  renderMock: vi.fn(),
  notifyQcIssuedMock: vi.fn(),
  resolveRecipientsMock: vi.fn(),
  dispatchNotificationMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@/lib/reports/qc-report-data', () => ({ gatherQcReportData: gatherMock }))
vi.mock('@/lib/reports/qc-report', () => ({ renderQcReport: renderMock }))
vi.mock('@/lib/qc-email', () => ({ notifyQcIssued: notifyQcIssuedMock }))
vi.mock('@/lib/recipients', () => ({ resolveProjectRecipients: resolveRecipientsMock }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: dispatchNotificationMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    projectService: { ...actual.projectService, getById: getByIdMock },
    qcService: {
      create: vi.fn(),
      update: vi.fn(),
      addEntry: vi.fn(),
      addComment: vi.fn(),
    },
  }
})

import {
  createQcReportAction,
  updateQcReportAction,
  deleteQcReportAction,
  closeQcReportAction,
  reopenQcReportAction,
  addQcEntryAction,
  addQcCommentAction,
  deleteQcEntryAction,
  deleteQcPhotoAction,
  deleteQcCommentAction,
  issueQcReportAction,
} from './qc.actions'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const REPORT_ID  = '22222222-2222-2222-2222-222222222222'
const ENTRY_ID   = '33333333-3333-3333-3333-333333333333'
const PHOTO_ID   = '44444444-4444-4444-4444-444444444444'
const COMMENT_ID = '55555555-5555-5555-5555-555555555555'
const ORG_ID     = '99999999-9999-9999-9999-999999999999'
const USER_ID    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER_USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const REPORT_ROW = {
  id: REPORT_ID,
  project_id: PROJECT_ID,
  organisation_id: ORG_ID,
  report_no: 4,
  title: 'Week 12 QC walk',
  status: 'draft',
}
const ENTRY_ROW = {
  id: ENTRY_ID,
  report_id: REPORT_ID,
  project_id: PROJECT_ID,
  created_by: OTHER_USER,
}
const PHOTO_ROW = {
  id: PHOTO_ID,
  entry_id: ENTRY_ID,
  project_id: PROJECT_ID,
  file_path: `${ORG_ID}/${PROJECT_ID}/${REPORT_ID}/${ENTRY_ID}/1.jpg`,
  uploaded_by: OTHER_USER,
}
const COMMENT_ROW = {
  id: COMMENT_ID,
  entry_id: ENTRY_ID,
  report_id: REPORT_ID,
  created_by: OTHER_USER,
}

/**
 * Cookie-client mock.
 *
 * auth.getUser — returns a user (or none).
 * rpc          — the effective project role (consumed by the REAL requireEffectiveRole).
 * schema       — RLS gate reads, keyed by table; update chain for close.
 */
function mockClient(opts: {
  noUser?: boolean
  role?: string | null
  rpcError?: boolean
  reportRow?: object | null
  entryRow?: object | null
  photoRow?: object | null
  commentRow?: object | null
} = {}) {
  const { noUser = false, role = 'owner', rpcError = false } = opts
  const rows: Record<string, unknown> = {
    qc_reports: 'reportRow' in opts ? opts.reportRow : REPORT_ROW,
    qc_entries: 'entryRow' in opts ? opts.entryRow : ENTRY_ROW,
    qc_entry_photos: 'photoRow' in opts ? opts.photoRow : PHOTO_ROW,
    qc_comments: 'commentRow' in opts ? opts.commentRow : COMMENT_ROW,
  }

  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: noUser ? null : { id: USER_ID } } }),
    },
    rpc: () => rpcError
      ? Promise.resolve({ data: null, error: { message: 'rpc exploded' } })
      : Promise.resolve({ data: role, error: null }),
    schema: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }
}

/**
 * Service-role client mock (RLS-bypassing writes).
 *
 * Handles every service call across the delete + issue + close/reopen
 * actions: table reads settle to list rows, deletes/updates settle to
 * { error: null }, the projects.reports prior-version lookup walks
 * eq→eq→eq→order→limit→maybeSingle, the row-verified status flips walk
 * update→eq→eq→select→maybeSingle, and storage records upload/remove calls
 * per bucket. Every insert/update payload is captured in `writes` so tests
 * can assert the actual DB effects, not just that the action returned {}.
 */
function mockServiceClient(opts: {
  priorReport?: { id: string; version: number } | null
  uploadError?: string | null
  insertError?: string | null
  /** Simulate a 0-row status flip: update…select().maybeSingle() → null. */
  updateRowMissing?: boolean
  listRows?: Record<string, object[]>
} = {}) {
  const {
    priorReport = null,
    uploadError = null,
    insertError = null,
    updateRowMissing = false,
    listRows = {},
  } = opts

  const writes: Array<{ table: string; op: 'insert' | 'update' | 'delete'; payload?: any }> = []

  const upload = vi.fn(() => uploadError
    ? Promise.resolve({ data: null, error: { message: uploadError } })
    : Promise.resolve({ data: { path: 'path' }, error: null }))
  const remove = vi.fn(() => Promise.resolve({ data: null, error: null }))
  const storageFrom = vi.fn(() => ({ upload, remove }))

  const listResult = (table: string) =>
    Promise.resolve({ data: listRows[table] ?? [], error: null })

  return {
    client: {
      schema: () => ({
        from: (table: string) => ({
          select: () => {
            // Thenable chain: .eq()/.in() settle to list rows; the
            // prior-report lookup keeps chaining to maybeSingle.
            const chain: any = {
              eq: () => chain,
              in: () => listResult(table),
              order: () => chain,
              limit: () => chain,
              maybeSingle: () => Promise.resolve({ data: priorReport, error: null }),
              then: (onF: any, onR: any) => listResult(table).then(onF, onR),
            }
            return chain
          },
          insert: (payload: any) => {
            writes.push({ table, op: 'insert', payload })
            return {
              select: () => ({
                single: () => insertError
                  ? Promise.resolve({ data: null, error: { message: insertError } })
                  : Promise.resolve({ data: { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }, error: null }),
              }),
            }
          },
          update: (payload: any) => {
            writes.push({ table, op: 'update', payload })
            const chain: any = {
              eq: () => chain,
              neq: () => Promise.resolve({ data: null, error: null }),
              // Row-verified flips (close/reopen) select the updated row back.
              select: () => ({
                maybeSingle: () => Promise.resolve({
                  data: updateRowMissing ? null : { id: REPORT_ID },
                  error: null,
                }),
              }),
              then: (onF: any, onR: any) => Promise.resolve({ data: null, error: null }).then(onF, onR),
            }
            return chain
          },
          delete: () => {
            writes.push({ table, op: 'delete' })
            const chain: any = {
              eq: () => chain,
              then: (onF: any, onR: any) => Promise.resolve({ data: null, error: null }).then(onF, onR),
            }
            return chain
          },
        }),
      }),
      storage: { from: storageFrom },
    },
    upload,
    remove,
    storageFrom,
    writes,
  }
}

beforeEach(async () => {
  createClientMock.mockReset()
  createServiceClientMock.mockReset()
  revalidatePathMock.mockReset()
  getByIdMock.mockReset()
  gatherMock.mockReset()
  renderMock.mockReset()
  notifyQcIssuedMock.mockReset()
  resolveRecipientsMock.mockReset()
  dispatchNotificationMock.mockReset()

  const { qcService } = await import('@esite/shared')
  for (const fn of Object.values(qcService) as ReturnType<typeof vi.fn>[]) {
    fn.mockReset()
  }
  ;(qcService.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: REPORT_ID, report_no: 4 })
  ;(qcService.update as ReturnType<typeof vi.fn>).mockResolvedValue(REPORT_ROW)
  ;(qcService.addEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ id: ENTRY_ID })
  ;(qcService.addComment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: COMMENT_ID, report_id: REPORT_ID })

  getByIdMock.mockResolvedValue({ organisation_id: ORG_ID })
  createClientMock.mockResolvedValue(mockClient())
  createServiceClientMock.mockReturnValue(mockServiceClient().client)

  resolveRecipientsMock.mockResolvedValue({ userIds: [OTHER_USER], emails: [], recipients: [] })
  dispatchNotificationMock.mockResolvedValue(undefined)
  notifyQcIssuedMock.mockResolvedValue(undefined)

  gatherMock.mockResolvedValue({
    branding: { accent: '#F59E0B', issuer: { wordmark: 'WM Consulting' }, kicker: 'QUALITY CONTROL REPORT', projectLine: 'Test Project' },
    report: { id: REPORT_ID, reportNo: 4, title: 'Week 12 QC walk', description: null, location: null, inspectionDate: null, status: 'draft', raisedByName: null, issuedAt: null, issuedByName: null },
    projectName: 'Test Project',
    entries: [],
  })
  renderMock.mockResolvedValue(Buffer.from('%PDF-1.4 mock'))
})

const VALID_CREATE = { projectId: PROJECT_ID, title: 'Week 12 QC walk' }

// ─────────────────────────────────────────────────────────────────────────────
// createQcReportAction
// ─────────────────────────────────────────────────────────────────────────────

describe('createQcReportAction — validation + auth', () => {
  it('rejects a non-uuid projectId before any I/O', async () => {
    const res = await createQcReportAction({ projectId: 'bad', title: 'T' } as never)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller before any write', async () => {
    createClientMock.mockResolvedValue(mockClient({ noUser: true }))
    const res = await createQcReportAction(VALID_CREATE)
    expect(res).toEqual({ error: 'Not authenticated' })
    const { qcService } = await import('@esite/shared')
    expect(qcService.create).not.toHaveBeenCalled()
  })
})

describe('createQcReportAction — RBAC gate (QC_WRITE_ROLES)', () => {
  it.each(['client_viewer', 'inspector', 'supplier'])(
    '%s is rejected before any write',
    async (role) => {
      createClientMock.mockResolvedValue(mockClient({ role }))
      const res = await createQcReportAction(VALID_CREATE)
      expect('error' in res && res.error).toBeTruthy()
      const { qcService } = await import('@esite/shared')
      expect(qcService.create).not.toHaveBeenCalled()
      expect(dispatchNotificationMock).not.toHaveBeenCalled()
    },
  )

  it('contractor is allowed (QC capture is contractor-led)', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const res = await createQcReportAction(VALID_CREATE)
    expect(res).toEqual({ reportId: REPORT_ID })
  })

  it('fails closed when the role RPC errors', async () => {
    createClientMock.mockResolvedValue(mockClient({ rpcError: true }))
    const res = await createQcReportAction(VALID_CREATE)
    expect('error' in res && res.error).toBeTruthy()
    const { qcService } = await import('@esite/shared')
    expect(qcService.create).not.toHaveBeenCalled()
  })
})

describe('createQcReportAction — happy path', () => {
  it('creates the report WITHOUT notifying anyone — drafts are private working state', async () => {
    const res = await createQcReportAction(VALID_CREATE)
    expect(res).toEqual({ reportId: REPORT_ID })
    // Regression pin: the create-time roster bell leaked draft titles to
    // client viewers. The notify moment is issue (notifyQcIssued), never create.
    expect(resolveRecipientsMock).not.toHaveBeenCalled()
    expect(dispatchNotificationMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/quality-control`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateQcReportAction
// ─────────────────────────────────────────────────────────────────────────────

describe('updateQcReportAction', () => {
  it('client_viewer is rejected before any write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'client_viewer' }))
    const res = await updateQcReportAction({ reportId: REPORT_ID, title: 'New title' })
    expect('error' in res && res.error).toBeTruthy()
    const { qcService } = await import('@esite/shared')
    expect(qcService.update).not.toHaveBeenCalled()
  })

  it('contractor may edit a draft', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const res = await updateQcReportAction({ reportId: REPORT_ID, title: 'New title' })
    expect(res).toEqual({})
  })

  it('blocks edits when the report is closed', async () => {
    createClientMock.mockResolvedValue(mockClient({ reportRow: { ...REPORT_ROW, status: 'closed' } }))
    const res = await updateQcReportAction({ reportId: REPORT_ID, title: 'New title' })
    expect(res).toEqual({ error: expect.stringContaining('closed') })
    const { qcService } = await import('@esite/shared')
    expect(qcService.update).not.toHaveBeenCalled()
  })

  it('returns not-found when the report is invisible under RLS', async () => {
    createClientMock.mockResolvedValue(mockClient({ reportRow: null }))
    const res = await updateQcReportAction({ reportId: REPORT_ID, title: 'New title' })
    expect(res).toEqual({ error: 'Report not found' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// addQcEntryAction / addQcCommentAction — QC_WRITE_ROLES
// ─────────────────────────────────────────────────────────────────────────────

describe('addQcEntryAction — RBAC gate', () => {
  it.each(['client_viewer', 'inspector'])('%s is rejected before any write', async (role) => {
    createClientMock.mockResolvedValue(mockClient({ role }))
    const res = await addQcEntryAction({ reportId: REPORT_ID, title: 'DB wiring' })
    expect('error' in res && res.error).toBeTruthy()
    const { qcService } = await import('@esite/shared')
    expect(qcService.addEntry).not.toHaveBeenCalled()
  })

  it('contractor is allowed and gets the new entryId', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const res = await addQcEntryAction({ reportId: REPORT_ID, title: 'DB wiring' })
    expect(res).toEqual({ entryId: ENTRY_ID })
    const { qcService } = await import('@esite/shared')
    expect(qcService.addEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organisationId: ORG_ID, projectId: PROJECT_ID }),
      USER_ID,
    )
  })

  it('returns not-found for a report invisible under RLS', async () => {
    createClientMock.mockResolvedValue(mockClient({ reportRow: null }))
    const res = await addQcEntryAction({ reportId: REPORT_ID, title: 'DB wiring' })
    expect(res).toEqual({ error: 'Report not found' })
  })
})

describe('addQcCommentAction — RBAC gate', () => {
  it.each(['client_viewer', 'inspector'])('%s is rejected before any write', async (role) => {
    createClientMock.mockResolvedValue(mockClient({ role }))
    const res = await addQcCommentAction({ entryId: ENTRY_ID, body: 'Looks good' })
    expect('error' in res && res.error).toBeTruthy()
    const { qcService } = await import('@esite/shared')
    expect(qcService.addComment).not.toHaveBeenCalled()
  })

  it('contractor is allowed', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const res = await addQcCommentAction({ entryId: ENTRY_ID, body: 'Looks good' })
    expect(res).toEqual({ commentId: COMMENT_ID })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// deleteQcReportAction / closeQcReportAction — ORG_WRITE_ROLES
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteQcReportAction — RBAC gate (ORG_WRITE_ROLES)', () => {
  it.each(['contractor', 'client_viewer', 'inspector'])(
    '%s is rejected before any service write',
    async (role) => {
      createClientMock.mockResolvedValue(mockClient({ role }))
      const res = await deleteQcReportAction(REPORT_ID)
      expect('error' in res && res.error).toBeTruthy()
      expect(createServiceClientMock).not.toHaveBeenCalled()
    },
  )

  it('project_manager may delete; storage cleanup is best-effort', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager' }))
    const service = mockServiceClient({
      listRows: {
        qc_entries: [{ id: ENTRY_ID }],
        qc_entry_photos: [{ file_path: PHOTO_ROW.file_path }],
        reports: [{ storage_path: `${ORG_ID}/${PROJECT_ID}/qc-report-${REPORT_ID}-v1.pdf` }],
      },
    })
    createServiceClientMock.mockReturnValue(service.client)

    const res = await deleteQcReportAction(REPORT_ID)
    expect(res).toEqual({})
    expect(service.storageFrom).toHaveBeenCalledWith('qc-report-entries')
    expect(service.storageFrom).toHaveBeenCalledWith('qc-reports')
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/quality-control`)
  })
})

describe('closeQcReportAction — RBAC gate (ORG_WRITE_ROLES)', () => {
  const ISSUED_ROW = { ...REPORT_ROW, status: 'issued' }

  it('contractor is rejected before any service write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor', reportRow: ISSUED_ROW }))
    const res = await closeQcReportAction(REPORT_ID)
    expect('error' in res && res.error).toBeTruthy()
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('project_manager may close an issued report — service-client flip, payload asserted', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', reportRow: ISSUED_ROW }))
    const service = mockServiceClient()
    createServiceClientMock.mockReturnValue(service.client)

    const res = await closeQcReportAction(REPORT_ID)
    expect(res).toEqual({})
    expect(service.writes).toContainEqual(
      expect.objectContaining({ table: 'qc_reports', op: 'update', payload: { status: 'closed' } }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/quality-control/${REPORT_ID}`)
  })

  it('refuses to close a draft — only issued reports can be closed', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager' })) // status: draft
    const res = await closeQcReportAction(REPORT_ID)
    expect(res).toEqual({ error: expect.stringContaining('issued') })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('errors out loud when the flip touches no row (never a silent no-op)', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', reportRow: ISSUED_ROW }))
    const service = mockServiceClient({ updateRowMissing: true })
    createServiceClientMock.mockReturnValue(service.client)

    const res = await closeQcReportAction(REPORT_ID)
    expect(res).toEqual({ error: expect.stringContaining('not updated') })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('reopenQcReportAction — RBAC gate (ORG_WRITE_ROLES) + closed-to-issued only', () => {
  const CLOSED_ROW = { ...REPORT_ROW, status: 'closed' }

  it('contractor is rejected before any service write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor', reportRow: CLOSED_ROW }))
    const res = await reopenQcReportAction(REPORT_ID)
    expect('error' in res && res.error).toBeTruthy()
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('project_manager may reopen a closed report — service-client flip back to issued', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', reportRow: CLOSED_ROW }))
    const service = mockServiceClient()
    createServiceClientMock.mockReturnValue(service.client)

    const res = await reopenQcReportAction(REPORT_ID)
    expect(res).toEqual({})
    expect(service.writes).toContainEqual(
      expect.objectContaining({ table: 'qc_reports', op: 'update', payload: { status: 'issued' } }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/quality-control/${REPORT_ID}`)
  })

  it.each(['draft', 'issued'])('refuses to reopen a %s report', async (status) => {
    createClientMock.mockResolvedValue(
      mockClient({ role: 'project_manager', reportRow: { ...REPORT_ROW, status } }),
    )
    const res = await reopenQcReportAction(REPORT_ID)
    expect(res).toEqual({ error: expect.stringContaining('closed') })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('errors out loud when the flip touches no row', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', reportRow: CLOSED_ROW }))
    const service = mockServiceClient({ updateRowMissing: true })
    createServiceClientMock.mockReturnValue(service.client)

    const res = await reopenQcReportAction(REPORT_ID)
    expect(res).toEqual({ error: expect.stringContaining('not updated') })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Author-or-manager deletes (diary delete pattern)
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteQcEntryAction — author-or-manager gate', () => {
  it('the author may delete their own entry regardless of role', async () => {
    createClientMock.mockResolvedValue(
      mockClient({ role: 'contractor', entryRow: { ...ENTRY_ROW, created_by: USER_ID } }),
    )
    const res = await deleteQcEntryAction(ENTRY_ID)
    expect(res).toEqual({})
    expect(createServiceClientMock).toHaveBeenCalled()
  })

  it('a non-author contractor is rejected before any service write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const res = await deleteQcEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: expect.stringContaining('permission') })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('a non-author project_manager may delete', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager' }))
    const res = await deleteQcEntryAction(ENTRY_ID)
    expect(res).toEqual({})
  })
})

describe('deleteQcPhotoAction — author-or-manager gate', () => {
  it('a non-author contractor is rejected before any service write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const res = await deleteQcPhotoAction(PHOTO_ID)
    expect(res).toEqual({ error: expect.stringContaining('permission') })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('the uploader may delete their own photo; the blob is removed too', async () => {
    createClientMock.mockResolvedValue(
      mockClient({ role: 'contractor', photoRow: { ...PHOTO_ROW, uploaded_by: USER_ID } }),
    )
    const service = mockServiceClient()
    createServiceClientMock.mockReturnValue(service.client)

    const res = await deleteQcPhotoAction(PHOTO_ID)
    expect(res).toEqual({})
    expect(service.remove).toHaveBeenCalledWith([PHOTO_ROW.file_path])
  })
})

describe('deleteQcCommentAction — author-or-manager gate', () => {
  it('a non-author contractor is rejected before any service write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const res = await deleteQcCommentAction(COMMENT_ID)
    expect(res).toEqual({ error: expect.stringContaining('permission') })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('the author may delete their own comment', async () => {
    createClientMock.mockResolvedValue(
      mockClient({ role: 'contractor', commentRow: { ...COMMENT_ROW, created_by: USER_ID } }),
    )
    const res = await deleteQcCommentAction(COMMENT_ID)
    expect(res).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Closed-report freeze — every content mutation refuses status='closed'
// server-side (the UI hides the affordances, but stale tabs / direct POSTs
// reach the actions; the reopen path is the only way out of closed)
// ─────────────────────────────────────────────────────────────────────────────

describe('closed-report freeze (server-side)', () => {
  const CLOSED_ROW = { ...REPORT_ROW, status: 'closed' }

  it('issueQcReportAction refuses — closed is never silently re-issued', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', reportRow: CLOSED_ROW }))
    const res = await issueQcReportAction(REPORT_ID)
    expect(res).toEqual({ error: expect.stringContaining('reopen') })
    expect(gatherMock).not.toHaveBeenCalled()
    expect(createServiceClientMock).not.toHaveBeenCalled()
    expect(notifyQcIssuedMock).not.toHaveBeenCalled()
  })

  it('addQcEntryAction refuses', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', reportRow: CLOSED_ROW }))
    const res = await addQcEntryAction({ reportId: REPORT_ID, title: 'DB wiring' })
    expect(res).toEqual({ error: expect.stringContaining('closed') })
    const { qcService } = await import('@esite/shared')
    expect(qcService.addEntry).not.toHaveBeenCalled()
  })

  it('addQcCommentAction refuses', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', reportRow: CLOSED_ROW }))
    const res = await addQcCommentAction({ entryId: ENTRY_ID, body: 'Looks good' })
    expect(res).toEqual({ error: expect.stringContaining('closed') })
    const { qcService } = await import('@esite/shared')
    expect(qcService.addComment).not.toHaveBeenCalled()
  })

  it('deleteQcEntryAction refuses — even for the author', async () => {
    createClientMock.mockResolvedValue(mockClient({
      role: 'contractor',
      reportRow: CLOSED_ROW,
      entryRow: { ...ENTRY_ROW, created_by: USER_ID },
    }))
    const res = await deleteQcEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: expect.stringContaining('closed') })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('deleteQcPhotoAction refuses — even for the uploader', async () => {
    createClientMock.mockResolvedValue(mockClient({
      role: 'contractor',
      reportRow: CLOSED_ROW,
      photoRow: { ...PHOTO_ROW, uploaded_by: USER_ID },
    }))
    const res = await deleteQcPhotoAction(PHOTO_ID)
    expect(res).toEqual({ error: expect.stringContaining('closed') })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('deleteQcCommentAction refuses — even for the author', async () => {
    createClientMock.mockResolvedValue(mockClient({
      role: 'contractor',
      reportRow: CLOSED_ROW,
      commentRow: { ...COMMENT_ROW, created_by: USER_ID },
    }))
    const res = await deleteQcCommentAction(COMMENT_ID)
    expect(res).toEqual({ error: expect.stringContaining('closed') })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// issueQcReportAction — ORG_WRITE_ROLES + export shape
// ─────────────────────────────────────────────────────────────────────────────

describe('issueQcReportAction — validation + RBAC gate', () => {
  it('rejects a non-uuid reportId before any I/O', async () => {
    const res = await issueQcReportAction('bad-id')
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it.each(['contractor', 'client_viewer', 'inspector'])(
    '%s is rejected before gather or any service write (ORG_WRITE_ROLES)',
    async (role) => {
      createClientMock.mockResolvedValue(mockClient({ role }))
      const res = await issueQcReportAction(REPORT_ID)
      expect('error' in res && res.error).toBeTruthy()
      expect(gatherMock).not.toHaveBeenCalled()
      expect(createServiceClientMock).not.toHaveBeenCalled()
      expect(notifyQcIssuedMock).not.toHaveBeenCalled()
    },
  )

  it('fails closed when the role RPC errors', async () => {
    createClientMock.mockResolvedValue(mockClient({ rpcError: true }))
    const res = await issueQcReportAction(REPORT_ID)
    expect('error' in res && res.error).toBeTruthy()
    expect(gatherMock).not.toHaveBeenCalled()
  })

  it('returns not-found when the report is invisible under RLS (draft vs client_viewer)', async () => {
    createClientMock.mockResolvedValue(mockClient({ reportRow: null }))
    const res = await issueQcReportAction(REPORT_ID)
    expect(res).toEqual({ error: 'Report not found' })
  })
})

describe('issueQcReportAction — happy path (no prior report)', () => {
  it('uploads v1 to qc-reports, inserts the reports row, flips status, notifies', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager' }))
    const service = mockServiceClient({ priorReport: null })
    createServiceClientMock.mockReturnValue(service.client)

    const res = await issueQcReportAction(REPORT_ID)

    expect(res).toEqual({ version: 1 })
    expect(gatherMock).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, REPORT_ID)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(service.storageFrom).toHaveBeenCalledWith('qc-reports')
    expect(service.upload).toHaveBeenCalledWith(
      `${ORG_ID}/${PROJECT_ID}/qc-report-${REPORT_ID}-v1.pdf`,
      expect.anything(),
      { contentType: 'application/pdf', upsert: false },
    )
    // The projects.reports row is what downloads/portal key off — pin the
    // routing-critical columns (kind drives bucketForKind; source_* drive the
    // supersede lookup; version drives "latest").
    expect(service.writes).toContainEqual(
      expect.objectContaining({
        table: 'reports',
        op: 'insert',
        payload: expect.objectContaining({
          organisation_id: ORG_ID,
          project_id: PROJECT_ID,
          kind: 'qc',
          source_table: 'qc_reports',
          source_id: REPORT_ID,
          status: 'issued',
          version: 1,
          storage_path: `${ORG_ID}/${PROJECT_ID}/qc-report-${REPORT_ID}-v1.pdf`,
          generated_by: USER_ID,
        }),
      }),
    )
    // The status flip is what makes the report visible to client viewers at
    // all (00172 issued-only RLS) — assert the actual payload, not just {}.
    expect(service.writes).toContainEqual(
      expect.objectContaining({
        table: 'qc_reports',
        op: 'update',
        payload: expect.objectContaining({
          status: 'issued',
          issued_by: USER_ID,
          issued_at: expect.any(String),
        }),
      }),
    )
    expect(notifyQcIssuedMock).toHaveBeenCalledWith({
      reportId: REPORT_ID,
      projectId: PROJECT_ID,
      actorId: USER_ID,
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/quality-control/${REPORT_ID}`)
  })
})

describe('issueQcReportAction — re-issue (supersede prior)', () => {
  it('bumps the version past the prior issued row', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'owner' }))
    const service = mockServiceClient({
      priorReport: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', version: 3 },
    })
    createServiceClientMock.mockReturnValue(service.client)

    const res = await issueQcReportAction(REPORT_ID)

    expect(res).toEqual({ version: 4 })
    expect(service.upload).toHaveBeenCalledWith(
      expect.stringContaining(`qc-report-${REPORT_ID}-v4.pdf`),
      expect.anything(),
      expect.anything(),
    )
    expect(service.writes).toContainEqual(
      expect.objectContaining({
        table: 'reports',
        op: 'insert',
        payload: expect.objectContaining({ kind: 'qc', version: 4 }),
      }),
    )
    // Prior issued rows must be superseded and pointed at the new row.
    expect(service.writes).toContainEqual(
      expect.objectContaining({
        table: 'reports',
        op: 'update',
        payload: {
          status: 'superseded',
          superseded_by: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        },
      }),
    )
  })
})

describe('issueQcReportAction — failure paths', () => {
  it('returns error on upload failure (no DB insert, no notify)', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager' }))
    const service = mockServiceClient({ uploadError: 'bucket full' })
    createServiceClientMock.mockReturnValue(service.client)

    const res = await issueQcReportAction(REPORT_ID)
    expect(res).toEqual({ error: expect.stringContaining('Upload failed') })
    expect(notifyQcIssuedMock).not.toHaveBeenCalled()
  })

  it('rolls the storage upload back when the reports-row insert fails', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager' }))
    const service = mockServiceClient({ insertError: 'row rejected' })
    createServiceClientMock.mockReturnValue(service.client)

    const res = await issueQcReportAction(REPORT_ID)
    expect(res).toEqual({ error: expect.stringContaining('Failed to save report record') })
    expect(service.remove).toHaveBeenCalledWith([
      `${ORG_ID}/${PROJECT_ID}/qc-report-${REPORT_ID}-v1.pdf`,
    ])
    expect(notifyQcIssuedMock).not.toHaveBeenCalled()
  })
})
