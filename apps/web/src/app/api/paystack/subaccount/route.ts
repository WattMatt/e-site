/**
 * POST /api/paystack/subaccount — bind a supplier's marketplace payouts to a
 * bank account.
 *
 * This endpoint decides where a supplier's money lands, so the ordering below
 * is load-bearing and deliberate:
 *
 *   1. session → 2. rate limit → 3. body → 4. resolve the supplier (service
 *   client, by id ALONE) → 5. refuse an org-less supplier → 6. role gate
 *   against the SUPPLIER's org → 7. refuse an existing binding →
 *   8. ONLY THEN mint at Paystack → 9. persist immediately with the service
 *   client → 10. on write failure, surface and log the subaccount_code.
 *
 * ⚠ What this replaced, and why each step exists:
 *
 * - There was NO role predicate. A session plus any active org membership was
 *   the whole check, so a contractor, inspector, supplier or client_viewer who
 *   shared an org with the supplier could set its payout account.
 *
 * - The org came from an ambient `.eq('is_active', true).limit(1).single()`
 *   read of user_organisations with no `.order()`, so PostgREST returned an
 *   ARBITRARY org for a multi-org caller. That read is gone. The only org that
 *   matters here is the supplier's own.
 *
 * - ⚠ Do NOT reintroduce it by passing `supplier.organisation_id ?? undefined`
 *   to requireRoleAPI. With no org id that helper falls back to the CALLER's
 *   primary org (require-role.ts), which would let an owner/admin of any
 *   organisation bank a supplier that belongs to none. An org-less supplier
 *   fails closed with 409.
 *
 * - The Paystack call used to run BEFORE any durable write, and the write went
 *   through the caller's anon-key cookie client. marketplace.paystack_subaccounts
 *   has RLS on with a SELECT-only policy, so that insert was rejected 42501 —
 *   every time. The first real supplier to link an account would have minted a
 *   live subaccount bound to their actual bank account, received a 500, and the
 *   subaccount_code would have survived only inside a console.error. Every
 *   retry minted another orphan (subaccount_code is UNIQUE, so the upsert's
 *   onConflict never engaged). The write now uses the service client, after
 *   the role gate.
 *
 *   Why the service client rather than new INSERT/UPDATE RLS policies: a write
 *   policy would make marketplace.paystack_subaccounts writable over direct
 *   PostgREST, which is a capability nobody needs — payout bindings should only
 *   ever be created by this audited path. Migration 00191 instead REVOKEs
 *   INSERT/UPDATE/DELETE on the table from `authenticated` entirely, so the
 *   grant layer refuses the write even if a permissive policy is ever added by
 *   accident.
 *
 * - The write was an upsert `onConflict: 'supplier_id'`, i.e. designed to
 *   REPLACE an existing binding — a payout-hijack primitive the moment the
 *   role gate exists to be passed. Re-binding is now refused (409); changing a
 *   supplier's bank details is a deliberate support action, not a form post.
 *
 * rbac-matrix: docs/rbac-matrix.md, `POST /api/paystack/subaccount`.
 */

import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { rateLimit } from '@/lib/rate-limit'
import { OWNER_ADMIN } from '@esite/shared'
import { getPaystackService } from '@esite/db'

const bodySchema = z.object({
  supplierId: z.string().uuid(),
  bankCode: z.string().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  businessName: z.string().min(1).max(100),
  primaryContactEmail: z.string().email().optional(),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  if (!rateLimit(`subaccount:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request body' }, { status: 400 })
  }
  const { supplierId, bankCode, accountNumber, businessName, primaryContactEmail } = parsed.data

  // Resolve the supplier by id ALONE, on the service client. The caller's own
  // visibility of the supplier row must not decide which org we gate against —
  // the supplier's real organisation_id does.
  const service = createServiceClient()
  const { data: supplier } = await (service as any)
    .schema('suppliers')
    .from('suppliers')
    .select('id, name, organisation_id')
    .eq('id', supplierId)
    .maybeSingle()

  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

  const supplierOrgId = (supplier as { organisation_id: string | null }).organisation_id
  if (!supplierOrgId) {
    // Fail closed. Every one of the 7 production suppliers is in this state
    // today, so this is the branch a real caller hits first.
    return NextResponse.json(
      { error: 'This supplier is not linked to an organisation yet, so payouts cannot be configured.' },
      { status: 409 },
    )
  }

  const gate = await requireRole(supabase, supplierOrgId, OWNER_ADMIN)
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error },
      { status: gate.error === 'Not authenticated' ? 401 : 403 },
    )
  }

  // An existing binding is never silently replaced.
  const { data: existing } = await (service as any)
    .schema('marketplace')
    .from('paystack_subaccounts')
    .select('subaccount_code, supplier_org_id')
    .eq('supplier_id', supplierId)
    .maybeSingle()

  if (existing?.subaccount_code) {
    return NextResponse.json(
      {
        error: 'This supplier already has a payout account. Contact support to change bank details.',
        subaccount_code: existing.subaccount_code,
      },
      { status: 409 },
    )
  }

  let subaccountCode: string
  try {
    const paystack = getPaystackService()
    const subaccount = await paystack.createSubaccount({
      businessName,
      settlementBank: bankCode,
      accountNumber,
      percentageCharge: 94, // supplier receives 94% (E-Site keeps 6%)
      primaryContactEmail,
    })
    subaccountCode = subaccount.subaccount_code
  } catch (err: any) {
    console.error('Paystack subaccount error:', err)
    return NextResponse.json({ error: err?.message ?? 'Failed to create subaccount' }, { status: 500 })
  }

  const { error: dbErr } = await (service as any)
    .schema('marketplace')
    .from('paystack_subaccounts')
    .insert({
      supplier_id: supplierId,
      supplier_org_id: supplierOrgId,
      subaccount_code: subaccountCode,
      settlement_bank: bankCode,
      account_number: accountNumber,
      business_name: businessName,
      is_verified: true,
    })

  if (dbErr) {
    // A Paystack subaccount now exists, bound to a real bank account, with no
    // row to match it. Make it recoverable from BOTH the log and the response
    // rather than losing it — grep PAYSTACK_SUBACCOUNT_ORPHAN.
    console.error('PAYSTACK_SUBACCOUNT_ORPHAN', {
      subaccount_code: subaccountCode,
      supplier_id: supplierId,
      supplier_org_id: supplierOrgId,
      dbError: dbErr,
    })
    return NextResponse.json(
      {
        error: 'Subaccount created in Paystack but failed to save. Quote the code below to support.',
        subaccount_code: subaccountCode,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ subaccount_code: subaccountCode })
}
