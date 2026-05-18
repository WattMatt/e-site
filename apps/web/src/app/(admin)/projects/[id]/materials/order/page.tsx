import { createClient } from '@/lib/supabase/server'
import { enrichScheduleItems, itemsForStage, type EnrichedItem } from '@esite/shared'
import { MaterialsTable, type Column } from '../_components/MaterialsTable'
import { POButton } from '../_components/POButton'
import { ShopDrawingsPanel, type ShopDrawingRow } from '../_components/ShopDrawingsPanel'

export const dynamic = 'force-dynamic'

export default async function OrderStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const supabase = await createClient()

  let all: EnrichedItem[] = []
  try {
    all = await enrichScheduleItems(supabase, projectId)
  } catch {
    all = []
  }
  const items = itemsForStage(all, 'order')

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
      key: 'po',
      label: 'PO',
      width: '8rem',
      cell: (i) => i.procurement_items.map((p) => p.po_number ?? '—').join(', ') || '—',
    },
    {
      key: 'shop',
      label: 'Shop dwg',
      align: 'center',
      width: '6rem',
      cell: (i) => (i.shop_drawing_required ? 'required' : '—'),
    },
  ]

  return (
    <MaterialsTable
      items={items}
      columns={columns}
      primaryStage="order"
      expand={(item) => {
        const pi = item.procurement_items[0]
        if (!pi) return <p style={{ color: 'var(--c-text-dim)' }}>No procurement row.</p>
        const drawings = pi.shop_drawings as unknown as ShopDrawingRow[]
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <POButton
              procurementItemId={pi.id}
              disabled={!pi.selected_quote_id}
              disabledReason={pi.selected_quote_id ? undefined : 'Select a winning quote first.'}
            />
            {item.shop_drawing_required && (
              <ShopDrawingsPanel
                procurementItemId={pi.id}
                organisationId={pi.organisation_id}
                drawings={drawings}
              />
            )}
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
      emptyMessage="No items awaiting orders. Accept a quote in Quote stage to move an item here."
    />
  )
}
