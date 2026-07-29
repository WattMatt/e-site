import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'
const REPORT_ID = '00000000-0000-0000-0000-000000000055'

const SAVED_PDF = { storage_path: 'org/proj/qc-report-x-v2.pdf', version: 2 }

/**
 * Two RLS-client chains:
 *   qc_reports: select → eq(id) → eq(project) → maybeSingle   (visibility gate)
 *   reports:    select → eq×5 → order → limit → maybeSingle    (latest issued PDF)
 * The mock stands in for RLS: a null qcReportRow models a row the caller cannot
 * see (draft for a client_viewer, or a cross-project id filtered out by eq).
 */
function makeSupabase(opts: {
  qcReportRow?: unknown | null
  savedRow?: unknown | null
} = {}) {
  const { qcReportRow = null, savedRow = SAVED_PDF } = opts

  const qcMaybeSingle = vi.fn().mockResolvedValue({ data: qcReportRow, error: null })
  const qcEq2 = vi.fn().mockReturnValue({ maybeSingle: qcMaybeSingle })
  const qcEq1 = vi.fn().mockReturnValue({ eq: qcEq2 })
  const qcSelect = vi.fn().mockReturnValue({ eq: qcEq1 })
  const fromQcReports = vi.fn().mockReturnValue({ select: qcSelect })

  const savedMaybeSingle = vi.fn().mockResolvedValue({ data: savedRow, error: null })
  const limit = vi.fn().mockReturnValue({ maybeSingle: savedMaybeSingle })
  const order = vi.fn().mockReturnValue({ limit })
  const rEq5 = vi.fn().mockReturnValue({ order })
  const rEq4 = vi.fn().mockReturnValue({ eq: rEq5 })
  const rEq3 = vi.fn().mockReturnValue({ eq: rEq4 })
  const rEq2 = vi.fn().mockReturnValue({ eq: rEq3 })
  const rEq1 = vi.fn().mockReturnValue({ eq: rEq2 })
  const reportsSelect = vi.fn().mockReturnValue({ eq: rEq1 })
  const fromReports = vi.fn().mockReturnValue({ select: reportsSelect })

  const schema = vi.fn(() => ({
    from: (table: string) => (table === 'qc_reports' ? fromQcReports() : fromReports()),
  }))

  return { client: { schema }, qcSelect, savedMaybeSingle }
}

function makeServiceClient(opts: { signedUrl?: string | null } = {}) {
  const createSignedUrl = vi.fn().mockResolvedValue(
    opts.signedUrl === null
      ? { data: null, error: { message: 'sign failed' } }
      : { data: { signedUrl: opts.signedUrl ?? 'https://signed.example/qc.pdf' }, error: null },
  )
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrl })
  return { client: { storage: { from: storageFrom } }, createSignedUrl, storageFrom }
}

describe('getPortalQcReportPdfUrlAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('signs the latest PDF for an ISSUED report', async () => {
    const sup = makeSupabase({ qcReportRow: { id: REPORT_ID, report_no: 7, status: 'issued' } })
    const service = makeServiceClient({ signedUrl: 'https://signed.example/issued.pdf' })
    createClientMock.mockResolvedValue(sup.client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getPortalQcReportPdfUrlAction } = await import('./portal-qc.actions')
    const result = await getPortalQcReportPdfUrlAction(PROJECT_ID, REPORT_ID)

    expect(result).toEqual({ url: 'https://signed.example/issued.pdf' })
    expect(service.storageFrom).toHaveBeenCalledWith('qc-reports')
    expect(service.createSignedUrl).toHaveBeenCalledWith(
      SAVED_PDF.storage_path,
      expect.any(Number),
      { download: 'qc-report-7-v2.pdf' },
    )
  })

  it('signs the latest PDF for a CLOSED ("Archived") report', async () => {
    const sup = makeSupabase({ qcReportRow: { id: REPORT_ID, report_no: 7, status: 'closed' } })
    const service = makeServiceClient({ signedUrl: 'https://signed.example/closed.pdf' })
    createClientMock.mockResolvedValue(sup.client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getPortalQcReportPdfUrlAction } = await import('./portal-qc.actions')
    const result = await getPortalQcReportPdfUrlAction(PROJECT_ID, REPORT_ID)

    expect(result).toEqual({ url: 'https://signed.example/closed.pdf' })
    expect(service.createSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('blocks a DRAFT report — no PDF is signed', async () => {
    const sup = makeSupabase({ qcReportRow: { id: REPORT_ID, report_no: 7, status: 'draft' } })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(sup.client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getPortalQcReportPdfUrlAction } = await import('./portal-qc.actions')
    const result = await getPortalQcReportPdfUrlAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
    // Never reaches the saved-PDF lookup or the signer.
    expect(sup.savedMaybeSingle).not.toHaveBeenCalled()
    expect(service.createSignedUrl).not.toHaveBeenCalled()
  })

  it('blocks a cross-project / unreadable report id (RLS miss → not found)', async () => {
    const sup = makeSupabase({ qcReportRow: null })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(sup.client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getPortalQcReportPdfUrlAction } = await import('./portal-qc.actions')
    const result = await getPortalQcReportPdfUrlAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
    expect(service.createSignedUrl).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid id before any query', async () => {
    const sup = makeSupabase({ qcReportRow: { id: REPORT_ID, report_no: 7, status: 'issued' } })
    createClientMock.mockResolvedValue(sup.client)

    const { getPortalQcReportPdfUrlAction } = await import('./portal-qc.actions')
    const result = await getPortalQcReportPdfUrlAction('not-a-uuid', REPORT_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
    expect(sup.qcSelect).not.toHaveBeenCalled()
  })

  it('reports when the report is visible but has no saved PDF yet', async () => {
    const sup = makeSupabase({ qcReportRow: { id: REPORT_ID, report_no: 7, status: 'issued' }, savedRow: null })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(sup.client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getPortalQcReportPdfUrlAction } = await import('./portal-qc.actions')
    const result = await getPortalQcReportPdfUrlAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/no pdf/i)
    expect(service.createSignedUrl).not.toHaveBeenCalled()
  })
})
