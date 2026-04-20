import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supplierService, formatZAR } from '@esite/shared'
import Link from 'next/link'
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

  const [supplier, items, ratingSummary] = await Promise.all([
    supplierService.getById(supabase as any, supplierId).catch(() => null),
    supplierService.getCatalogueItems(supabase as any, supplierId).catch(() => []),
    (supabase as any)
      .schema('marketplace')
      .from('supplier_rating_summary')
      .select('*')
      .eq('supplier_id', supplierId)
      .single()
      .then((r: any) => r.data ?? null)
      .catch(() => null),
  ])

  if (!supplier) notFound()

  const grouped = groupByCategory(items)
  const contacts = (supplier as any).supplier_contacts ?? []

  return (
    <div className="animate-fadeup" style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/marketplace"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Marketplace
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{supplier.name}</h1>
          {supplier.trading_name && supplier.trading_name !== supplier.name && (
            <p className="page-subtitle">{supplier.trading_name}</p>
          )}
        </div>
        {supplier.is_verified && (
          <span className="badge badge-green">✓ Verified Supplier</span>
        )}
      </div>

      {/* Aggregate ratings */}
      {ratingSummary && (
        <div className="data-panel animate-fadeup animate-fadeup-1" style={{ marginBottom: 16 }}>
          <div style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--c-amber)' }}>{ratingSummary.avg_overall}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginLeft: 6 }}>/ 5.0</span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
                {ratingSummary.rating_count} review{ratingSummary.rating_count !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              {[
                { label: 'Delivery', score: ratingSummary.avg_delivery },
                { label: 'Quality', score: ratingSummary.avg_quality },
                { label: 'Communication', score: ratingSummary.avg_communication },
                { label: 'Pricing', score: ratingSummary.avg_pricing },
              ].map(({ label, score }) => (
                <div
                  key={label}
                  style={{
                    background: 'var(--c-elevated)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 6,
                    padding: '8px 12px',
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 2 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)' }}>
                    {score} <span style={{ color: 'var(--c-amber)', fontSize: 11 }}>★</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: contacts.length > 0 ? '1fr 2fr' : '1fr', gap: 14, marginBottom: 24 }}>
        {/* Supplier info */}
        <div className="data-panel animate-fadeup animate-fadeup-1">
          <div className="data-panel-header">
            <span className="data-panel-title">Details</span>
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              ['Province', (supplier as any).province],
              ['Registration', (supplier as any).registration_no],
              ['VAT', (supplier as any).vat_number],
              ['Website', (supplier as any).website],
            ].map(([label, value]) =>
              value ? (
                <div key={label as string}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 2 }}>
                    {label}
                  </div>
                  {label === 'Website' ? (
                    <a
                      href={value as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'none' }}
                    >
                      {value}
                    </a>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--c-text)' }}>{value}</div>
                  )}
                </div>
              ) : null
            )}
            {(supplier as any).categories?.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 6 }}>
                  Categories
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(supplier as any).categories.map((c: string) => (
                    <span
                      key={c}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        padding: '2px 7px',
                        borderRadius: 2,
                        background: 'var(--c-elevated)',
                        color: 'var(--c-text-dim)',
                        border: '1px solid var(--c-border-mid)',
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Contacts */}
        {contacts.length > 0 && (
          <div className="data-panel animate-fadeup animate-fadeup-1">
            <div className="data-panel-header">
              <span className="data-panel-title">Contacts</span>
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {contacts.map((c: any) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--c-amber)',
                    flexShrink: 0,
                  }}>
                    {c.full_name?.[0] ?? '?'}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{c.full_name}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                      {c.role} · {c.email}
                    </div>
                    {c.phone && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        {c.phone}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Catalogue */}
      {items.length === 0 ? (
        <div className="data-panel animate-fadeup animate-fadeup-2">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            No catalogue items available for this supplier.
          </div>
        </div>
      ) : (
        <div className="animate-fadeup animate-fadeup-2">
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 12 }}>
            Catalogue ({items.length} items)
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {Object.entries(grouped).map(([category, catItems]) => (
              <div key={category}>
                <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-mid)', marginBottom: 8 }}>
                  {category}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {catItems.map((item: any) => (
                    <div key={item.id} className="data-panel">
                      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{item.name}</p>
                            {item.sku && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                                {item.sku}
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
                              {item.description}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                            <span>Unit: {item.unit}</span>
                            {item.min_order_qty > 1 && <span>Min: {item.min_order_qty}</span>}
                            {item.lead_time_days && <span>Lead: {item.lead_time_days}d</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)' }}>
                            {formatZAR(item.unit_price)}
                          </p>
                          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                            per {item.unit}
                          </p>
                          <OrderButton
                            supplierId={supplierId}
                            supplierOrgId={(supplier as any).organisation_id ?? undefined}
                            item={{
                              id: item.id,
                              name: item.name,
                              unit: item.unit,
                              unit_price: item.unit_price,
                              min_order_qty: item.min_order_qty ?? 1,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
