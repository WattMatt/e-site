import { createClient } from '@/lib/supabase/server'
import { enrichScheduleItems, itemsForStage, type EnrichedItem } from '@esite/shared'
import { MaterialsTable, type Column } from '../_components/MaterialsTable'
import { AddScheduleItemForm } from '../_components/AddScheduleItemForm'
import { ScheduleRow } from '../_components/ScheduleRow'

export const dynamic = 'force-dynamic'

export default async function PlanStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const supabase = await createClient()

  let all: EnrichedItem[] = []
  try {
    all = await enrichScheduleItems(supabase, projectId)
  } catch {
    all = []
  }
  const items = itemsForStage(all, 'plan')

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
      label: 'Est. unit cost',
      align: 'right',
      width: '8rem',
      cell: (i) => (i.estimated_unit_cost != null ? `R ${Number(i.estimated_unit_cost).toFixed(2)}` : '—'),
    },
    {
      key: 'shop',
      label: 'Shop dwg',
      align: 'center',
      width: '6rem',
      cell: (i) => (i.shop_drawing_required ? '✓' : ''),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <AddScheduleItemForm projectId={projectId} />
      <MaterialsTable
        items={items}
        columns={columns}
        primaryStage="plan"
        expand={(item) => <ScheduleRow id={item.id} currentStatus={item.status} />}
        emptyMessage="No items in planning. Add equipment with the form above."
      />
    </div>
  )
}
