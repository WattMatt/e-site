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
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catalogue</h1>
          <p className="page-subtitle">
            {catalogueItems.length} items · {visibleCount} visible in marketplace
          </p>
        </div>
        <Link
          href="/supplier/catalogue/new"
          className="btn-primary-amber"
          style={{ fontSize: 13, padding: '9px 16px', fontWeight: 600 }}
        >
          + Add Item
        </Link>
      </div>

      {catalogueItems.length === 0 ? (
        <div className="data-panel animate-fadeup animate-fadeup-1">
          <div
            className="data-panel-empty"
            style={{ padding: '64px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}
          >
            <div style={{ fontSize: 40 }}>📦</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>No catalogue items yet</p>
            <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Add items to appear in the E-Site marketplace.</p>
            <Link
              href="/supplier/catalogue/new"
              className="btn-primary-amber"
              style={{ marginTop: 8, fontSize: 13, padding: '8px 16px', fontWeight: 600 }}
            >
              Add First Item
            </Link>
          </div>
        </div>
      ) : (
        <div className="animate-fadeup animate-fadeup-1" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(grouped).map(([category, catItems]) => (
            <div key={category}>
              <h3
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--c-text-mid)',
                  marginBottom: 8,
                }}
              >
                {category}
              </h3>
              <div className="data-panel">
                {catItems.map((item) => (
                  <div
                    key={item.id}
                    className="data-panel-row"
                    style={{ alignItems: 'flex-start', gap: 16 }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{item.name}</p>
                        {item.sku && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                            {item.sku}
                          </span>
                        )}
                        {!item.is_active && <span className="badge badge-muted">Inactive</span>}
                      </div>
                      {item.description && (
                        <p
                          style={{
                            fontSize: 11,
                            color: 'var(--c-text-dim)',
                            marginTop: 4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.description}
                        </p>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          gap: 14,
                          marginTop: 6,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--c-text-dim)',
                        }}
                      >
                        <span>{item.unit}</span>
                        {item.min_order_qty > 1 && <span>Min: {item.min_order_qty}</span>}
                        {item.lead_time_days && <span>Lead: {item.lead_time_days}d</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
                          {formatZAR(item.unit_price)}
                        </p>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                          per {item.unit}
                        </p>
                      </div>
                      <ToggleVisibilityButton itemId={item.id} visible={item.marketplace_visible} />
                      <Link
                        href={`/supplier/catalogue/${item.id}`}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          padding: '5px 10px',
                          borderRadius: 4,
                          background: 'var(--c-elevated)',
                          color: 'var(--c-text-mid)',
                          border: '1px solid var(--c-border)',
                          textDecoration: 'none',
                        }}
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
