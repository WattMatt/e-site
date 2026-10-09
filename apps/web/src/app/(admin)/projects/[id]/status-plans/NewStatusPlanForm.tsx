'use client'

/**
 * "New status plan": pick drawing → page → purpose → name (spec §7).
 * The page number is typed, not picked: the PDF's page count is only known
 * once pdfjs opens it, and opening an A1 here would take 20-60 s. The canvas
 * says so if the page does not exist.
 */
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { PURPOSE_LABEL, STATUS_PLAN_PURPOSES, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { createStatusPlanAction } from '@/actions/status-plan.actions'
import { defaultPlanName, type DrawingOption } from '@/lib/status-plans/plan-list'
import { statusPlanHref } from '@/lib/status-plans/plan-urls'

const PURPOSE_HINT: Record<StatusPlanPurpose, string> = {
  tenant_layout: 'Mask each shop and area on an architectural tenant layout; shops colour by tenant progress.',
  distribution_schematic: 'Box each DB block on a 300-series schematic; blocks hatch by DB order status.',
}

export function NewStatusPlanForm({ projectId, drawings }: { projectId: string; drawings: DrawingOption[] }) {
  const router = useRouter()
  const usable = drawings.filter((d) => d.renderable)
  const [open, setOpen] = useState(false)
  const [drawingId, setDrawingId] = useState(usable[0]?.id ?? '')
  const [page, setPage] = useState('1')
  const [purpose, setPurpose] = useState<StatusPlanPurpose>('tenant_layout')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drawing = usable.find((d) => d.id === drawingId) ?? null
  const pageIndex = Number.parseInt(page, 10)
  const pageOk = Number.isInteger(pageIndex) && pageIndex >= 1
  const suggested = drawing ? defaultPlanName(drawing.name, purpose, pageOk ? pageIndex : 1) : ''
  const effectiveName = nameEdited ? name : suggested

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!drawing) { setError('Pick a drawing first.'); return }
    if (!pageOk) { setError('Enter a page number of 1 or more.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await createStatusPlanAction({ projectId, floorPlanId: drawing.id, pageIndex, purpose, name: effectiveName })
      if (!res.ok) { setError(res.error); return }
      router.push(statusPlanHref(projectId, res.data.id))
    } catch {
      setError('The server did not answer. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return <button type="button" className="btn-primary-amber" onClick={() => setOpen(true)}>+ New status plan</button>
  }

  if (usable.length === 0) {
    return (
      <div className="data-panel" style={{ padding: 12, fontSize: 13 }}>
        No drawing on this project can be shown here. Upload a PDF or image drawing under Floor Plans first.{' '}
        <button type="button" onClick={() => setOpen(false)} style={{ marginLeft: 8 }}>Close</button>
      </div>
    )
  }

  const label = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 } as const
  return (
    <form onSubmit={submit} className="data-panel" style={{ padding: 14, display: 'grid', gap: 12, maxWidth: 560 }}>
      <div>
        <label htmlFor="sp-drawing" style={label}>Drawing</label>
        <select id="sp-drawing" className="ob-input" value={drawingId} onChange={(e) => setDrawingId(e.target.value)} style={{ width: '100%' }}>
          {drawings.map((d) => (
            <option key={d.id} value={d.id} disabled={!d.renderable}>
              {d.name}{d.renderable ? '' : ' (not a PDF or image)'}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="sp-page" style={label}>Page</label>
        <input id="sp-page" className="ob-input" type="number" min={1} step={1} value={page} onChange={(e) => setPage(e.target.value)} style={{ width: 120 }} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={label}>Purpose</legend>
        {STATUS_PLAN_PURPOSES.map((p) => (
          <label key={p} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, marginBottom: 6 }}>
            <input type="radio" name="sp-purpose" value={p} checked={purpose === p} onChange={() => setPurpose(p)} />
            <span>
              <strong>{PURPOSE_LABEL[p]}</strong>
              <span style={{ display: 'block', color: 'var(--c-text-dim)', fontSize: 12 }}>{PURPOSE_HINT[p]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="sp-name" style={label}>Name</label>
        <input
          id="sp-name"
          className="ob-input"
          value={effectiveName}
          maxLength={120}
          onChange={(e) => { setNameEdited(true); setName(e.target.value) }}
          style={{ width: '100%' }}
        />
      </div>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 12, margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn-primary-amber" disabled={saving}>{saving ? 'Creating…' : 'Create plan'}</button>
        <button type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
      </div>
    </form>
  )
}
