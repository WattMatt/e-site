import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatZAR } from '@esite/shared'
import { ToggleVisibilityButton } from './ToggleVisibilityButton'

export default async function SupplierCataloguePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/supplier/catalogue')

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
    .select('id')
    .eq('organisation_id', mem.organisation_id)
    .limit(1)
    .maybeSingle()

  if (!supplier) redirect('/supplier/profile')

  const { data: items } = await supabase
    .schema('marketplace')
    .from('catalogue_items')
    .select('*')
    .eq('supplier_id', supplier.id)
    .order('category')
    .order('name')

  const catalogueItems = items ?? []
  const visibleCount = catalogueItems.filter(i => i.marketplace_visible).length

  // Group by category
  const grouped = catalogueItems.reduce<Record<string, typeof catalogueItems>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Catalogue</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {catalogueItems.length} items · {visibleCount} visible in marketplace
          </p>
        </div>
        <Link
          href="/supplier/catalogue/new"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          + Add Item
        </Link>
      </div>

      {catalogueItems.length === 0 ? (
        <div className="flex flex-col items-center py-24 gap-3 text-center border border-dashed border-slate-700 rounded-xl">
          <div className="text-5xl">📦</div>
          <p className="text-white font-semibold">No catalogue items yet</p>
          <p className="text-slate-400 text-sm">Add items to appear in the E-Site marketplace.</p>
          <Link
            href="/supplier/catalogue/new"
            className="mt-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Add First Item
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, catItems]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 capitalize">{category}</h3>
              <div className="space-y-2">
                {catItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-4 p-4 bg-slate-800 border border-slate-700 rounded-xl"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white text-sm">{item.name}</p>
                        {item.sku && <span className="text-xs text-slate-500 font-mono">{item.sku}</span>}
                        {!item.is_active && <span className="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">Inactive</span>}
                      </div>
                      {item.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{item.description}</p>}
                      <div className="flex gap-4 mt-1.5 text-xs text-slate-500">
                        <span>{item.unit}</span>
                        {item.min_order_qty > 1 && <span>Min: {item.min_order_qty}</span>}
                        {item.lead_time_days && <span>Lead: {item.lead_time_days}d</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="font-bold text-white text-sm">{formatZAR(item.unit_price)}</p>
                        <p className="text-xs text-slate-400">per {item.unit}</p>
                      </div>
                      <ToggleVisibilityButton
                        itemId={item.id}
                        visible={item.marketplace_visible}
                      />
                      <Link
                        href={`/supplier/catalogue/${item.id}`}
                        className="text-xs px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
                      >
                        Edit
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
