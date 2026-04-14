'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function NewProcurementForm({
  orgId, userId, projects
}: { orgId: string; userId: string; projects: { id: string; name: string }[] }) {
  const router = useRouter()
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
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

  const inp = 'w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <Card>
      <CardBody>
        <h3 className="text-sm font-semibold text-white mb-4">+ New Requisition</h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description *</label>
            <input className={inp} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. 25mm conduit 3m lengths" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Project *</label>
            <select className={inp} value={projectId} onChange={e => setProjectId(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Qty</label>
              <input className={inp} type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="50" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Unit</label>
              <input className={inp} value={unit} onChange={e => setUnit(e.target.value)} placeholder="m / each" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Required by</label>
            <input className={inp} type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea className={`${inp} resize-none`} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Brand, spec, reference..." />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <Button type="submit" size="sm" isLoading={saving} className="w-full">Add Item</Button>
        </form>
      </CardBody>
    </Card>
  )
}
