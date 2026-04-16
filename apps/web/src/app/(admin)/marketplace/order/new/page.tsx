import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { supplierService, projectService, formatZAR } from '@esite/shared'
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
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href={`/marketplace/${supplierId}`} className="text-slate-400 hover:text-white text-sm">
          ← {supplier.name}
        </Link>
      </div>

      <h1 className="text-xl font-bold text-white mb-1">Place Order</h1>
      <p className="text-sm text-slate-400 mb-6">{supplier.name}</p>

      <PlaceOrderForm
        supplierId={supplierId}
        supplierOrgId={(supplier as any).organisation_id ?? null}
        catalogueItems={catalogueItems as any[]}
        projects={projects as any[]}
      />
    </div>
  )
}
