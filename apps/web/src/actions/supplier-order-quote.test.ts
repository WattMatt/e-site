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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ORDER_ID = 'eeeeeeee-0000-4000-8000-000000000005'

const { authUser, updatePayloads, rpcCalls, rpcResult, updateResult } = vi.hoisted(() => ({
  authUser: { value: { id: 'u-supplier' } as { id: string } | null },
  updatePayloads: [] as any[],
  rpcCalls: [] as Array<{ fn: string; args: any }>,
  rpcResult: { value: { error: null as any } },
  updateResult: { value: { error: null as any } },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser.value }, error: null }) },
    schema: (_s: string) => ({
      rpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); return rpcResult.value },
      from: (_t: string) => {
        const b: any = {}
        b.select = () => b
        b.update = (p: any) => { updatePayloads.push(p); b._u = true; return b }
        b.eq = () => (b._u ? Promise.resolve(updateResult.value) : b)
        b.single = async () => ({ data: { created_by: 'u-buyer' }, error: null })
        return b
      },
    }),
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackServer: vi.fn(), ANALYTICS_EVENTS: {} }))

import { updateOrderStatusAction } from './supplier.actions'

beforeEach(() => {
  authUser.value = { id: 'u-supplier' }
  updatePayloads.length = 0
  rpcCalls.length = 0
  rpcResult.value = { error: null }
  updateResult.value = { error: null }
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
