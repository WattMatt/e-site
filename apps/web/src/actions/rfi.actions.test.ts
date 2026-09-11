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
 * projects.rfis single read, the rfi_responses insert and the status updates.
 */
function mockClient(opts: { rfiRow?: object | null } = {}) {
  const { rfiRow = RFI_ROW } = opts
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
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
        update: () => ({ eq: async () => ({ error: null }) }),
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
