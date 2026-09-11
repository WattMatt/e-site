// @vitest-environment node
/**
 * updateOrderStatusAction must not write marketplace.orders.total_amount
 * directly (finding #8).
 *
 * The action's only gate was `if (!user)`, and it wrote
 * `total_amount = extras.quotedAmount` through the RLS client. The UPDATE
 * policy on marketplace.orders is PERMISSIVE with
 * USING (contractor_org_id = ANY get_user_org_ids() OR supplier_org_id = ANY …)
 * and get_user_org_ids() is role-blind — so this was a shorter path to the
 * same defect as the raw PostgREST PATCH: THE BUYER could set the price they
 * were about to be charged, because marketplace-payment charges
 * order.total_amount.
 *
 * Migration 00191 REVOKEs column UPDATE on total_amount from `authenticated`
 * and pins it with a RESTRICTIVE WITH CHECK, so a direct write would now fail
 * 42501 at runtime. The quote goes through marketplace.set_order_quote(), a
 * SECURITY DEFINER RPC that asserts the caller is in the order's
 * supplier_org_id (not client_viewer) and that payment_status is still
 * 'pending'.
 *
 * THE FIXTURE RULE. Asserting only that the RPC was called would stay green if
 * total_amount ALSO remained in the table-update payload — which is the state
 * that now throws 42501 in production and would have shipped as "quoting is
 * broken". So the payload itself is captured and asserted on: the key must be
 * absent.
 *
 * placeOrderAction's product-event attribution is covered at the bottom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ORDER_ID = 'eeeeeeee-0000-4000-8000-000000000005'
const SUPPLIER_ID = 'eeeeeeee-0000-4000-8000-000000000011'
const PROJECT_ID = 'eeeeeeee-0000-4000-8000-000000000022'
const ITEM_ID = 'eeeeeeee-0000-4000-8000-000000000033'
const BUYER_ORG = 'eeeeeeee-0000-4000-8000-000000000044'

const { authUser, updatePayloads, insertPayloads, rpcCalls, rpcResult, updateResult, emitProductEventMock } = vi.hoisted(() => ({
  authUser: { value: { id: 'u-supplier' } as { id: string } | null },
  updatePayloads: [] as any[],
  insertPayloads: [] as Array<{ table: string; payload: any }>,
  rpcCalls: [] as Array<{ fn: string; args: any }>,
  rpcResult: { value: { error: null as any } },
  updateResult: { value: { error: null as any } },
  emitProductEventMock: vi.fn(),
}))

// Isolate the event writer: the real emitProductEvent would construct a
// service client. These tests are about the action, not the metric row —
// but its ARGUMENTS are asserted below, because attribution is the action's.
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: emitProductEventMock }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser.value }, error: null }) },
    // placeOrderAction's buyer-membership lookup (public schema, no .schema()).
    from: (_t: string) => {
      const b: any = {}
      b.select = () => b
      b.eq = () => b
      b.limit = () => b
      b.single = async () => ({ data: { organisation_id: BUYER_ORG }, error: null })
      return b
    },
    schema: (_s: string) => ({
      rpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); return rpcResult.value },
      from: (t: string) => {
        const b: any = {}
        b.select = () => b
        b.insert = (p: any) => { insertPayloads.push({ table: t, payload: p }); b._i = true; return b }
        b.update = (p: any) => { updatePayloads.push(p); b._u = true; return b }
        b.eq = () => (b._u ? Promise.resolve(updateResult.value) : b)
        b.single = async () =>
          b._i ? { data: { id: ORDER_ID }, error: null } : { data: { created_by: 'u-buyer' }, error: null }
        // An insert awaited with no .select() (order_items) resolves to a bare result.
        b.then = (onFulfilled: (v: any) => unknown) => Promise.resolve({ error: null }).then(onFulfilled)
        return b
      },
    }),
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackServer: vi.fn(), ANALYTICS_EVENTS: {} }))

import { updateOrderStatusAction, placeOrderAction } from './supplier.actions'

beforeEach(() => {
  authUser.value = { id: 'u-supplier' }
  updatePayloads.length = 0
  insertPayloads.length = 0
  rpcCalls.length = 0
  rpcResult.value = { error: null }
  updateResult.value = { error: null }
  emitProductEventMock.mockReset()
  delete (process.env as any).NEXT_PUBLIC_SUPABASE_URL
  delete (process.env as any).SUPABASE_SERVICE_ROLE_KEY
})

describe('updateOrderStatusAction — the quote goes through the authorised RPC', () => {
  it('never puts total_amount in a direct table UPDATE', async () => {
    await updateOrderStatusAction(ORDER_ID, 'confirmed', { quotedAmount: 20100.5 })
    for (const p of updatePayloads) {
      expect(p).not.toHaveProperty('total_amount')
      expect(p).not.toHaveProperty('commission_rate')
      expect(p).not.toHaveProperty('payment_status')
    }
  })

  it('calls set_order_quote with the order id and amount', async () => {
    await updateOrderStatusAction(ORDER_ID, 'confirmed', { quotedAmount: 20100.5 })
    expect(rpcCalls).toEqual([
      { fn: 'set_order_quote', args: { p_order_id: ORDER_ID, p_total_amount: 20100.5 } },
    ])
  })

  it('still writes status and notes directly', async () => {
    await updateOrderStatusAction(ORDER_ID, 'confirmed', { notes: 'ready' })
    expect(updatePayloads[0]).toEqual({ status: 'confirmed', notes: 'ready' })
    expect(rpcCalls).toHaveLength(0)
  })

  it('surfaces an RPC refusal and does not pretend the quote landed', async () => {
    rpcResult.value = { error: { message: 'Only the supplier organisation may quote on this order' } }
    const res = await updateOrderStatusAction(ORDER_ID, 'confirmed', { quotedAmount: 1 })
    expect(res.error).toMatch(/supplier organisation/i)
  })

  it('does not apply the quote when the status write itself failed', async () => {
    updateResult.value = { error: { message: 'nope' } }
    const res = await updateOrderStatusAction(ORDER_ID, 'confirmed', { quotedAmount: 1 })
    expect(res.error).toBe('nope')
    expect(rpcCalls).toHaveLength(0)
  })

  it('still refuses an unauthenticated caller', async () => {
    authUser.value = null
    const res = await updateOrderStatusAction(ORDER_ID, 'confirmed', { quotedAmount: 1 })
    expect(res.error).toMatch(/Not authenticated/i)
    expect(rpcCalls).toHaveLength(0)
    expect(updatePayloads).toHaveLength(0)
  })
})

/**
 * emit_product_event resolves the row's organisation from the PROJECT when one
 * is given and RAISES if a supplied p_organisation_id disagrees — so an order
 * placed against a project another org owns must NOT carry the buyer's org as
 * organisationId (it would be swallowed-and-logged, not recorded). Without a
 * project there is nothing to resolve from, and the buyer's org is required.
 */
function orderForm(projectId?: string): FormData {
  const fd = new FormData()
  fd.set('supplier_id', SUPPLIER_ID)
  if (projectId) fd.set('project_id', projectId)
  fd.append('item_id', ITEM_ID)
  fd.append('item_qty', '2')
  fd.append('item_price', '150')
  return fd
}

describe('placeOrderAction — marketplace_order_placed attribution', () => {
  it('with a project: passes projectId and NO organisationId, and keeps the buyer in contractor_org_id', async () => {
    await placeOrderAction(orderForm(PROJECT_ID))
    expect(emitProductEventMock).toHaveBeenCalledTimes(1)
    const args = emitProductEventMock.mock.calls[0][0]
    expect(args).toMatchObject({ event: 'marketplace_order_placed', actorId: 'u-supplier', projectId: PROJECT_ID })
    expect(args.organisationId).toBeUndefined()
    expect(args.properties).toMatchObject({
      order_id: ORDER_ID,
      supplier_id: SUPPLIER_ID,
      contractor_org_id: BUYER_ORG,
      item_count: 1,
      total_amount_zar: 300,
    })
  })

  it('without a project: passes projectId null and organisationId = the buyer org', async () => {
    await placeOrderAction(orderForm())
    expect(emitProductEventMock).toHaveBeenCalledTimes(1)
    const args = emitProductEventMock.mock.calls[0][0]
    expect(args).toMatchObject({ event: 'marketplace_order_placed', projectId: null, organisationId: BUYER_ORG })
    expect(args.properties).toMatchObject({ order_id: ORDER_ID, contractor_org_id: BUYER_ORG })
  })
})
