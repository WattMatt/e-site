import { createClient } from '@/lib/supabase/server'
import { enrichScheduleItems, itemsForStage, type EnrichedItem } from '@esite/shared'
import { MaterialsTable, type Column } from '../_components/MaterialsTable'
import { GRNPanel, type GRNRow } from '../_components/GRNPanel'
import { RequisitionPhotos } from '../_components/RequisitionPhotos'

export const dynamic = 'force-dynamic'

export default async function DeliverStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const supabase = await createClient()

  let all: EnrichedItem[] = []
  try {
    all = await enrichScheduleItems(supabase, projectId)
  } catch {
    all = []
  }
  const items = itemsForStage(all, 'deliver')

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
      key: 'grn',
      label: 'GRN',
      width: '10rem',
      cell: (i) => {
        const gs = i.procurement_items.flatMap((p) => p.goods_received_notes)
        if (gs.length === 0) return '—'
        const totalRcvd = gs.reduce((s, g) => s + Number(g.quantity_received ?? 0), 0)
        const piQty = i.procurement_items[0]?.quantity ?? null
        return `${totalRcvd}${piQty != null ? ` / ${piQty}` : ''}`
      },
    },
  ]

  return (
    <MaterialsTable
      items={items}
      columns={columns}
      primaryStage="deliver"
      expand={(item) => {
        const pi = item.procurement_items[0]
        if (!pi) return <p style={{ color: 'var(--c-text-dim)' }}>No procurement row.</p>
        const grns = pi.goods_received_notes as unknown as GRNRow[]
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <GRNPanel
              procurementItemId={pi.id}
              organisationId={pi.organisation_id}
              procurementUnit={pi.unit ?? null}
              procurementQuantity={pi.quantity ?? null}
              grns={grns}
            />
            <RequisitionPhotos photoPaths={pi.photo_paths ?? []} />
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
      emptyMessage="No items in delivery. Items appear here once a PO is open and goods are en route."
    />
  )
}
