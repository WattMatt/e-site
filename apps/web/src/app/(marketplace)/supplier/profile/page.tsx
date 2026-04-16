import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SupplierProfileForm } from './SupplierProfileForm'
import { PaystackOnboardingCard } from './PaystackOnboardingCard'

interface Props {
  searchParams: Promise<{ registered?: string }>
}

export default async function SupplierProfilePage({ searchParams }: Props) {
  const { registered } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/supplier/profile')

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!mem) redirect('/register')

  const { data: supplier } = await supabase
    .schema('suppliers')
    .from('suppliers')
    .select('*')
    .eq('organisation_id', mem.organisation_id)
    .limit(1)
    .maybeSingle()

  // Check if Paystack subaccount exists
  const { data: paystackSub } = supplier
    ? await supabase
        .schema('marketplace')
        .from('paystack_subaccounts')
        .select('subaccount_code, is_active, bank_name, account_name')
        .eq('supplier_id', supplier.id)
        .maybeSingle()
    : { data: null }

  const isProfileComplete = !!(
    supplier?.registration_no &&
    supplier?.province &&
    (supplier as any)?.categories?.length > 0
  )
  const isPaystackLinked = !!paystackSub?.is_active

  return (
    <div className="max-w-2xl space-y-8">
      {registered && (
        <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl px-4 py-3 text-sm text-emerald-400">
          Welcome! Your supplier account has been created. Complete your profile to appear in the marketplace.
        </div>
      )}

      {/* Profile completeness banner */}
      {(!isProfileComplete || !isPaystackLinked) && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-400 font-medium mb-1">Your marketplace profile is incomplete</p>
          <div className="flex gap-4 text-xs text-slate-400">
            <span className={isProfileComplete ? 'text-emerald-400' : 'text-slate-500'}>
              {isProfileComplete ? '✓' : '○'} Company profile
            </span>
            <span className={isPaystackLinked ? 'text-emerald-400' : 'text-slate-500'}>
              {isPaystackLinked ? '✓' : '○'} Paystack bank account
            </span>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-white mb-1">Supplier Profile</h1>
        <p className="text-sm text-slate-400">
          {supplier?.is_verified ? '✓ Verified supplier' : 'Pending verification'}
        </p>
      </div>

      {supplier ? (
        <SupplierProfileForm supplier={supplier as any} />
      ) : (
        <p className="text-slate-400 text-sm">No supplier profile found. <a href="/register" className="text-blue-400 hover:underline">Register as a supplier</a>.</p>
      )}

      {/* Paystack bank account linking */}
      {supplier && (
        <PaystackOnboardingCard supplierId={supplier.id} subaccount={paystackSub as any} />
      )}
    </div>
  )
}
