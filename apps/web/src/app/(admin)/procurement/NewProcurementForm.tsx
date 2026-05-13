'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export interface ScheduleStub {
  id: string
  project_id: string
  item_code: string | null
  description: string
  quantity: number
  unit: string | null
}

export function NewProcurementForm({
  orgId, userId, projects, defaultProjectId, scheduleItems = [],
}: {
  orgId: string
  userId: string
  projects: { id: string; name: string }[]
  defaultProjectId?: string
  scheduleItems?: ScheduleStub[]
}) {
  const router = useRouter()
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '')
  const [scheduleItemId, setScheduleItemId] = useState<string>('')
  const [requiredBy, setRequiredBy] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter schedule lines to the currently-selected project. Reset the
  // selection if the user switches project and the chosen line no longer
  // applies.
  const scheduleOptions = useMemo(
    () => scheduleItems.filter((s) => s.project_id === projectId),
    [scheduleItems, projectId],
  )

  function onProjectChange(next: string) {
    setProjectId(next)
    // If switching project invalidates the schedule line, clear it.
    if (scheduleItemId && !scheduleItems.some((s) => s.id === scheduleItemId && s.project_id === next)) {
      setScheduleItemId('')
    }
  }

  function onScheduleChange(id: string) {
    setScheduleItemId(id)
    // Auto-fill from the schedule line if the user picks one and fields
    // are still empty. Saves typing for the common case.
    if (!id) return
    const line = scheduleItems.find((s) => s.id === id)
    if (!line) return
    if (!description.trim()) {
      setDescription(line.item_code
        ? `${line.item_code} — ${line.description}`
        : line.description)
    }
    if (!quantity) setQuantity(String(Number(line.quantity)))
    if (!unit && line.unit) setUnit(line.unit)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) { setError('Description is required'); return }
    if (!projectId) { setError('Select a project'); return }
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const { error: err } = await supabase
      .schema('projects')
      .from('procurement_items')
      .insert({
        project_id: projectId,
        organisation_id: orgId,
        created_by: userId,
        description: description.trim(),
        quantity: quantity ? Number(quantity) : null,
        unit: unit || null,
        required_by: requiredBy || null,
        notes: notes || null,
        status: 'draft',
        schedule_item_id: scheduleItemId || null,
      })

    if (err) { setError(err.message); setSaving(false); return }
    setDescription(''); setQuantity(''); setUnit(''); setRequiredBy(''); setNotes('')
    setScheduleItemId('')
    router.refresh()
    setSaving(false)
  }

  return (
    <div className="data-panel">
      <div className="data-panel-header">
        <span className="data-panel-title">New Requisition</span>
      </div>
      <div style={{ padding: '16px 18px' }}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="ob-label">Description *</label>
            <input className="ob-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. 25mm conduit 3m lengths" />
          </div>
          <div>
            <label className="ob-label">Project *</label>
            <select className="ob-select" value={projectId} onChange={e => onProjectChange(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {scheduleOptions.length > 0 && (
            <div>
              <label className="ob-label">Link to schedule line (optional)</label>
              <select
                className="ob-select"
                value={scheduleItemId}
                onChange={(e) => onScheduleChange(e.target.value)}
              >
                <option value="">(ad-hoc — not on the engineer's schedule)</option>
                {scheduleOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.item_code ? `${s.item_code} — ` : ''}{s.description} ({Number(s.quantity)}{s.unit ? ` ${s.unit}` : ''})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label className="ob-label">Qty</label>
              <input className="ob-input" type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="50" />
            </div>
            <div>
              <label className="ob-label">Unit</label>
              <input className="ob-input" value={unit} onChange={e => setUnit(e.target.value)} placeholder="m / each" />
            </div>
          </div>
          <div>
            <label className="ob-label">Required by</label>
            <input className="ob-input" type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} />
          </div>
          <div>
            <label className="ob-label">Notes</label>
            <textarea className="ob-input" style={{ resize: 'none' }} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Brand, spec, reference..." />
          </div>
          {error && <p className="ob-error">{error}</p>}
          <button type="submit" className="ob-btn-primary" disabled={saving}>
            {saving ? 'Adding…' : 'Add Item'}
          </button>
        </form>
      </div>
    </div>
  )
}
