import { describe, it, expect, vi, beforeEach } from 'vitest'

// The certification RULES are the database's (00235: certification_blockers + the transition guard,
// proven by scripts/db/assert-inspection-status-transitions.sql). These tests pin what the action
// itself owns: the engine's result is computed from the saved answers and a FAIL never reaches the
// database; the database's sentence is surfaced; only the computed result and (for a CoC) the
// typed number are sent; the issued number is read back rather than allocated here.

const { createClientMock, requireFeatureMock, dispatchNotificationMock, revalidatePathMock, fileReportMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    requireFeatureMock: vi.fn(),
    dispatchNotificationMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    fileReportMock: vi.fn(),
  }))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/features', () => ({ requireFeature: requireFeatureMock }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: dispatchNotificationMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/reports/file-inspection-report', () => ({ generateAndFileInspectionReport: fileReportMock }))

import { certifyInspectionAction, sendBackForReinspectionAction } from './inspections-certify.actions'

const TEMPLATE = {
  sections: [
    {
      section_id: 's1',
      title: 'S1',
      fields: [
        { field_id: 'q1', type: 'pass_fail', label: 'Q1', required: true },
        { field_id: 'q2', type: 'pass_fail', label: 'Q2' },
      ],
    },
  ],
}

function qb(result: unknown): any {
  const p: any = Promise.resolve(result)
  for (const m of ['select', 'eq', 'in', 'neq', 'order']) p[m] = () => qb(result)
  p.single = () => Promise.resolve(result)
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

function makeClient(opts: {
  deliverable?: string
  responses: Array<{ section_id: string; field_id: string; value_bool: boolean }>
  blocker?: string | null
  issued?: { coc_number: string } | null
}) {
  const update = vi.fn(() => qb({ data: opts.issued === undefined ? { coc_number: 'INS-KW-2026-0001' } : opts.issued, error: null }))
  const rpc = vi.fn(() => Promise.resolve({ data: opts.blocker ?? null, error: null }))
  const tables: Record<string, unknown> = {
    inspections: { data: { id: 'i-1', status: 'awaiting_verification', verifier_id: 'v-1', organisation_id: 'o-1', template_id: 't-1' }, error: null },
    templates: { data: { deliverable_type: opts.deliverable ?? 'inspection_only', schema_json: TEMPLATE }, error: null },
    responses: { data: opts.responses, error: null },
    photos: { data: [], error: null },
    signatures: { data: [], error: null },
    response_history: { data: [], error: null },
  }
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'v-1' } } }) },
    functions: { invoke: vi.fn(() => Promise.resolve({ error: null })) },
    from: () => ({ select: () => qb({ data: [], error: null }) }),
    schema: () => ({
      rpc,
      from: (t: string) => ({ select: () => qb(tables[t] ?? { data: [], error: null }), update }),
    }),
  }
  return { client, update, rpc }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireFeatureMock.mockResolvedValue(undefined)
  fileReportMock.mockResolvedValue({ ok: true })
})

describe('certifyInspectionAction', () => {
  it('refuses a FAIL before asking or writing anything: the verifier sends it back instead', async () => {
    const { client, update, rpc } = makeClient({ responses: [{ section_id: 's1', field_id: 'q1', value_bool: false }] })
    createClientMock.mockResolvedValue(client)

    expect(await certifyInspectionAction({ inspectionId: 'i-1', projectId: 'p-1' })).toEqual({ ok: false, error: expect.stringMatching(/Send it back/) })
    expect(rpc).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses when a required check is unanswered (the engine reads that as FAIL)', async () => {
    const { client, update } = makeClient({ responses: [] })
    createClientMock.mockResolvedValue(client)

    expect(await certifyInspectionAction({ inspectionId: 'i-1', projectId: 'p-1' })).toEqual({ ok: false, error: expect.stringMatching(/Send it back/) })
    expect(update).not.toHaveBeenCalled()
  })

  it("surfaces the database's sentence and does not write", async () => {
    const { client, update, rpc } = makeClient({
      responses: [{ section_id: 's1', field_id: 'q1', value_bool: true }],
      blocker: 'Only the assigned verifier can certify this inspection.',
    })
    createClientMock.mockResolvedValue(client)

    expect(await certifyInspectionAction({ inspectionId: 'i-1', projectId: 'p-1' })).toEqual({ ok: false, error: 'Only the assigned verifier can certify this inspection.' })
    expect(rpc).toHaveBeenCalledWith('certification_blockers', { _inspection_id: 'i-1', _coc_number: null })
    expect(update).not.toHaveBeenCalled()
  })

  it('sends the computed result (conditional pass when only an optional check failed) and returns the issued number', async () => {
    const { client, update } = makeClient({
      responses: [
        { section_id: 's1', field_id: 'q1', value_bool: true },
        { section_id: 's1', field_id: 'q2', value_bool: false },
      ],
    })
    createClientMock.mockResolvedValue(client)

    const issued = await certifyInspectionAction({ inspectionId: 'i-1', projectId: 'p-1', cocNumber: 'ignored' })
    expect(update).toHaveBeenCalledWith({ status: 'certified', overall_result: 'conditional_pass', coc_number: null })
    expect(issued).toEqual({ ok: true, value: 'INS-KW-2026-0001' })
  })

  it('sends the typed number, trimmed, for a CoC', async () => {
    const { client, update, rpc } = makeClient({
      deliverable: 'coc',
      responses: [{ section_id: 's1', field_id: 'q1', value_bool: true }],
      issued: { coc_number: 'ECB-77' },
    })
    createClientMock.mockResolvedValue(client)

    const issued = await certifyInspectionAction({ inspectionId: 'i-1', projectId: 'p-1', cocNumber: '  ECB-77 ' })
    expect(rpc).toHaveBeenCalledWith('certification_blockers', { _inspection_id: 'i-1', _coc_number: 'ECB-77' })
    expect(update).toHaveBeenCalledWith({ status: 'certified', overall_result: 'pass', coc_number: 'ECB-77' })
    expect(issued).toEqual({ ok: true, value: 'ECB-77' })
  })

  it('says so when nothing was certified (the inspection moved on)', async () => {
    const { client } = makeClient({ responses: [{ section_id: 's1', field_id: 'q1', value_bool: true }], issued: null })
    createClientMock.mockResolvedValue(client)

    expect(await certifyInspectionAction({ inspectionId: 'i-1', projectId: 'p-1' })).toEqual({ ok: false, error: expect.stringMatching(/Nothing was certified/) })
  })
  it('never throws: an unexpected failure comes back as a refusal the dialog can show', async () => {
    createClientMock.mockRejectedValue(new Error('connection reset'))

    expect(await certifyInspectionAction({ inspectionId: 'i-1', projectId: 'p-1' })).toEqual({ ok: false, error: 'connection reset' })
  })
})

describe('sendBackForReinspectionAction', () => {
  it('returns the refusal as data when the note is blank, without writing', async () => {
    const { client, update } = makeClient({ responses: [] })
    createClientMock.mockResolvedValue(client)

    expect(await sendBackForReinspectionAction({ inspectionId: 'i-1', projectId: 'p-1', notes: '   ' })).toEqual({
      ok: false,
      error: 'Re-inspection notes are required',
    })
    expect(update).not.toHaveBeenCalled()
  })
})
