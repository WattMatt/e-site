import { createClient } from '@/lib/supabase/server'
import { supplierService } from '@esite/shared'
import Link from 'next/link'

const CATEGORIES = ['electrical', 'mechanical', 'civil', 'safety', 'general']

const CATEGORY_ICONS: Record<string, string> = {
  electrical: '⚡',
  mechanical: '⚙',
  civil: '🏗',
  safety: '🦺',
  general: '📦',
}

interface Props { searchParams: Promise<{ category?: string; search?: string }> }

export default async function MarketplacePage({ searchParams }: Props) {
  const { category, search } = await searchParams
  const supabase = await createClient()
  const suppliers = await supplierService.listAll(supabase as any, {
    ...(category ? { category } : {}),
    ...(search ? { search } : {}),
  }).catch(() => [])

  return (
    <div className="animate-fadeup">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Supplier Marketplace</h1>
          <p className="page-subtitle">Browse verified electrical & construction suppliers</p>
        </div>
        <Link
          href="/marketplace/orders"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-text-mid)',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'all 0.15s',
          }}
        >
          My Orders
        </Link>
      </div>

      {/* Search + filter row */}
      <div className="animate-fadeup animate-fadeup-1" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <form method="GET" action="/marketplace" style={{ display: 'flex', gap: 8, flex: '1 1 300px', maxWidth: 500 }}>
          <input
            name="search"
            type="search"
            defaultValue={search ?? ''}
            placeholder="Search suppliers by name…"
            className="search-input"
            style={{ flex: 1 }}
          />
          {category && <input type="hidden" name="category" value={category} />}
          <button type="submit" className="search-btn">Search</button>
          {(search || category) && (
            <Link
              href="/marketplace"
              style={{
                padding: '9px 14px',
                background: 'var(--c-panel)',
                border: '1px solid var(--c-border)',
                color: 'var(--c-text-mid)',
                borderRadius: 6,
                fontSize: 12,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {/* Category pills */}
      <div className="animate-fadeup animate-fadeup-1" style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
        <Link href="/marketplace" className={`category-pill${!category ? ' active' : ''}`}>
          All
        </Link>
        {CATEGORIES.map(c => (
          <Link
            key={c}
            href={`/marketplace?category=${c}`}
            className={`category-pill${category === c ? ' active' : ''}`}
          >
            {CATEGORY_ICONS[c]} {c}
          </Link>
        ))}
      </div>

      {/* Results */}
      {suppliers.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '80px 24px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            textAlign: 'center',
            gap: 12,
          }}
        >
          <div style={{
            width: 48, height: 48,
            background: 'var(--c-elevated)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}>🏪</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', marginBottom: 6 }}>No suppliers found</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.04em' }}>
              Verified suppliers will appear here as they join the platform
            </div>
          </div>
        </div>
      ) : (
        <div
          className="animate-fadeup animate-fadeup-2"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}
        >
          {suppliers.map((s: any) => (
            <Link key={s.id} href={`/marketplace/${s.id}`} className="supplier-card bracket-card">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', lineHeight: 1.2 }}>{s.name}</div>
                  {s.trading_name && s.trading_name !== s.name && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                      {s.trading_name}
                    </div>
                  )}
                </div>
                {s.is_verified && (
                  <span className="badge badge-green" style={{ flexShrink: 0 }}>Verified</span>
                )}
              </div>

              {s.province && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginBottom: 12, letterSpacing: '0.04em' }}>
                  📍 {s.province}
                </div>
              )}

              <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {(s.categories ?? []).map((c: string) => (
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
                    {CATEGORY_ICONS[c] ?? ''} {c}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
