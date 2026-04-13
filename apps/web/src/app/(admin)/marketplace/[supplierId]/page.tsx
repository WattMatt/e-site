import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { supplierService, formatZAR } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { OrderButton } from './OrderButton'

interface Props { params: Promise<{ supplierId: string }> }

function groupByCategory(items: any[]) {
  return items.reduce((acc: Record<string, any[]>, item) => {
    const cat = item.category ?? 'general'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})
}

export default async function SupplierDetailPage({ params }: Props) {
  const { supplierId } = await params
  const supabase = await createClient()

  const [supplier, items] = await Promise.all([
    supplierService.getById(supabase as any, supplierId).catch(() => null),
    supplierService.getCatalogueItems(supabase as any, supplierId).catch(() => []),
  ])

  if (!supplier) notFound()

  const grouped = groupByCategory(items)
  const contacts = (supplier as any).supplier_contacts ?? []

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link href="/marketplace" className="text-slate-400 hover:text-white text-sm">← Marketplace</Link>
      </div>

      <PageHeader
        title={supplier.name}
        subtitle={supplier.trading_name && supplier.trading_name !== supplier.name ? supplier.trading_name : undefined}
        actions={
          supplier.is_verified ? (
            <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-700 px-3 py-1 rounded-full">✓ Verified Supplier</span>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Supplier info */}
        <Card>
          <CardBody className="space-y-3">
            <h3 className="font-semibold text-white">Details</h3>
            {[
              ['Province', (supplier as any).province],
              ['Registration', (supplier as any).registration_no],
              ['VAT', (supplier as any).vat_number],
              ['Website', (supplier as any).website],
            ].map(([label, value]) =>
              value ? (
                <div key={label as string}>
                  <p className="text-xs text-slate-400">{label}</p>
                  {label === 'Website' ? (
                    <a href={value as string} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:underline">{value}</a>
                  ) : (
                    <p className="text-sm text-white">{value}</p>
                  )}
                </div>
              ) : null
            )}
            {(supplier as any).categories?.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 mb-1">Categories</p>
                <div className="flex flex-wrap gap-1">
                  {(supplier as any).categories.map((c: string) => (
                    <span key={c} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded capitalize">{c}</span>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Contacts */}
        {contacts.length > 0 && (
          <Card className="lg:col-span-2">
            <CardBody>
              <h3 className="font-semibold text-white mb-3">Contacts</h3>
              <div className="space-y-3">
                {contacts.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {c.full_name?.[0] ?? '?'}
                    </div>
                    <div>
                      <p className="text-sm text-white font-medium">{c.full_name}</p>
                      <p className="text-xs text-slate-400">{c.role} · {c.email}</p>
                      {c.phone && <p className="text-xs text-slate-500">{c.phone}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Catalogue */}
      {items.length === 0 ? (
        <p className="text-slate-400 text-sm py-8 text-center">No catalogue items available for this supplier.</p>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-white mb-4">Catalogue ({items.length} items)</h2>
          <div className="space-y-6">
            {Object.entries(grouped).map(([category, catItems]) => (
              <div key={category}>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3 capitalize">{category}</h3>
                <div className="space-y-2">
                  {catItems.map((item: any) => (
                    <Card key={item.id}>
                      <CardBody>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-white text-sm">{item.name}</p>
                              {item.sku && <span className="text-xs text-slate-500 font-mono">{item.sku}</span>}
                            </div>
                            {item.description && <p className="text-xs text-slate-400 mt-1">{item.description}</p>}
                            <div className="flex gap-4 mt-2 text-xs text-slate-500">
                              <span>Unit: {item.unit}</span>
                              {item.min_order_qty > 1 && <span>Min order: {item.min_order_qty}</span>}
                              {item.lead_time_days && <span>Lead time: {item.lead_time_days}d</span>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-bold text-white">{formatZAR(item.unit_price)}</p>
                            <p className="text-xs text-slate-400">per {item.unit}</p>
                            <OrderButton
                              supplierId={supplierId}
                              supplierOrgId={(supplier as any).organisation_id}
                              item={item}
                            />
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
