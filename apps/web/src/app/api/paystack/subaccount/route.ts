import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request body' }, { status: 400 })
  }
  const { supplierId, bankCode, accountNumber, businessName, primaryContactEmail } = parsed.data

  // Verify the supplier belongs to the current user's org
  const { data: memRaw } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  const mem = memRaw as { organisation_id: string } | null

  if (!mem) return NextResponse.json({ error: 'No organisation found' }, { status: 403 })

  const { data: supplier } = await supabase
    .schema('suppliers')
    .from('suppliers')
    .select('id, name')
    .eq('id', supplierId)
    .eq('organisation_id', mem.organisation_id)
    .single()

  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

  try {
    const paystack = getPaystackService()
    const subaccount = await paystack.createSubaccount({
      businessName,
      settlementBank: bankCode,
      accountNumber,
      percentageCharge: 94, // supplier receives 94% (E-Site keeps 6%)
      primaryContactEmail,
    })

    // Persist to marketplace.paystack_subaccounts
    const { error: dbErr } = await supabase
      .schema('marketplace')
      .from('paystack_subaccounts')
      .upsert({
        supplier_id: supplierId,
        supplier_org_id: mem.organisation_id,
        subaccount_code: subaccount.subaccount_code,
        bank_name: subaccount.settlement_bank,
        bank_code: bankCode,
        account_number: accountNumber,
        account_name: businessName,
        is_active: true,
      }, { onConflict: 'supplier_id' })

    if (dbErr) {
      console.error('Paystack subaccount DB error:', dbErr)
      return NextResponse.json({ error: 'Subaccount created in Paystack but failed to save' }, { status: 500 })
    }

    return NextResponse.json({ subaccount_code: subaccount.subaccount_code })
  } catch (err: any) {
    console.error('Paystack subaccount error:', err)
    return NextResponse.json({ error: err.message ?? 'Failed to create subaccount' }, { status: 500 })
  }
}
