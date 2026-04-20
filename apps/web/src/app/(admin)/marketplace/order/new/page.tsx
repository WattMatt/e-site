import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { supplierService, projectService } from '@esite/shared'
import { PlaceOrderForm } from './PlaceOrderForm'

interface Props {
  searchParams: Promise<{ supplierId?: string }>
}

export default async function NewOrderPage({ searchParams }: Props) {
  const { supplierId } = await searchParams
  if (!supplierId) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const [supplier, catalogueItems, projects] = await Promise.all([
    supplierService.getById(supabase as any, supplierId).catch(() => null),
    supplierService.getCatalogueItems(supabase as any, supplierId).catch(() => []),
    mem ? projectService.list(supabase as any, mem.organisation_id).catch(() => []) : [],
  ])

  if (!supplier) notFound()

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/marketplace/${supplierId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {supplier.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Place Order</h1>
          <p className="page-subtitle">{supplier.name}</p>
        </div>
      </div>

      <PlaceOrderForm
        supplierId={supplierId}
        supplierOrgId={(supplier as any).organisation_id ?? null}
        catalogueItems={catalogueItems as any[]}
        projects={projects as any[]}
      />
    </div>
  )
}
