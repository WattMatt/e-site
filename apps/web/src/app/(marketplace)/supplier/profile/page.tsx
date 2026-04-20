import { redirect } from 'next/navigation'
import Link from 'next/link'
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

  const { data: memRaw } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  const mem = memRaw as { organisation_id: string } | null

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
    <div className="animate-fadeup" style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {registered && (
        <div
          role="status"
          style={{
            background: '#14532d',
            border: '1px solid #166534',
            color: '#4ade80',
            borderRadius: 6,
            padding: '12px 16px',
            fontSize: 13,
          }}
        >
          Welcome! Your supplier account has been created. Complete your profile to appear in the marketplace.
        </div>
      )}

      {/* Profile completeness banner */}
      {(!isProfileComplete || !isPaystackLinked) && (
        <div
          style={{
            background: 'var(--c-amber-dim)',
            border: '1px solid var(--c-amber-mid)',
            borderRadius: 6,
            padding: '12px 16px',
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--c-amber)', fontWeight: 600, marginBottom: 6 }}>
            Your marketplace profile is incomplete
          </p>
          <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em' }}>
            <span style={{ color: isProfileComplete ? '#4ade80' : 'var(--c-text-dim)' }}>
              {isProfileComplete ? '✓' : '○'} Company profile
            </span>
            <span style={{ color: isPaystackLinked ? '#4ade80' : 'var(--c-text-dim)' }}>
              {isPaystackLinked ? '✓' : '○'} Paystack bank account
            </span>
          </div>
        </div>
      )}

      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Supplier Profile</h1>
          <p className="page-subtitle">
            {supplier?.is_verified ? '✓ Verified supplier' : 'Pending verification'}
          </p>
        </div>
      </div>

      {supplier ? (
        <SupplierProfileForm supplier={supplier as any} />
      ) : (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '32px 18px' }}>
            No supplier profile found.{' '}
            <Link href="/register" style={{ color: 'var(--c-amber)', textDecoration: 'none' }}>
              Register as a supplier
            </Link>.
          </div>
        </div>
      )}

      {/* Paystack bank account linking */}
      {supplier && (
        <PaystackOnboardingCard supplierId={supplier.id} subaccount={paystackSub as any} />
      )}
    </div>
  )
}
