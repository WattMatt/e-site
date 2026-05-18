import { createClient } from '@/lib/supabase/server'
import { enrichScheduleItems, itemsForStage, type EnrichedItem } from '@esite/shared'
import { MaterialsTable, type Column } from '../_components/MaterialsTable'
import { SupplierInvoicePanel, type SupplierInvoiceRow } from '../_components/SupplierInvoicePanel'

export const dynamic = 'force-dynamic'

export default async function PayStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const supabase = await createClient()

  let all: EnrichedItem[] = []
  try {
    all = await enrichScheduleItems(supabase, projectId)
  } catch {
    all = []
  }
  const items = itemsForStage(all, 'pay')

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
      key: 'invoice',
      label: 'Invoice',
      width: '12rem',
      cell: (i) => {
        const inv = i.procurement_items.flatMap((p) => p.supplier_invoices)
        if (inv.length === 0) return '—'
        return inv.map((x) => `${x.invoice_number} (${x.status})`).join(', ')
      },
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      width: '8rem',
      cell: (i) => {
        const inv = i.procurement_items.flatMap((p) => p.supplier_invoices)
        if (inv.length === 0) return '—'
        const total = inv.reduce((s, x) => s + Number(x.amount ?? 0), 0)
        return `R ${total.toFixed(2)}`
      },
    },
  ]

  return (
    <MaterialsTable
      items={items}
      columns={columns}
      primaryStage="pay"
      expand={(item) => {
        const pi = item.procurement_items[0]
        if (!pi) return <p style={{ color: 'var(--c-text-dim)' }}>No procurement row.</p>
        const invoices = pi.supplier_invoices as unknown as SupplierInvoiceRow[]
        const expectedTotal =
          pi.quantity != null && pi.quoted_price != null
            ? Number(pi.quantity) * Number(pi.quoted_price)
            : null
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <SupplierInvoicePanel
              procurementItemId={pi.id}
              organisationId={pi.organisation_id}
              invoices={invoices}
              expectedTotal={expectedTotal}
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
      emptyMessage="No supplier invoices to process."
    />
  )
}
