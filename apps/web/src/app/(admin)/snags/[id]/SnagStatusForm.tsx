'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

const STATUSES = [
  { value: 'open', label: 'Open', colour: 'text-red-400 border-red-700' },
  { value: 'in_progress', label: 'In Progress', colour: 'text-amber-400 border-amber-700' },
  { value: 'resolved', label: 'Resolved', colour: 'text-blue-400 border-blue-700' },
  { value: 'pending_sign_off', label: 'Pending Sign-off', colour: 'text-purple-400 border-purple-700' },
  { value: 'signed_off', label: 'Signed Off', colour: 'text-emerald-400 border-emerald-700' },
  { value: 'closed', label: 'Closed', colour: 'text-slate-400 border-slate-600' },
]

interface Props { snagId: string; currentStatus: string }

export function SnagStatusForm({ snagId, currentStatus }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState(currentStatus)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (selected === currentStatus) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const updates: Record<string, unknown> = { status: selected }
    if (selected === 'resolved') updates.resolved_at = new Date().toISOString()

    const { error: err } = await supabase.schema('field').from('snags')
      .update(updates).eq('id', snagId)

    if (err) { setError(err.message); setSaving(false); return }
    router.refresh()
    setSaving(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(({ value, label, colour }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSelected(value)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${selected === value ? colour + ' bg-slate-700' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <Button size="sm" onClick={save} isLoading={saving} disabled={selected === currentStatus}>
        Save Status
      </Button>
    </div>
  )
}
