'use client'
/**
 * Replace drawing (spec §13.1): re-anchor to a new file/page; card positions are kept and may need
 * adjusting. Two-step inline confirm — the first press arms, the second replaces.
 */
import { useState } from 'react'
import { replaceSchematicDrawingAction } from '@/actions/solar-schematics.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import type { DrawingOption } from '@/lib/solar/schematics/view-types'
import { DrawingPagePicker } from './DrawingPagePicker'

export function ReplaceDrawingDialog({ projectId, schematicId, expectedUpdatedAt, drawings, onDone, onClose }: {
  projectId: string; schematicId: string; expectedUpdatedAt: string; drawings: DrawingOption[]
  onDone: (updatedAt: string) => void; onClose: () => void
}) {
  const [pick, setPick] = useState({ floorPlanId: '', page: '1' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = useArmedConfirm()
  const isPdf = drawings.find((d) => d.id === pick.floorPlanId)?.isPdf ?? false
  const page = isPdf ? Number(pick.page) : 1
  const ready = !busy && pick.floorPlanId !== '' && Number.isInteger(page) && page >= 1
  return (
    <div role="dialog" aria-modal="true" aria-label="Replace drawing" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 520, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, display: 'grid', gap: 10, fontSize: 13 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Replace drawing</h2>
        <p style={{ margin: 0, color: 'var(--c-amber)' }}>Meter cards keep their positions; positions may need adjusting on the new sheet.</p>
        <DrawingPagePicker drawings={drawings} floorPlanId={pick.floorPlanId} page={pick.page} onChange={(v) => { confirm.disarm(); setPick(v) }} />
        {error && <p role="alert" style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          {!confirm.armed
            ? <button type="button" disabled={!ready} onClick={confirm.arm}>{busy ? 'Replacing…' : 'Replace'}</button>
            : <button type="button" style={{ color: '#dc2626' }} disabled={!ready} onClick={async () => {
                confirm.disarm(); setBusy(true); setError(null)
                const r = await replaceSchematicDrawingAction({ projectId, schematicId, floorPlanId: pick.floorPlanId, pageIndex: page, expectedUpdatedAt })
                setBusy(false)
                if ('error' in r) setError(r.error); else onDone(r.updatedAt)
              }}>Replace the drawing?</button>}
        </div>
      </div>
    </div>
  )
}
