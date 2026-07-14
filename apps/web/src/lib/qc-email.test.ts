import { describe, it, expect, vi, beforeEach } from 'vitest'

// Unit test for notifyQcIssued: pins the notify_qc_email toggle → email.enabled
// mapping, the signed-PDF-link plumbing (and its null fallback on signing
// failure), and the never-throws contract. The service client, the
// notifyEntityEvent channel, and renderQcIssuedEmail are all mocked at their
// import boundaries — same vi.hoisted pattern as qc.actions.test.ts.
const {
  createServiceClientMock,
  notifyEntityEventMock,
  getNotificationConfigMock,
  renderQcIssuedEmailMock,
} = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  notifyEntityEventMock: vi.fn(),
  getNotificationConfigMock: vi.fn(),
  renderQcIssuedEmailMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: createServiceClientMock }))
vi.mock('./notify', () => ({ notifyEntityEvent: notifyEntityEventMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    projectSettingsService: {
      ...actual.projectSettingsService,
      getNotificationConfig: getNotificationConfigMock,
    },
    renderQcIssuedEmail: renderQcIssuedEmailMock,
  }
})

import { notifyQcIssued } from './qc-email'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const REPORT_ID = '22222222-2222-2222-2222-222222222222'
const ACTOR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SIGNED_URL = 'https://signed.example/qc-report-v2.pdf?token=abc'

const ARGS = { reportId: REPORT_ID, projectId: PROJECT_ID, actorId: ACTOR_ID }

/**
 * Service-role client mock covering every read notifyQcIssued performs:
 * qc_reports / projects / reports single-row lookups, qc_entries /
 * qc_entry_photos count lists, the profiles issuer read, and the signed-URL
 * creation on the qc-reports bucket.
 */
function mockService(opts: {
  reportRow?: object | null
  pdfRow?: { storage_path: string } | null
  signError?: boolean
} = {}) {
  const {
    reportRow = { id: REPORT_ID, report_no: 7, title: 'Week 12 QC walk' },
    pdfRow = { storage_path: `org/${PROJECT_ID}/qc-report-${REPORT_ID}-v2.pdf` },
    signError = false,
  } = opts

  const singleRows: Record<string, unknown> = {
    qc_reports: reportRow,
    projects: { name: 'Test Project' },
    reports: pdfRow,
  }
  const listRows: Record<string, object[]> = {
    qc_entries: [{ id: 'e1' }, { id: 'e2' }],
    qc_entry_photos: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
  }

  const createSignedUrl = vi.fn(() => signError
    ? Promise.resolve({ data: null, error: { message: 'sign failed' } })
    : Promise.resolve({ data: { signedUrl: SIGNED_URL }, error: null }))
  const storageFrom = vi.fn(() => ({ createSignedUrl }))

  const chainFor = (table: string) => {
    const list = () => Promise.resolve({ data: listRows[table] ?? [], error: null })
    const chain: any = {
      eq: () => chain,
      in: () => list(),
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: singleRows[table] ?? null, error: null }),
      then: (onF: any, onR: any) => list().then(onF, onR),
    }
    return chain
  }

  return {
    client: {
      schema: () => ({ from: (table: string) => ({ select: () => chainFor(table) }) }),
      // public.profiles issuer read.
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { full_name: 'Jane PM' }, error: null }),
          }),
        }),
      }),
      storage: { from: storageFrom },
    },
    createSignedUrl,
    storageFrom,
  }
}

beforeEach(() => {
  createServiceClientMock.mockReset()
  notifyEntityEventMock.mockReset()
  getNotificationConfigMock.mockReset()
  renderQcIssuedEmailMock.mockReset()

  createServiceClientMock.mockReturnValue(mockService().client)
  getNotificationConfigMock.mockResolvedValue({
    rfiEmail: true, rfiTo: [], inspectionEmail: false,
    snagEmail: true, diaryEmail: true, qcEmail: true,
  })
  renderQcIssuedEmailMock.mockReturnValue({
    subject: 'QC Report issued: Week 12 QC walk',
    html: '<p>rendered</p>',
  })
  notifyEntityEventMock.mockResolvedValue(undefined)
})

describe('notifyQcIssued — notify_qc_email toggle mapping', () => {
  it('toggle ON → email channel enabled with the rendered subject/html + signed pdf link', async () => {
    await notifyQcIssued(ARGS)

    // Render inputs: counts, deep link, and the 7-day signed PDF url.
    expect(renderQcIssuedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'Test Project',
        reportTitle: 'Week 12 QC walk',
        reportNo: 7,
        issuerName: 'Jane PM',
        entryCount: 2,
        photoCount: 3,
        deepLink: expect.stringContaining(`/projects/${PROJECT_ID}/quality-control/${REPORT_ID}`),
        pdfUrl: SIGNED_URL,
      }),
    )
    expect(notifyEntityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        bell: expect.objectContaining({ type: 'qc_issued', entityId: REPORT_ID }),
        email: {
          enabled: true,
          subject: 'QC Report issued: Week 12 QC walk',
          html: '<p>rendered</p>',
        },
      }),
    )
  })

  it('toggle OFF → email channel disabled (bell still dispatched, no email payload active)', async () => {
    getNotificationConfigMock.mockResolvedValue({
      rfiEmail: true, rfiTo: [], inspectionEmail: false,
      snagEmail: true, diaryEmail: true, qcEmail: false,
    })

    await notifyQcIssued(ARGS)

    expect(notifyEntityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bell: expect.objectContaining({ type: 'qc_issued' }),
        email: expect.objectContaining({ enabled: false }),
      }),
    )
  })
})

describe('notifyQcIssued — signed-link degradation', () => {
  it('signing failure still sends the email, with pdfUrl null', async () => {
    createServiceClientMock.mockReturnValue(mockService({ signError: true }).client)

    await notifyQcIssued(ARGS)

    expect(renderQcIssuedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ pdfUrl: null }),
    )
    expect(notifyEntityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: expect.objectContaining({ enabled: true }) }),
    )
  })

  it('missing reports row (no PDF yet) → pdfUrl null, no signing attempted', async () => {
    const service = mockService({ pdfRow: null })
    createServiceClientMock.mockReturnValue(service.client)

    await notifyQcIssued(ARGS)

    expect(service.createSignedUrl).not.toHaveBeenCalled()
    expect(renderQcIssuedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ pdfUrl: null }),
    )
  })
})

describe('notifyQcIssued — never throws (best-effort contract)', () => {
  it('resolves silently when the report row is gone (no notify at all)', async () => {
    createServiceClientMock.mockReturnValue(mockService({ reportRow: null }).client)
    await expect(notifyQcIssued(ARGS)).resolves.toBeUndefined()
    expect(notifyEntityEventMock).not.toHaveBeenCalled()
  })

  it('resolves when createServiceClient itself throws', async () => {
    createServiceClientMock.mockImplementation(() => { throw new Error('no service key') })
    await expect(notifyQcIssued(ARGS)).resolves.toBeUndefined()
    expect(notifyEntityEventMock).not.toHaveBeenCalled()
  })

  it('resolves when the settings read rejects', async () => {
    getNotificationConfigMock.mockRejectedValue(new Error('db down'))
    await expect(notifyQcIssued(ARGS)).resolves.toBeUndefined()
  })

  it('resolves when notifyEntityEvent rejects', async () => {
    notifyEntityEventMock.mockRejectedValue(new Error('dispatch exploded'))
    await expect(notifyQcIssued(ARGS)).resolves.toBeUndefined()
  })
})
