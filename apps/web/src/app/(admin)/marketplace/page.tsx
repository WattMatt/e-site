import { createClient } from '@/lib/supabase/server'
import { supplierService } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import Link from 'next/link'

const CATEGORIES = ['electrical', 'mechanical', 'civil', 'safety', 'general']

interface Props { searchParams: Promise<{ category?: string; search?: string }> }

export default async function MarketplacePage({ searchParams }: Props) {
  const { category, search } = await searchParams
  const supabase = await createClient()
  const suppliers = await supplierService.listAll(supabase as any, {
    ...(category ? { category } : {}),
    ...(search ? { search } : {}),
  }).catch(() => [])

  return (
    <div>
      <PageHeader
        title="Supplier Marketplace"
        subtitle="Browse verified electrical & construction suppliers"
        actions={
          <Link
            href="/marketplace/orders"
            className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
          >
            My Orders
          </Link>
        }
      />

      {/* Search bar */}
      <form method="GET" action="/marketplace" className="mb-4">
        <div className="flex gap-2 max-w-md">
          <input
            name="search"
            type="search"
            defaultValue={search ?? ''}
            placeholder="Search suppliers by name…"
            className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
          {category && <input type="hidden" name="category" value={category} />}
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Search
          </button>
          {(search || category) && (
            <Link
              href="/marketplace"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition-colors"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* Category filter */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <Link
          href="/marketplace"
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${!category ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
        >
          All
        </Link>
        {CATEGORIES.map(c => (
          <Link
            key={c}
            href={`/marketplace?category=${c}`}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${category === c ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            {c}
          </Link>
        ))}
      </div>

      {suppliers.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center gap-3">
          <div className="text-5xl">🏪</div>
          <p className="text-white font-semibold text-lg">No suppliers found</p>
          <p className="text-slate-400 text-sm">Verified suppliers will appear here as they join the platform.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {suppliers.map((s: any) => (
            <Link key={s.id} href={`/marketplace/${s.id}`}>
              <Card className="hover:border-blue-500 transition-colors cursor-pointer h-full">
                <CardBody className="h-full flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="font-semibold text-white">{s.name}</p>
                      {s.trading_name && s.trading_name !== s.name && (
                        <p className="text-xs text-slate-400">{s.trading_name}</p>
                      )}
                    </div>
                    {s.is_verified && (
                      <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-700 px-2 py-0.5 rounded-full whitespace-nowrap">Verified</span>
                    )}
                  </div>
                  {s.province && <p className="text-xs text-slate-500 mb-3">{s.province}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-auto">
                    {(s.categories ?? []).map((c: string) => (
                      <span key={c} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded capitalize">{c}</span>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
