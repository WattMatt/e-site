import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The defect these guard: the RFI toggle promised email on raise, response and
 * close, and only `createRfiAction` ever dispatched one. `respondToRfiAction`
 * and `closeRfiAction` called `dispatchNotification` alone — push, against a
 * `public.push_tokens` table with zero rows.
 *
 * The assertion that matters is that ALL THREE actions announce their event on
 * the shared roster channel. A test that only checked create would have passed
 * against the broken code for the entire life of the module.
 */
const { createClientMock, notifyRfiEventMock, trackServerMock, rfiServiceCreateMock } = vi.hoisted(
  () => ({
    createClientMock: vi.fn(),
    notifyRfiEventMock: vi.fn(),
    trackServerMock: vi.fn(),
    rfiServiceCreateMock: vi.fn(),
  }),
)

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/rfi-email', () => ({ notifyRfiEvent: notifyRfiEventMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/analytics', async () => {
  const actual = await vi.importActual<any>('@/lib/analytics')
  return { ...actual, trackServer: trackServerMock }
})
// Isolate the event writer: the real emitProductEvent would construct a
// service client. These tests are about the action, not the metric row.
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: vi.fn() }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, rfiService: { ...actual.rfiService, create: rfiServiceCreateMock } }
})

import { RFI_CLOSE_REFUSED } from '@esite/shared'
import { createRfiAction, respondToRfiAction, closeRfiAction } from './rfi.actions'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const RFI_ID = '22222222-2222-2222-2222-222222222222'
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RAISER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const RFI_ROW = {
  id: RFI_ID,
  subject: 'Confirm the busbar rating at MAIN BOARD 3.1',
  raised_by: RAISER_ID,
  assigned_to: null,
  organisation_id: 'org-1',
  project_id: PROJECT_ID,
  status: 'open',
}

/**
 * Cookie client covering: the user_organisations membership read, the
 * projects.rfis single read, the rfi_responses insert, the status updates and
 * the user_effective_project_role RPC the close gate resolves the caller with.
 *
 * `updatedRows` is what the status UPDATE reports as affected. It is a
 * parameter rather than a constant because migration 00201's RESTRICTIVE
 * policy refuses SILENTLY — no error, no rows — and every silent-refusal test
 * below turns on telling those two apart.
 */
function mockClient(
  opts: { rfiRow?: object | null; effectiveRole?: string | null; updatedRows?: object[] } = {},
) {
  const { rfiRow = RFI_ROW, effectiveRole = 'project_manager', updatedRows = [{ id: RFI_ID }] } = opts
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    rpc: async (_fn: string) => ({ data: effectiveRole, error: null }),
    // public.user_organisations
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ limit: () => ({ single: async () => ({ data: { organisation_id: 'org-1' }, error: null }) }) }),
        }),
      }),
    }),
    schema: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: rfiRow, error: rfiRow ? null : { message: 'no rows' } }) }),
        }),
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'resp-1' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ select: async () => ({ data: updatedRows, error: null }) }) }),
        __table: table,
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  createClientMock.mockResolvedValue(mockClient())
  notifyRfiEventMock.mockResolvedValue(undefined)
  trackServerMock.mockResolvedValue(undefined)
  rfiServiceCreateMock.mockResolvedValue({ id: RFI_ID, subject: RFI_ROW.subject, assigned_to: null })
})

describe('every RFI lifecycle action announces its event', () => {
  it('createRfiAction → event "created"', async () => {
    const res = await createRfiAction({
      projectId: PROJECT_ID,
      subject: RFI_ROW.subject,
      description: 'What is the busbar rating at MAIN BOARD 3.1?',
      priority: 'high',
    } as never)

    expect(res.rfiId).toBe(RFI_ID)
    expect(notifyRfiEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'created', rfiId: RFI_ID, projectId: PROJECT_ID, actorId: USER_ID }),
    )
  })

  it('respondToRfiAction → event "responded", carrying the response id for the bell deep link', async () => {
    const res = await respondToRfiAction({ rfiId: RFI_ID, body: 'Rated 800A per the manufacturer data sheet.' } as never)

    expect(res.responseId).toBe('resp-1')
    expect(notifyRfiEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'responded',
        rfiId: RFI_ID,
        projectId: PROJECT_ID,
        actorId: USER_ID,
        bellEntityId: 'resp-1',
      }),
    )
  })

  it('closeRfiAction → event "closed"', async () => {
    const res = await closeRfiAction(RFI_ID)

    expect(res.error).toBeUndefined()
    expect(notifyRfiEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'closed', rfiId: RFI_ID, projectId: PROJECT_ID, actorId: USER_ID }),
    )
  })

  it('announces nothing when the write itself fails', async () => {
    createClientMock.mockResolvedValue(mockClient({ rfiRow: null }))
    expect(
      await respondToRfiAction({ rfiId: RFI_ID, body: 'Rated 800A per the data sheet.' } as never),
    ).toEqual({ error: 'RFI not found' })
    expect(await closeRfiAction(RFI_ID)).toEqual({ error: 'RFI not found' })
    expect(notifyRfiEventMock).not.toHaveBeenCalled()
  })

  it('does not re-announce an already-closed RFI', async () => {
    createClientMock.mockResolvedValue(mockClient({ rfiRow: { ...RFI_ROW, status: 'closed' } }))
    expect(await closeRfiAction(RFI_ID)).toEqual({ error: 'RFI is already closed' })
    expect(notifyRfiEventMock).not.toHaveBeenCalled()
  })
})

/**
 * The gap migration 00201 closes, at the layer the user meets first.
 * `closeRfiAction` checked authentication and nothing else: any org member
 * could close any RFI in the organisation, and the Close button was rendered
 * for every role that could see the record. The database is the backstop; this
 * is the gate.
 */
describe('closeRfiAction — only the raiser, or a governing role, may close', () => {
  it('refuses a caller who is neither the raiser nor owner/admin/project_manager', async () => {
    createClientMock.mockResolvedValue(mockClient({ effectiveRole: 'contractor' }))
    const res = await closeRfiAction(RFI_ID)
    expect(res.error).toBe(RFI_CLOSE_REFUSED)
    expect(notifyRfiEventMock).not.toHaveBeenCalled()
  })

  it('refuses a caller with no role on the RFI\'s project at all', async () => {
    createClientMock.mockResolvedValue(mockClient({ effectiveRole: null }))
    expect((await closeRfiAction(RFI_ID)).error).toBe(RFI_CLOSE_REFUSED)
    expect(notifyRfiEventMock).not.toHaveBeenCalled()
  })

  it('lets the RAISER close, without needing a governing role', async () => {
    createClientMock.mockResolvedValue(
      mockClient({ rfiRow: { ...RFI_ROW, raised_by: USER_ID }, effectiveRole: 'contractor' }),
    )
    const res = await closeRfiAction(RFI_ID)
    expect(res.error).toBeUndefined()
    expect(notifyRfiEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'closed' }))
  })

  it('lets a governing role close an RFI it did not raise', async () => {
    createClientMock.mockResolvedValue(mockClient({ effectiveRole: 'owner' }))
    expect((await closeRfiAction(RFI_ID)).error).toBeUndefined()
  })

  it('reports a SILENT policy refusal rather than announcing a close that never happened', async () => {
    // 00201's RESTRICTIVE policy matching no row raises nothing. Before the
    // rows-affected check the action returned {} and sent the closed bell.
    createClientMock.mockResolvedValue(mockClient({ effectiveRole: 'owner', updatedRows: [] }))
    expect((await closeRfiAction(RFI_ID)).error).toBe(RFI_CLOSE_REFUSED)
    expect(notifyRfiEventMock).not.toHaveBeenCalled()
  })
})

describe('respondToRfiAction — a refused status flip never discards the answer', () => {
  it('warns, and still returns the response id, when the flip matches no row', async () => {
    createClientMock.mockResolvedValue(mockClient({ updatedRows: [] }))
    const res = await respondToRfiAction({ rfiId: RFI_ID, body: 'Rated 800A per the data sheet.' } as never)
    expect(res.responseId).toBe('resp-1')
    expect(res.error).toBeUndefined()
    expect(res.statusWarning).toMatch(/could not be moved to Responded/)
    // The answer landed, so the participants are still told about it.
    expect(notifyRfiEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'responded' }))
  })

  it('carries no warning when the flip took', async () => {
    const res = await respondToRfiAction({ rfiId: RFI_ID, body: 'Rated 800A per the data sheet.' } as never)
    expect(res.statusWarning).toBeUndefined()
  })
})
