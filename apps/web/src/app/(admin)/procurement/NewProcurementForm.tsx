'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function NewProcurementForm({
  orgId, userId, projects, defaultProjectId,
}: { orgId: string; userId: string; projects: { id: string; name: string }[]; defaultProjectId?: string }) {
  const router = useRouter()
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '')
  const [requiredBy, setRequiredBy] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      })

    if (err) { setError(err.message); setSaving(false); return }
    setDescription(''); setQuantity(''); setUnit(''); setRequiredBy(''); setNotes('')
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
            <select className="ob-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
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
