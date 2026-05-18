import { createClient } from '@/lib/supabase/server'
import { enrichScheduleItems, itemsForStage, type EnrichedItem } from '@esite/shared'
import { MaterialsTable, type Column } from '../_components/MaterialsTable'
import { QuoteUploadForm } from '../_components/QuoteUploadForm'
import { QuoteCompareTable, type QuoteRow } from '../_components/QuoteCompareTable'

export const dynamic = 'force-dynamic'

export default async function QuoteStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const supabase = await createClient()

  let all: EnrichedItem[] = []
  try {
    all = await enrichScheduleItems(supabase, projectId)
  } catch {
    all = []
  }
  const items = itemsForStage(all, 'quote')

  // Suppliers list scoped to the user's org via RLS. The project gives us the org via items[0].organisation_id.
  const orgId = items[0]?.organisation_id
  let suppliers: { id: string; name: string }[] = []
  if (orgId) {
    const { data } = await (supabase as any)
      .schema('suppliers')
      .from('suppliers')
      .select('id, name')
      .eq('organisation_id', orgId)
      .order('name')
    suppliers = (data ?? []) as { id: string; name: string }[]
  }
  const suppliersById: Record<string, string> = Object.fromEntries(suppliers.map((s) => [s.id, s.name]))

  const columns: Column[] = [
    { key: 'code', label: 'Code', width: '6rem', cell: (i) => i.item_code ?? '—' },
    { key: 'description', label: 'Description', cell: (i) => i.description },
    {
      key: 'qty',
      label: 'Qty',
      align: 'right',
      width: '6rem',
      cell: (i) => `${i.quantity} ${i.unit ?? ''}`,
    },
    {
      key: 'est',
      label: 'Est. cost',
      align: 'right',
      width: '8rem',
      cell: (i) =>
        i.estimated_unit_cost != null
          ? `R ${(Number(i.estimated_unit_cost) * Number(i.quantity)).toFixed(2)}`
          : '—',
    },
    {
      key: 'quotes',
      label: 'Quotes',
      align: 'right',
      width: '6rem',
      cell: (i) => String(i.procurement_items.flatMap((p) => p.procurement_quotes).length),
    },
  ]

  return (
    <MaterialsTable
      items={items}
      columns={columns}
      primaryStage="quote"
      expand={(item) => {
        const pi = item.procurement_items[0]
        if (!pi) {
          return (
            <p style={{ color: 'var(--c-text-dim)' }}>
              No procurement row yet — this item is still pre-quote.
            </p>
          )
        }
        const quotes = pi.procurement_quotes as unknown as QuoteRow[]
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <QuoteUploadForm
              procurementItemId={pi.id}
              organisationId={pi.organisation_id}
              suppliers={suppliers}
            />
            <QuoteCompareTable
              procurementItemId={pi.id}
              quotes={quotes}
              selectedQuoteId={pi.selected_quote_id}
              suppliersById={suppliersById}
            />
            {item.procurement_items.length > 1 && (
              <p
                style={{
                  color: 'var(--c-text-dim)',
                  fontSize: '0.75rem',
                  fontStyle: 'italic',
                }}
              >
                Note: this schedule item has {item.procurement_items.length} procurement rows linked. Showing the first.
              </p>
            )}
          </div>
        )
      }}
      emptyMessage="No items awaiting quotes."
    />
  )
}
