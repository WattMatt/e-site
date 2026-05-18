import Link from 'next/link'
import { StageCounter } from './_components/StageCounter'
import { createClient } from '@/lib/supabase/server'
import {
  enrichScheduleItems,
  getStageCounts,
  itemsForStage,
  STAGES,
  type Stage,
} from '@esite/shared'

export const dynamic = 'force-dynamic'

const STAGE_META: Record<Stage, { label: string; description: string }> = {
  plan: { label: 'Plan', description: 'Equipment schedule — engineer-authored BOM' },
  quote: { label: 'Quote', description: 'Items awaiting or comparing quotes' },
  order: { label: 'Order', description: 'POs in progress + shop drawings' },
  deliver: { label: 'Deliver', description: 'Goods received notes pending' },
  pay: { label: 'Pay', description: 'Supplier invoices to process' },
}

export default async function MaterialsHub({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const supabase = await createClient()

  let items: Awaited<ReturnType<typeof enrichScheduleItems>> = []
  try {
    items = await enrichScheduleItems(supabase, projectId)
  } catch {
    items = []
  }
  const counts = getStageCounts(items)

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <h1 className="page-title">Materials</h1>
        <p className="page-subtitle">{items.length} item(s) across {STAGES.length} stages</p>
      </div>
      <div
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        {STAGES.map((stage) => (
          <Link
            key={stage}
            href={`/projects/${projectId}/materials/${stage}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <StageCounter
              stage={stage}
              label={STAGE_META[stage].label}
              description={STAGE_META[stage].description}
              count={counts[stage]}
              recent={itemsForStage(items, stage)
                .slice(0, 3)
                .map((i) => ({
                  id: i.id,
                  label: `${i.item_code ?? '—'} · ${i.description}`,
                }))}
            />
          </Link>
        ))}
        <article className="data-panel" style={{ padding: '1rem' }}>
          <h3 className="data-panel-title" style={{ margin: '0 0 0.5rem' }}>
            Recent activity
          </h3>
          <p style={{ color: 'var(--c-text-dim)', fontSize: '0.875rem', margin: 0 }}>
            v2 — placeholder for the most recent stage transitions.
          </p>
        </article>
      </div>
    </div>
  )
}
