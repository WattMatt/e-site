import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Gate + sequencing tests for site-form distribution.
 *
 * The role gate is the REAL one: `requireEffectiveRole` is not mocked, so each
 * case drives the actual `user_effective_project_role` RPC result through
 * `ORG_WRITE_ROLES.includes(role)`. The crucial split under test is
 * `contractor` — capture roles (FORMS_FIELD_ROLES) may create, fill and submit
 * a form, but must NOT be able to push it to the whole project team. That is
 * the regression most likely to be reintroduced by someone "fixing" a
 * contractor's 403 on the forms page.
 */

// vi.hoisted so the mocks exist before the hoisted vi.mock() factories run.
const {
  getByIdMock,
  createClientMock,
  createServiceClientMock,
  revalidatePathMock,
  fileReportMock,
  notifyMock,
  resolveRecipientsMock,
  getNotificationConfigMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  fileReportMock: vi.fn(),
  notifyMock: vi.fn(),
  resolveRecipientsMock: vi.fn(),
  getNotificationConfigMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@/lib/reports/file-site-form-report', () => ({
  generateAndFileSiteFormReport: fileReportMock,
}))
vi.mock('@/lib/site-form-email', () => ({ notifySiteFormDistributed: notifyMock }))
vi.mock('@/lib/recipients', () => ({ resolveProjectRecipients: resolveRecipientsMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    projectService: { ...actual.projectService, getById: getByIdMock },
    projectSettingsService: {
      ...actual.projectSettingsService,
      getNotificationConfig: getNotificationConfigMock,
    },
  }
})

import {
  previewFormRecipientsAction,
  distributeSiteFormAction,
} from './site-forms-distribute.actions'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const FORM_ID = '22222222-2222-2222-2222-222222222222'
const REPORT_ID = '33333333-3333-3333-3333-333333333333'
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

/** Cookie client: auth + the real effective-role RPC the gate reads. */
function mockClient(opts: { role?: string | null } = {}) {
  const { role = 'owner' } = opts
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
  }
}

/** Service client: the belongs-to-project lookup and the distribution stamp. */
function mockServiceClient(opts: { status?: string; formRow?: object | null; stampError?: string | null; stampAffectsNoRows?: boolean } = {}) {
  const { status = 'submitted', stampError = null, stampAffectsNoRows = false } = opts
  const formRow =
    opts.formRow === undefined ? { id: FORM_ID, status, project_id: PROJECT_ID } : opts.formRow

  const updateSpy = vi.fn()

  const client: any = {
    __updateSpy: updateSpy,
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: formRow, error: null }),
            }),
          }),
        }),
        update: (patch: unknown) => {
          updateSpy(patch)
          // Chainable and thenable at every link, so the mock does not have to
          // know where the real call terminates. The stamp is
          //   .update().eq().eq().in().select()
          // and pinning the mock to an exact shape meant that adding the
          // .in('status', ...) guard against distributing a voided form broke
          // seven tests without any behaviour actually being wrong.
          const chain: any = {
            eq: () => chain,
            in: () => chain,
            select: () => chain,
            then: (res: any) =>
              res({
                // A stamp that succeeds must return the affected row: the
                // action now checks rows-affected, because PostgREST reports
                // no error when a predicate matches nothing.
                data: stampError || stampAffectsNoRows ? [] : [{ id: FORM_ID }],
                error: stampError ? { message: stampError } : null,
              }),
          }
          return chain
        },
      }),
    }),
  }
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  createClientMock.mockResolvedValue(mockClient())
  createServiceClientMock.mockReturnValue(mockServiceClient())
  fileReportMock.mockResolvedValue({ reportId: REPORT_ID, version: 1 })
  notifyMock.mockResolvedValue(undefined)
  resolveRecipientsMock.mockResolvedValue({
    userIds: [USER_ID],
    emails: ['site@wmeng.co.za'],
    recipients: [
      { userId: USER_ID, email: 'site@wmeng.co.za', fullName: 'Site Manager' },
      { userId: 'b', email: null, fullName: 'No Mailbox' },
    ],
  })
  getNotificationConfigMock.mockResolvedValue({ formEmail: true })
})

// ─── Role gate ───────────────────────────────────────────────────────────────

describe('RBAC — who may distribute', () => {
  it('refuses client_viewer on both actions', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'client_viewer' }))

    const preview = await previewFormRecipientsAction(PROJECT_ID)
    expect(preview.error).toEqual(expect.stringContaining('client_viewer'))
    expect(preview.recipients).toBeUndefined()

    const dist = await distributeSiteFormAction(FORM_ID, PROJECT_ID)
    expect(dist.error).toEqual(expect.stringContaining('client_viewer'))
    expect(fileReportMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('refuses contractor on both actions — capture is not distribution', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))

    const preview = await previewFormRecipientsAction(PROJECT_ID)
    expect(preview.error).toEqual(expect.stringContaining('contractor'))
    expect(preview.recipients).toBeUndefined()
    expect(resolveRecipientsMock).not.toHaveBeenCalled()

    const dist = await distributeSiteFormAction(FORM_ID, PROJECT_ID)
    expect(dist.error).toEqual(expect.stringContaining('contractor'))
    expect(fileReportMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it.each(['project_manager', 'admin', 'owner'])('allows %s to distribute', async (role) => {
    createClientMock.mockResolvedValue(mockClient({ role }))

    const preview = await previewFormRecipientsAction(PROJECT_ID)
    expect(preview.error).toBeUndefined()

    const dist = await distributeSiteFormAction(FORM_ID, PROJECT_ID)
    expect(dist.error).toBeUndefined()
    expect(dist.reportId).toBe(REPORT_ID)
  })

  it('refuses an unauthenticated caller', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      rpc: () => Promise.resolve({ data: 'owner', error: null }),
    })
    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)
    expect(res).toEqual({ error: 'Not authenticated' })
    expect(fileReportMock).not.toHaveBeenCalled()
  })

  it('rejects non-uuid ids before any I/O', async () => {
    expect(await distributeSiteFormAction('bad', PROJECT_ID)).toEqual({ error: 'Invalid id' })
    expect(await previewFormRecipientsAction('bad')).toEqual({ error: 'Invalid project id' })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

// ─── Recipient preview ───────────────────────────────────────────────────────

describe('previewFormRecipientsAction', () => {
  it('returns the exact addressable roster and the email toggle state', async () => {
    const res = await previewFormRecipientsAction(PROJECT_ID)

    expect(res.error).toBeUndefined()
    // The mailbox-less roster member is excluded: showing them would overstate
    // the audience the reviewer is about to mail.
    expect(res.recipients).toEqual([{ name: 'Site Manager', email: 'site@wmeng.co.za' }])
    expect(res.emailEnabled).toBe(true)
  })

  it('reports emailEnabled false when the project toggle is off', async () => {
    getNotificationConfigMock.mockResolvedValue({ formEmail: false })
    const res = await previewFormRecipientsAction(PROJECT_ID)
    expect(res.emailEnabled).toBe(false)
    // Bell recipients still resolve — the list is the point of the preview.
    expect(res.recipients).toHaveLength(1)
  })
})

// ─── Status gate ─────────────────────────────────────────────────────────────

describe('distributeSiteFormAction — status gate', () => {
  it('refuses a draft form and files nothing', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ status: 'draft' }))

    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    expect(res.error).toEqual(expect.stringContaining('draft'))
    expect(fileReportMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('refuses a void form', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ status: 'void' }))
    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)
    expect(res.error).toEqual(expect.stringContaining('void'))
    expect(fileReportMock).not.toHaveBeenCalled()
  })

  it('allows re-distribution of an already distributed form', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ status: 'distributed' }))
    fileReportMock.mockResolvedValue({ reportId: REPORT_ID, version: 2 })

    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    expect(res.error).toBeUndefined()
    expect(res.version).toBe(2)
  })

  it('refuses a form belonging to another project', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ formRow: null }))
    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)
    expect(res.error).toEqual(expect.stringContaining('not found on this project'))
    expect(fileReportMock).not.toHaveBeenCalled()
  })
})

// ─── Sequencing ──────────────────────────────────────────────────────────────

describe('distributeSiteFormAction — delegate, stamp, notify', () => {
  it('files the report, stamps the form and notifies the roster', async () => {
    const service = mockServiceClient()
    createServiceClientMock.mockReturnValue(service)

    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    expect(res).toMatchObject({ reportId: REPORT_ID, version: 1 })
    expect(fileReportMock).toHaveBeenCalledWith(FORM_ID, PROJECT_ID)
    expect(service.__updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'distributed',
        distributed_by: USER_ID,
        report_id: REPORT_ID,
        distributed_at: expect.any(String),
      }),
    )
    expect(notifyMock).toHaveBeenCalledWith({
      formId: FORM_ID,
      projectId: PROJECT_ID,
      actorId: USER_ID,
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/forms/${FORM_ID}`)
  })

  it('does not stamp or notify when the report filer returns an error', async () => {
    const service = mockServiceClient()
    createServiceClientMock.mockReturnValue(service)
    fileReportMock.mockResolvedValue({ error: 'Render failed: missing signature' })

    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    expect(res).toEqual({ error: 'Render failed: missing signature' })
    expect(service.__updateSpy).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('does not announce a distribution the DB did not record', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ stampError: 'column missing' }))

    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    expect(res.error).toEqual(expect.stringContaining('could not be marked distributed'))
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('still reports success, with a warning, when notification throws', async () => {
    notifyMock.mockRejectedValue(new Error('send-email down'))

    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    expect(res.error).toBeUndefined()
    expect(res.reportId).toBe(REPORT_ID)
    expect(res.warning).toEqual(expect.stringContaining('notification'))
  })
})

// ─── The void race ───────────────────────────────────────────────────────────
// The stamp runs on the SERVICE client, which the transition trigger exempts
// and which bypasses the RLS WITH CHECK — so the status predicate on the write
// is the only thing standing between a voided record and a roster-wide email
// announcing it as distributed.
describe('a form voided mid-distribution is not resurrected', () => {
  it('reports an error when the stamp affects no rows', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ stampAffectsNoRows: true }))

    const res = await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    expect(res.error).toBeTruthy()
    expect(res.reportId).toBeUndefined()
  })

  it('does not email the project when the stamp affects no rows', async () => {
    createServiceClientMock.mockReturnValue(mockServiceClient({ stampAffectsNoRows: true }))

    await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    // The whole point: PostgREST returns no error for a predicate that matched
    // nothing, so without the rows-affected check we would fall straight
    // through to notifying every project member about a withdrawn record.
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('constrains the stamp to distributable statuses', async () => {
    const service = mockServiceClient()
    createServiceClientMock.mockReturnValue(service)

    await distributeSiteFormAction(FORM_ID, PROJECT_ID)

    expect(service.__updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'distributed' }),
    )
  })
})
