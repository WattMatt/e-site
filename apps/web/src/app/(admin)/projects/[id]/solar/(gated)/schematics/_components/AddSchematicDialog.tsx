'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSchematicAction } from '@/actions/solar-schematics.actions'
import type { DrawingOption } from '@/lib/solar/schematics/view-types'
import { DrawingPagePicker } from './DrawingPagePicker'

/** Add schematic (spec §13.1): from a project drawing and page, or a blank canvas. */
export function AddSchematicDialog({ projectId, drawings, onClose }: { projectId: string; drawings: DrawingOption[]; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<'drawing' | 'blank'>(drawings.length > 0 ? 'drawing' : 'blank')
  const [pick, setPick] = useState({ floorPlanId: '', page: '1' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isPdf = drawings.find((d) => d.id === pick.floorPlanId)?.isPdf ?? false
  const page = isPdf ? Number(pick.page) : 1
  const ready = name.trim().length > 0 && (mode === 'blank' || (pick.floorPlanId !== '' && Number.isInteger(page) && page >= 1))
  return (
    <div role="dialog" aria-modal="true" aria-label="Add schematic" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, display: 'grid', gap: 10, fontSize: 13 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Add schematic</h2>
        <label>Name <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
        <label>Description <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <fieldset style={{ border: 'none', padding: 0 }}>
          <label><input type="radio" name="src" aria-label="From a project drawing" checked={mode === 'drawing'} disabled={drawings.length === 0} onChange={() => setMode('drawing')} /> From a project drawing</label>{' '}
          <label><input type="radio" name="src" aria-label="Blank canvas" checked={mode === 'blank'} onChange={() => setMode('blank')} /> Blank canvas</label>
        </fieldset>
        {mode === 'drawing' && <DrawingPagePicker drawings={drawings} floorPlanId={pick.floorPlanId} page={pick.page} onChange={setPick} />}
        {error && <p role="alert" style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!ready || busy} onClick={async () => {
            setBusy(true); setError(null)
            const r = await createSchematicAction({
              projectId, name: name.trim(), description: description.trim() || null,
              source: mode === 'blank' ? { kind: 'blank' } : { kind: 'drawing', floorPlanId: pick.floorPlanId, pageIndex: page },
            })
            setBusy(false)
            if ('error' in r) { setError(r.error); return }
            router.push(`/projects/${projectId}/solar/schematics/${r.id}`)
          }}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </div>
  )
}
